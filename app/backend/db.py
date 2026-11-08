"""Acceso a Cloud SQL (PostgreSQL) con psycopg 3."""
import logging
import threading
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

import config

log = logging.getLogger("db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gastos (
    id                  UUID PRIMARY KEY,
    fecha_registro      TIMESTAMPTZ NOT NULL,
    fecha_gasto         DATE NOT NULL,
    categoria           TEXT NOT NULL,
    concepto            TEXT NOT NULL,
    tipo_gasto          TEXT NOT NULL CHECK (tipo_gasto IN ('Fijo','Variable Necesario','Variable Hormiga')),
    metodo_pago         TEXT NOT NULL CHECK (metodo_pago IN ('TC','TD','Yape-Plin','Efectivo')),
    entidad_financiera  TEXT NOT NULL DEFAULT '',
    moneda              TEXT NOT NULL CHECK (moneda IN ('PEN','USD')),
    cantidad            NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    monto_total         NUMERIC(12,2) NOT NULL CHECK (monto_total >= 0),
    es_compartido       BOOLEAN NOT NULL DEFAULT FALSE,
    fabric_enviado      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS gastos_fecha_gasto_idx ON gastos (fecha_gasto DESC);
"""


class BaseDeDatosNoDisponible(Exception):
    """Cloud SQL apagado (horario FinOps) o inaccesible."""


_pool: ConnectionPool | None = None
_schema_ok = False
_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    global _pool
    with _lock:
        if _pool is None:
            # open=False + min_size=0: no falla al arrancar si la BD está apagada
            _pool = ConnectionPool(
                config.DATABASE_URL,
                min_size=0,
                max_size=4,
                open=False,
                kwargs={"row_factory": dict_row, "connect_timeout": 5},
            )
            _pool.open(wait=False)
    return _pool


@contextmanager
def conexion():
    """Conexión del pool; crea el esquema la primera vez. Traduce errores de red a 503."""
    global _schema_ok
    try:
        with _get_pool().connection(timeout=8) as conn:
            if not _schema_ok:
                conn.execute(SCHEMA)
                conn.commit()
                _schema_ok = True
            yield conn
    except (psycopg.OperationalError, PoolTimeout) as e:
        log.warning("BD no disponible: %s", e)
        raise BaseDeDatosNoDisponible() from e


INSERT = """
INSERT INTO gastos (id, fecha_registro, fecha_gasto, categoria, concepto, tipo_gasto,
                    metodo_pago, entidad_financiera, moneda, cantidad, monto_total, es_compartido)
VALUES (%(id)s, %(fecha_registro)s, %(fecha_gasto)s, %(categoria)s, %(concepto)s, %(tipo_gasto)s,
        %(metodo_pago)s, %(entidad_financiera)s, %(moneda)s, %(cantidad)s, %(monto_total)s, %(es_compartido)s)
"""


def insertar_gasto(gasto: dict) -> None:
    with conexion() as conn:
        conn.execute(INSERT, gasto)
        conn.commit()


def marcar_enviado(gasto_id) -> None:
    with conexion() as conn:
        conn.execute("UPDATE gastos SET fabric_enviado = TRUE WHERE id = %s", (gasto_id,))
        conn.commit()


def listar_gastos(limite: int = 50) -> list[dict]:
    with conexion() as conn:
        return conn.execute(
            "SELECT * FROM gastos ORDER BY fecha_gasto DESC, fecha_registro DESC LIMIT %s", (limite,)
        ).fetchall()


def resumen(dias: int) -> dict:
    """Agregados del período para el panel de resumen y para la IA (no envía filas sueltas)."""
    filtro = "fecha_gasto >= (now() AT TIME ZONE 'America/Lima')::date - %(dias)s::int"
    p = {"dias": dias}

    def q(conn, sql):
        return conn.execute(sql, p).fetchall()

    with conexion() as conn:
        def agrupar(col):
            return q(conn, f"""
                SELECT {col} AS clave, moneda, COUNT(*) AS n, SUM(monto_total)::float AS total
                FROM gastos WHERE {filtro} GROUP BY 1, 2 ORDER BY total DESC""")

        totales = q(conn, f"""
            SELECT moneda, COUNT(*) AS n, SUM(monto_total)::float AS total,
                   SUM(CASE WHEN es_compartido THEN monto_total ELSE 0 END)::float AS compartido
            FROM gastos WHERE {filtro} GROUP BY moneda""")
        por_mes = q(conn, f"""
            SELECT to_char(fecha_gasto, 'YYYY-MM') AS mes, moneda, SUM(monto_total)::float AS total
            FROM gastos WHERE {filtro} GROUP BY 1, 2 ORDER BY 1""")
        top_hormiga = q(conn, f"""
            SELECT lower(concepto) AS concepto, COUNT(*) AS veces, SUM(monto_total)::float AS total
            FROM gastos WHERE {filtro} AND tipo_gasto = 'Variable Hormiga' AND moneda = 'PEN'
            GROUP BY 1 ORDER BY total DESC LIMIT 8""")

        return {
            "dias": dias,
            "totales": totales,
            "por_categoria": agrupar("categoria"),
            "por_tipo": agrupar("tipo_gasto"),
            "por_metodo": agrupar("metodo_pago"),
            "por_mes": por_mes,
            "top_hormiga": top_hormiga,
        }


def pendientes_fabric(limite: int = 100) -> list[dict]:
    with conexion() as conn:
        return conn.execute(
            "SELECT * FROM gastos WHERE fabric_enviado = FALSE ORDER BY fecha_registro LIMIT %s", (limite,)
        ).fetchall()
