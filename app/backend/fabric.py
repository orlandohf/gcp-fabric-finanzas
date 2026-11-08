"""Publicación de eventos a Microsoft Fabric Eventstream (Custom Endpoint, protocolo Kafka de Event Hubs)."""
import json
import logging
import threading

from confluent_kafka import Producer

import config

log = logging.getLogger("fabric")

_producer: Producer | None = None
_topic: str | None = None
_lock = threading.Lock()


def _parse_connection_string(cs: str) -> dict:
    partes = dict(p.split("=", 1) for p in cs.split(";") if "=" in p)
    endpoint = partes["Endpoint"]  # sb://<namespace>.servicebus.windows.net/
    host = endpoint.replace("sb://", "").strip("/")
    return {"host": host, "topic": partes["EntityPath"]}


def configurado() -> bool:
    return config.configurado(config.FABRIC_CONNECTION_STRING)


def _get_producer() -> tuple[Producer, str]:
    global _producer, _topic
    with _lock:
        if _producer is None:
            info = _parse_connection_string(config.FABRIC_CONNECTION_STRING)
            _producer = Producer({
                "bootstrap.servers": f"{info['host']}:9093",
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "PLAIN",
                "sasl.username": "$ConnectionString",
                "sasl.password": config.FABRIC_CONNECTION_STRING,
                "client.id": "finanzas-app",
                "acks": "all",
                "enable.idempotence": False,  # Event Hubs no soporta el productor idempotente de Kafka
                "message.timeout.ms": 10000,
                "request.timeout.ms": 10000,
            })
            _topic = info["topic"]
    return _producer, _topic


def enviar_lote(mensajes: list[tuple[str, dict]]) -> list[str | None]:
    """Publica [(clave, evento)] y espera confirmación.

    Devuelve, por mensaje, None si Fabric lo confirmó o el texto del error.
    La clave es el id del gasto → mismo partition → orden garantizado por gasto.
    """
    if not mensajes:
        return []
    if not configurado():
        return ["Fabric no configurado"] * len(mensajes)
    try:
        producer, topic = _get_producer()
    except Exception as e:
        log.exception("Cadena de conexión de Fabric inválida")
        return [f"config: {e}"] * len(mensajes)

    resultados: list[str | None] = ["sin confirmación"] * len(mensajes)

    def _callback(i):
        def cb(err, _msg):
            resultados[i] = str(err) if err else None
        return cb

    try:
        for i, (clave, ev) in enumerate(mensajes):
            producer.produce(topic, key=clave,
                             value=json.dumps(ev, ensure_ascii=False, default=str).encode("utf-8"),
                             callback=_callback(i))
            producer.poll(0)
        producer.flush(15)
    except Exception as e:
        log.exception("Fallo publicando en Fabric")
        return [r if r is None else f"produce: {e}" for r in resultados]

    fallidos = [r for r in resultados if r]
    if fallidos:
        log.error("Fabric: %d de %d eventos fallaron (%s)", len(fallidos), len(mensajes), fallidos[0])
    return resultados
