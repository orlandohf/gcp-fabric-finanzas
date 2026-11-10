"""Acceso a Cloud SQL (PostgreSQL) con psycopg 3.

Patrón Transactional Outbox: cada escritura en `gastos` inserta su evento en `eventos_fabric`
dentro de la MISMA transacción. Un publisher (outbox.py) lo envía después a Fabric.
"""
import logging
import threading
from contextlib import contextmanager
from datetime import datetime

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool, PoolTimeout

import config

log = logging.getLogger("db")

SCHEMA_VERSION_EVENTO = 2

# Migración idempotente (se ejecuta una vez por instancia, serializada con advisory lock)
SCHEMA = """
SELECT pg_advisory_xact_lock(726354);

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
    fabric_enviado      BOOLEAN NOT NULL DEFAULT FALSE  -- legado (v1); reemplazado por eventos_fabric
);
CREATE INDEX IF NOT EXISTS gastos_fecha_gasto_idx ON gastos (fecha_gasto DESC);

-- v2: split de compartidos + versionado para CDC
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS monto_propio   NUMERIC(12,2) CHECK (monto_propio >= 0);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS liquidado      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS version        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ;
UPDATE gastos SET actualizado_en = fecha_registro WHERE actualizado_en IS NULL;

CREATE TABLE IF NOT EXISTS eventos_fabric (
    id            BIGSERIAL PRIMARY KEY,
    gasto_id      UUID NOT NULL,
    op_type       TEXT NOT NULL CHECK (op_type IN ('INSERT','UPDATE','DELETE')),
    version       INTEGER NOT NULL,
    payload       JSONB NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en    TIMESTAMPTZ,
    intentos      INTEGER NOT NULL DEFAULT 0,
    ultimo_error  TEXT
);
CREATE INDEX IF NOT EXISTS eventos_fabric_pendientes_idx ON eventos_fabric (id) WHERE enviado_en IS NULL;
CREATE INDEX IF NOT EXISTS eventos_fabric_gasto_idx ON eventos_fabric (gasto_id);

-- v3: multiusuario (amigos y familia). Cada gasto pertenece a un usuario; el correo NO sale de PostgreSQL
CREATE TABLE IF NOT EXISTS usuarios (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    nombre         TEXT NOT NULL DEFAULT '',
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_acceso  TIMESTAMPTZ
);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES usuarios (id);
CREATE INDEX IF NOT EXISTS gastos_usuario_fecha_idx ON gastos (usuario_id, fecha_gasto DESC);

-- Cuota diaria de IA por usuario (control de costos)
CREATE TABLE IF NOT EXISTS uso_ia (
    usuario_id  UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    dia         DATE NOT NULL,
    accion      TEXT NOT NULL,
    n           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario_id, dia, accion)
);
"""

# Monto que salió realmente de mi bolsillo
REAL = "COALESCE(monto_propio, monto_total)"
MES_LIMA = "date_trunc('month', (now() AT TIME ZONE 'America/Lima')::date)"
HOY_LIMA = "(now() AT TIME ZONE 'America/Lima')::date"


class BaseDeDatosNoDisponible(Exception):
    """Cloud SQL apagado (horario FinOps) o inaccesible."""


class IdDeOtroUsuario(Exception):
    """El cliente reutilizó un UUID que ya pertenece a otro usuario."""


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


def _migrar(conn) -> None:
    conn.execute(SCHEMA)
    # Gastos v1 no enviados a Fabric → se encolan como INSERT en la outbox
    legado = conn.execute(
        "SELECT * FROM gastos g WHERE fabric_enviado = FALSE "
        "AND NOT EXISTS (SELECT 1 FROM eventos_fabric e WHERE e.gasto_id = g.id)"
    ).fetchall()
    for g in legado:
        _encolar(conn, g, "INSERT")
    conn.execute("UPDATE gastos SET fabric_enviado = TRUE WHERE fabric_enviado = FALSE")
    if legado:
        log.info("Migración: %d gastos v1 encolados en la outbox", len(legado))
    _migrar_multiusuario(conn)
    conn.commit()


def _migrar_multiusuario(conn) -> None:
    """Asigna los gastos sin dueño a ALLOWED_EMAIL (dueño original) y emite su UPDATE a Fabric."""
    if conn.execute("SELECT EXISTS (SELECT 1 FROM gastos WHERE usuario_id IS NULL) AS h").fetchone()["h"]:
        if not config.ALLOWED_EMAIL:
            log.error("Hay gastos sin usuario y ALLOWED_EMAIL está vacío: no se puede asignar dueño")
            return
        dueno = _upsert_usuario(conn, config.ALLOWED_EMAIL, "")
        filas = conn.execute(
            "UPDATE gastos SET usuario_id = %s, version = version + 1, actualizado_en = now() "
            "WHERE usuario_id IS NULL RETURNING *", (dueno,)).fetchall()
        for g in filas:
            _encolar(conn, g, "UPDATE")  # CDC: Fabric también se entera del dueño
        log.info("Migración multiusuario: %d gastos asignados al dueño", len(filas))
    conn.execute("ALTER TABLE gastos ALTER COLUMN usuario_id SET NOT NULL")


@contextmanager
def conexion():
    """Conexión del pool; migra el esquema la primera vez. Traduce errores de red a 503."""
    global _schema_ok
    try:
        with _get_pool().connection(timeout=8) as conn:
            if not _schema_ok:
                _migrar(conn)
                _schema_ok = True
            yield conn
    except (psycopg.OperationalError, PoolTimeout) as e:
        log.warning("BD no disponible: %s", e)
        raise BaseDeDatosNoDisponible() from e


# ---------- Usuarios ----------
def _upsert_usuario(conn, email: str, nombre: str):
    return conn.execute(
        """INSERT INTO usuarios (email, nombre, ultimo_acceso) VALUES (%s, %s, now())
           ON CONFLICT (email) DO UPDATE
             SET nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), usuarios.nombre), ultimo_acceso = now()
           RETURNING id""", (email.lower(), nombre or "")).fetchone()["id"]


def registrar_usuario(email: str, nombre: str = ""):
    """Alta (o último acceso) del usuario al iniciar sesión. Devuelve su UUID."""
    with conexion() as conn:
        with conn.transaction():
            return _upsert_usuario(conn, email, nombre)


def consumir_cuota_ia(usuario_id, accion: str, limite: int) -> bool:
    """Suma 1 al uso del día (hora Lima). False si ya superó el límite."""
    with conexion() as conn:
        with conn.transaction():
            n = conn.execute(
                f"""INSERT INTO uso_ia (usuario_id, dia, accion, n) VALUES (%s, {HOY_LIMA}, %s, 1)
                    ON CONFLICT (usuario_id, dia, accion) DO UPDATE SET n = uso_ia.n + 1
                    RETURNING n""", (usuario_id, accion)).fetchone()["n"]
    return n <= limite


# ---------- Eventos (contrato v2) ----------
def evento(g: dict, op_type: str, version: int | None = None, cuando: datetime | None = None) -> dict:
    """JSON que se envía a Fabric. En DELETE lleva el último estado conocido."""
    ts = cuando or g.get("actualizado_en") or g["fecha_registro"]
    return {
        "id": str(g["id"]),
        "usuario_id": str(g["usuario_id"]) if g.get("usuario_id") else None,  # seudónimo: nunca el correo
        "op_type": op_type,
        "version": version or g.get("version") or 1,
        "version_timestamp": ts.astimezone(config.TZ).isoformat(),
        "schema_version": SCHEMA_VERSION_EVENTO,
        "fecha_registro": g["fecha_registro"].astimezone(config.TZ).isoformat(),
        "fecha_gasto": g["fecha_gasto"].isoformat(),
        "categoria": g["categoria"],
        "concepto": g["concepto"],
        "tipo_gasto": g["tipo_gasto"],
        "metodo_pago": g["metodo_pago"],
        "entidad_financiera": g["entidad_financiera"],
        "moneda": g["moneda"],
        "cantidad": float(g["cantidad"]),
        "monto_total": float(g["monto_total"]),
        "monto_propio": float(g["monto_propio"]) if g.get("monto_propio") is not None else None,
        "es_compartido": g["es_compartido"],
        "liquidado": bool(g.get("liquidado")),
    }


def _encolar(conn, g: dict, op_type: str, version: int | None = None, cuando: datetime | None = None) -> None:
    ev = evento(g, op_type, version, cuando)
    conn.execute(
        "INSERT INTO eventos_fabric (gasto_id, op_type, version, payload) VALUES (%s, %s, %s, %s)",
        (g["id"], op_type, ev["version"], Jsonb(ev)),
    )


# ---------- Escrituras (gasto + evento en la misma transacción) ----------
CAMPOS = ("fecha_gasto", "categoria", "concepto", "tipo_gasto", "metodo_pago", "entidad_financiera",
          "moneda", "cantidad", "monto_total", "es_compartido", "monto_propio")


def crear_gasto(usuario_id, gasto: dict) -> tuple[dict, bool]:
    """Idempotente por id (la cola offline puede reintentar). Devuelve (fila, creado)."""
    gasto = gasto | {"usuario_id": usuario_id}
    cols = ("id", "usuario_id", "fecha_registro", "actualizado_en") + CAMPOS
    sql = (f"INSERT INTO gastos ({', '.join(cols)}) VALUES ({', '.join(f'%({c})s' for c in cols)}) "
           "ON CONFLICT (id) DO NOTHING RETURNING *")
    with conexion() as conn:
        with conn.transaction():
            fila = conn.execute(sql, gasto | {"actualizado_en": gasto["fecha_registro"]}).fetchone()
            if fila is None:
                existente = obtener(conn, gasto["id"], usuario_id)
                if existente is None:
                    raise IdDeOtroUsuario()
                return existente, False
            _encolar(conn, fila, "INSERT")
        return fila, True


def actualizar_gasto(usuario_id, gasto_id, datos: dict) -> dict | None:
    sets = ", ".join(f"{c} = %({c})s" for c in CAMPOS)
    sql = (f"UPDATE gastos SET {sets}, version = version + 1, actualizado_en = now() "
           "WHERE id = %(id)s AND usuario_id = %(usuario_id)s RETURNING *")
    with conexion() as conn:
        with conn.transaction():
            fila = conn.execute(sql, datos | {"id": gasto_id, "usuario_id": usuario_id}).fetchone()
            if fila:
                _encolar(conn, fila, "UPDATE")
        return fila


def marcar_liquidado(usuario_id, gasto_id, liquidado: bool) -> dict | None:
    with conexion() as conn:
        with conn.transaction():
            fila = conn.execute(
                "UPDATE gastos SET liquidado = %s, version = version + 1, actualizado_en = now() "
                "WHERE id = %s AND usuario_id = %s AND es_compartido RETURNING *",
                (liquidado, gasto_id, usuario_id)).fetchone()
            if fila:
                _encolar(conn, fila, "UPDATE")
        return fila


def eliminar_gasto(usuario_id, gasto_id) -> bool:
    with conexion() as conn:
        with conn.transaction():
            fila = conn.execute("DELETE FROM gastos WHERE id = %s AND usuario_id = %s RETURNING *",
                                (gasto_id, usuario_id)).fetchone()
            if fila:
                _encolar(conn, fila, "DELETE", version=fila["version"] + 1, cuando=datetime.now(config.TZ))
        return fila is not None


# ---------- Lecturas ----------
def obtener(conn, gasto_id, usuario_id) -> dict | None:
    return conn.execute("SELECT * FROM gastos WHERE id = %s AND usuario_id = %s",
                        (gasto_id, usuario_id)).fetchone()


def fabric_pendiente(gasto_id) -> bool:
    with conexion() as conn:
        return conn.execute(
            "SELECT EXISTS (SELECT 1 FROM eventos_fabric WHERE gasto_id = %s AND enviado_en IS NULL) AS p",
            (gasto_id,)).fetchone()["p"]


def listar_gastos(usuario_id, limite: int = 50) -> list[dict]:
    with conexion() as conn:
        return conn.execute(
            """SELECT g.*, EXISTS (SELECT 1 FROM eventos_fabric e
                                   WHERE e.gasto_id = g.id AND e.enviado_en IS NULL) AS fabric_pendiente
               FROM gastos g WHERE g.usuario_id = %s
               ORDER BY fecha_gasto DESC, fecha_registro DESC LIMIT %s""", (usuario_id, limite)
        ).fetchall()


def kpis_mes(usuario_id) -> list[dict]:
    """KPIs exactos del mes en curso (America/Lima), sin depender de cuántos gastos haya."""
    with conexion() as conn:
        return conn.execute(f"""
            SELECT moneda,
                   COUNT(*)                                                              AS n,
                   COALESCE(SUM({REAL}), 0)::float                                       AS total,
                   COALESCE(SUM({REAL}) FILTER (WHERE tipo_gasto = 'Variable Hormiga'), 0)::float AS hormiga,
                   COALESCE(SUM(monto_total - {REAL})
                            FILTER (WHERE es_compartido AND NOT liquidado), 0)::float    AS por_cobrar
            FROM gastos
            WHERE usuario_id = %s AND date_trunc('month', fecha_gasto) = {MES_LIMA}
            GROUP BY moneda""", (usuario_id,)).fetchall()


def por_cobrar(usuario_id) -> list[dict]:
    with conexion() as conn:
        return conn.execute(f"""
            SELECT *, (monto_total - {REAL})::float AS pendiente
            FROM gastos
            WHERE usuario_id = %s AND es_compartido AND monto_total > {REAL}
            ORDER BY liquidado, fecha_gasto DESC
            LIMIT 100""", (usuario_id,)).fetchall()


def resumen(usuario_id, dias: int) -> dict:
    """Agregados del período (monto real = parte propia) para el panel y para la IA."""
    filtro = f"usuario_id = %(usuario_id)s AND fecha_gasto >= {HOY_LIMA} - %(dias)s::int"
    p = {"dias": dias, "usuario_id": usuario_id}

    def q(conn, sql):
        return conn.execute(sql, p).fetchall()

    with conexion() as conn:
        def agrupar(col):
            return q(conn, f"""
                SELECT {col} AS clave, moneda, COUNT(*) AS n, SUM({REAL})::float AS total
                FROM gastos WHERE {filtro} GROUP BY 1, 2 ORDER BY total DESC""")

        totales = q(conn, f"""
            SELECT moneda, COUNT(*) AS n, SUM({REAL})::float AS total,
                   SUM(CASE WHEN es_compartido THEN monto_total ELSE 0 END)::float AS compartido,
                   SUM(CASE WHEN es_compartido AND NOT liquidado THEN monto_total - {REAL} ELSE 0 END)::float AS por_cobrar
            FROM gastos WHERE {filtro} GROUP BY moneda""")
        por_mes = q(conn, f"""
            SELECT to_char(fecha_gasto, 'YYYY-MM') AS mes, moneda, SUM({REAL})::float AS total
            FROM gastos WHERE {filtro} GROUP BY 1, 2 ORDER BY 1""")
        top_hormiga = q(conn, f"""
            SELECT lower(concepto) AS concepto, COUNT(*) AS veces, SUM({REAL})::float AS total
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
