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


def _get_producer() -> tuple[Producer, str] | None:
    global _producer, _topic
    if not config.configurado(config.FABRIC_CONNECTION_STRING):
        return None
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
                "message.timeout.ms": 10000,
                "request.timeout.ms": 10000,
            })
            _topic = info["topic"]
    return _producer, _topic


def enviar_evento(evento: dict) -> bool:
    """Publica el evento y espera confirmación. Devuelve True si Fabric lo recibió."""
    try:
        prod = _get_producer()
    except Exception:
        log.exception("Cadena de conexión de Fabric inválida")
        return False
    if prod is None:
        log.warning("Fabric no configurado (PENDIENTE); evento %s no enviado", evento.get("id"))
        return False

    producer, topic = prod
    resultado = {"ok": False}

    def _callback(err, _msg):
        if err:
            log.error("Error enviando a Fabric: %s", err)
        else:
            resultado["ok"] = True

    try:
        producer.produce(
            topic,
            key=str(evento["id"]),
            value=json.dumps(evento, ensure_ascii=False, default=str).encode("utf-8"),
            callback=_callback,
        )
        producer.flush(12)
    except Exception:
        log.exception("Fallo publicando en Fabric")
        return False
    return resultado["ok"]
