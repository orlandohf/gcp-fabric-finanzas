import uuid

import pytest

import config
import db
import ia
from conftest import AMIGO, DUENO, eventos
from test_gastos import gasto


def test_lista_blanca_normaliza_correos():
    assert config.email_permitido(DUENO)
    assert config.email_permitido("AMIGO@example.com")
    assert config.email_permitido("familia@example.com")
    assert not config.email_permitido("intruso@example.com")
    assert not config.email_permitido("")


def test_cada_usuario_ve_solo_lo_suyo(client, amigo):
    mio = client.post("/api/gastos", json=gasto(monto_total=20)).json()
    amigo.post("/api/gastos", json=gasto(monto_total=99, es_compartido=True))

    assert [g["id"] for g in client.get("/api/gastos").json()] == [mio["id"]]
    assert len(amigo.get("/api/gastos").json()) == 1
    assert client.get("/api/kpis/mes").json()["PEN"]["total"] == 20
    assert amigo.get("/api/kpis/mes").json()["PEN"]["total"] == 49.5
    assert client.get("/api/por-cobrar").json() == []
    assert client.get("/api/resumen").json()["totales"][0]["total"] == 20


def test_no_se_puede_tocar_un_gasto_ajeno(client, amigo):
    gid = client.post("/api/gastos", json=gasto(es_compartido=True)).json()["id"]
    assert amigo.put(f"/api/gastos/{gid}", json=gasto(monto_total=1)).status_code == 404
    assert amigo.post(f"/api/gastos/{gid}/liquidar", json={}).status_code == 404
    assert amigo.delete(f"/api/gastos/{gid}").status_code == 404
    assert client.get("/api/gastos").json()[0]["monto_total"] == 20
    assert len(eventos()) == 1  # ningún evento por intentos ajenos


def test_reusar_uuid_de_otro_usuario_da_409(client, amigo):
    gid = str(uuid.uuid4())
    assert client.post("/api/gastos", json=gasto(id=gid)).status_code == 201
    r = amigo.post("/api/gastos", json=gasto(id=gid, monto_total=5))
    assert r.status_code == 409
    assert "monto_total" not in r.json()  # no filtra datos del dueño


def test_evento_lleva_usuario_id_seudonimo_y_no_el_correo(client):
    cuerpo = client.post("/api/gastos", json=gasto()).json()
    assert "usuario_id" not in cuerpo
    payload = eventos()[0]["payload"]
    uuid.UUID(payload["usuario_id"])
    assert DUENO not in str(payload) and payload["schema_version"] == 2


def test_me_no_requiere_bd_ni_expone_id(client):
    r = client.get("/api/me").json()
    assert r == {"email": DUENO, "nombre": "Test", "foto": ""}


def test_migracion_asigna_gastos_sin_dueno_al_dueno(client):
    client.post("/api/gastos", json=gasto())
    with db.conexion() as conn:
        conn.execute("ALTER TABLE gastos ALTER COLUMN usuario_id DROP NOT NULL")
        conn.execute("UPDATE gastos SET usuario_id = NULL")
        db._migrar_multiusuario(conn)
        conn.commit()
        fila = conn.execute(
            "SELECT g.version, u.email FROM gastos g JOIN usuarios u ON u.id = g.usuario_id").fetchone()
        nullable = conn.execute(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'gastos' AND column_name = 'usuario_id'").fetchone()["is_nullable"]
    assert fila == {"version": 2, "email": DUENO}
    assert nullable == "NO"
    assert [e["op_type"] for e in eventos()] == ["INSERT", "UPDATE"]


def test_cuota_diaria_de_ia(client, monkeypatch):
    monkeypatch.setattr(config, "IA_LIMITE_ESCANEOS_DIA", 2)
    monkeypatch.setattr(ia, "escanear", lambda datos, mime: {"concepto": "ok"})
    img = {"imagen_base64": "aGVsbG8=", "mime_type": "image/jpeg"}
    client.get("/api/gastos")  # resuelve el id del usuario
    assert client.post("/api/ia/escanear", json=img).status_code == 200
    assert client.post("/api/ia/escanear", json=img).status_code == 200
    assert client.post("/api/ia/escanear", json=img).status_code == 429


def test_cabeceras_de_seguridad(client):
    r = client.get("/api/health")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("origen,esperado", [("https://sitio-malo.example", 403), ("http://testserver", 201)])
def test_csrf_origin(client, origen, esperado):
    assert client.post("/api/gastos", json=gasto(), headers={"Origin": origen}).status_code == esperado
