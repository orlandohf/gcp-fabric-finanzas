import os
import sys

# Config de prueba ANTES de importar la app
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/finanzas_test")
os.environ["ALLOWED_EMAIL"] = "test@example.com"
os.environ["ALLOWED_EMAILS"] = "amigo@example.com; Familia@Example.com"
os.environ["FABRIC_EVENTSTREAM_CONNECTION_STRING"] = "PENDIENTE"
os.environ["COOKIE_SECURE"] = "false"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import main  # noqa: E402

DUENO = "test@example.com"
AMIGO = "amigo@example.com"


def _sesion_de_prueba(request: Request) -> dict:
    # La cabecera elige el usuario; usuario_actual (real) resuelve su id en la tabla usuarios
    return {"email": request.headers.get("x-test-email", DUENO), "nombre": "Test"}


def limpiar():
    with db.conexion() as conn:
        conn.execute("TRUNCATE gastos, eventos_fabric, uso_ia, usuarios RESTART IDENTITY CASCADE")
        conn.commit()


@pytest.fixture()
def client():
    main.app.dependency_overrides[main.sesion_actual] = _sesion_de_prueba
    limpiar()
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


@pytest.fixture()
def amigo(client):
    """Cliente autenticado como otro invitado (misma app, otra cuenta)."""
    return TestClient(main.app, headers={"x-test-email": AMIGO})


@pytest.fixture()
def anonimo():
    main.app.dependency_overrides.clear()
    return TestClient(main.app)


def eventos():
    with db.conexion() as conn:
        return conn.execute("SELECT * FROM eventos_fabric ORDER BY id").fetchall()
