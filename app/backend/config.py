import os
from zoneinfo import ZoneInfo

PENDIENTE = "PENDIENTE"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env("DATABASE_URL")
ALLOWED_EMAIL = _env("ALLOWED_EMAIL").lower()
SESSION_SECRET = _env("SESSION_SECRET", "dev-only-secret")
GOOGLE_OAUTH_CLIENT_ID = _env("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = _env("GOOGLE_OAUTH_CLIENT_SECRET")
FABRIC_CONNECTION_STRING = _env("FABRIC_EVENTSTREAM_CONNECTION_STRING")
COOKIE_SECURE = _env("COOKIE_SECURE", "true").lower() == "true"
TZ = ZoneInfo(_env("APP_TIMEZONE", "America/Lima"))
STATIC_DIR = _env("STATIC_DIR", os.path.join(os.path.dirname(__file__), "static"))


def configurado(valor: str) -> bool:
    return bool(valor) and valor != PENDIENTE
