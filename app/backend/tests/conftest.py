import os
import sys

# Config de prueba ANTES de importar la app
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/finanzas_test")
os.environ["ALLOWED_EMAIL"] = "test@example.com"
os.environ["FABRIC_EVENTSTREAM_CONNECTION_STRING"] = "PENDIENTE"
os.environ["COOKIE_SECURE"] = "false"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import main  # noqa: E402


@pytest.fixture()
def client():
    main.app.dependency_overrides[main.usuario_actual] = lambda: {"email": "test@example.com"}
    with db.conexion() as conn:
        conn.execute("TRUNCATE gastos, eventos_fabric RESTART IDENTITY")
        conn.commit()
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


@pytest.fixture()
def anonimo():
    main.app.dependency_overrides.clear()
    return TestClient(main.app)


def eventos():
    with db.conexion() as conn:
        return conn.execute("SELECT * FROM eventos_fabric ORDER BY id").fetchall()
