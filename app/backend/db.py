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


def pendientes_fabric(limite: int = 100) -> list[dict]:
    with conexion() as conn:
        return conn.execute(
            "SELECT * FROM gastos WHERE fabric_enviado = FALSE ORDER BY fecha_registro LIMIT %s", (limite,)
        ).fetchall()
