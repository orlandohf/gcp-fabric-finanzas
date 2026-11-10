import os
import re
from zoneinfo import ZoneInfo

PENDIENTE = "PENDIENTE"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env("DATABASE_URL")
# Dueño original (sus gastos previos al modo multiusuario se le asignan en la migración)
ALLOWED_EMAIL = _env("ALLOWED_EMAIL").lower()
# Lista blanca de invitados (secreto ALLOWED_EMAILS): separados por coma, punto y coma o salto de línea
ALLOWED_EMAILS = frozenset(
    e.strip().lower()
    for e in re.split(r"[,;\s]+", _env("ALLOWED_EMAILS") + "," + ALLOWED_EMAIL)
    if "@" in e
)
SESSION_SECRET = _env("SESSION_SECRET", "dev-only-secret")
GOOGLE_OAUTH_CLIENT_ID = _env("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = _env("GOOGLE_OAUTH_CLIENT_SECRET")
FABRIC_CONNECTION_STRING = _env("FABRIC_EVENTSTREAM_CONNECTION_STRING")
COOKIE_SECURE = _env("COOKIE_SECURE", "true").lower() == "true"
TZ = ZoneInfo(_env("APP_TIMEZONE", "America/Lima"))
# Cuotas diarias de IA por usuario (control de costos de Vertex AI)
IA_LIMITE_ESCANEOS_DIA = int(_env("IA_LIMITE_ESCANEOS_DIA", "40"))
IA_LIMITE_CONSEJOS_DIA = int(_env("IA_LIMITE_CONSEJOS_DIA", "10"))
STATIC_DIR = _env("STATIC_DIR", os.path.join(os.path.dirname(__file__), "static"))


def configurado(valor: str) -> bool:
    return bool(valor) and valor != PENDIENTE


def email_permitido(email: str) -> bool:
    return bool(email) and email.lower() in ALLOWED_EMAILS


def session_secret_inseguro() -> bool:
    """En producción (cookies seguras) no se debe arrancar con el secreto de desarrollo."""
    return COOKIE_SECURE and SESSION_SECRET in ("", "dev-only-secret", PENDIENTE)
