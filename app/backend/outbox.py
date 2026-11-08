"""Publisher de la Transactional Outbox: envía a Fabric los eventos pendientes de `eventos_fabric`.

Se invoca (auto-retry):
  - después de cada escritura (crear / editar / eliminar / liquidar), dentro del request;
  - en segundo plano al cargar la lista de gastos;
  - manualmente con POST /api/fabric/reenviar.
"""
import logging
import threading

import db
import fabric

log = logging.getLogger("outbox")

_lock = threading.Lock()  # un solo publisher por instancia; entre instancias: SKIP LOCKED


def publicar_pendientes(limite: int = 200) -> dict:
    if not fabric.configurado():
        return {"pendientes": 0, "enviados": 0, "omitido": "Fabric no configurado"}
    if not _lock.acquire(blocking=False):
        return {"pendientes": 0, "enviados": 0, "omitido": "publicación en curso"}
    try:
        with db.conexion() as conn:
            with conn.transaction():
                filas = conn.execute(
                    """SELECT id, gasto_id, payload FROM eventos_fabric
                       WHERE enviado_en IS NULL ORDER BY id
                       LIMIT %s FOR UPDATE SKIP LOCKED""", (limite,)).fetchall()
                if not filas:
                    return {"pendientes": 0, "enviados": 0}

                resultados = fabric.enviar_lote([(str(f["gasto_id"]), f["payload"]) for f in filas])
                ok = [f["id"] for f, r in zip(filas, resultados) if r is None]
                ko = [(f["id"], r) for f, r in zip(filas, resultados) if r is not None]

                if ok:
                    conn.execute("UPDATE eventos_fabric SET enviado_en = now(), ultimo_error = NULL "
                                 "WHERE id = ANY(%s)", (ok,))
                for ev_id, err in ko:
                    conn.execute("UPDATE eventos_fabric SET intentos = intentos + 1, ultimo_error = %s "
                                 "WHERE id = %s", (err[:500], ev_id))
        if ok:
            log.info("Outbox: %d eventos enviados a Fabric (%d con error)", len(ok), len(ko))
        return {"pendientes": len(filas), "enviados": len(ok)}
    except db.BaseDeDatosNoDisponible:
        raise
    except Exception:
        log.exception("Error publicando la outbox")
        return {"pendientes": 0, "enviados": 0, "omitido": "error"}
    finally:
        _lock.release()


def publicar_en_segundo_plano() -> None:
    try:
        publicar_pendientes()
    except db.BaseDeDatosNoDisponible:
        pass
