import uuid
from datetime import datetime

import pytest

import config
import fabric
import outbox
from conftest import eventos


def hoy():
    return datetime.now(config.TZ).date().isoformat()


def gasto(**extra):
    base = {"fecha_gasto": hoy(), "categoria": "Alimentación", "concepto": "Almuerzo",
            "tipo_gasto": "Variable Necesario", "metodo_pago": "TD", "entidad_financiera": "BCP",
            "moneda": "PEN", "cantidad": 1, "monto_total": 20, "es_compartido": False}
    return base | extra


def test_requiere_login(anonimo):
    assert anonimo.get("/api/gastos").status_code == 401
    assert anonimo.get("/api/kpis/mes").status_code == 401
    assert anonimo.get("/api/health").status_code == 200


def test_crear_genera_evento_insert(client):
    r = client.post("/api/gastos", json=gasto())
    assert r.status_code == 201
    cuerpo = r.json()
    assert cuerpo["version"] == 1 and "op_type" not in cuerpo
    assert cuerpo["fabric_pendiente"] is True  # Fabric no configurado en tests

    ev = eventos()
    assert [e["op_type"] for e in ev] == ["INSERT"]
    assert ev[0]["payload"]["schema_version"] == 2
    assert ev[0]["payload"]["id"] == cuerpo["id"]


def test_crear_es_idempotente_por_id(client):
    gid = str(uuid.uuid4())
    assert client.post("/api/gastos", json=gasto(id=gid)).status_code == 201
    assert client.post("/api/gastos", json=gasto(id=gid, monto_total=999)).status_code == 201
    lista = client.get("/api/gastos").json()
    assert len(lista) == 1 and lista[0]["monto_total"] == 20
    assert len(eventos()) == 1


def test_kpis_mes_no_depende_de_los_50_ultimos(client):
    for _ in range(60):
        client.post("/api/gastos", json=gasto(monto_total=10, tipo_gasto="Variable Hormiga"))
    assert len(client.get("/api/gastos").json()) == 50
    k = client.get("/api/kpis/mes").json()
    assert k["PEN"]["total"] == 600
    assert k["PEN"]["hormiga"] == 600
    assert k["PEN"]["n"] == 60
    assert k["USD"]["total"] == 0


def test_editar_incrementa_version_y_emite_update(client):
    gid = client.post("/api/gastos", json=gasto()).json()["id"]
    r = client.put(f"/api/gastos/{gid}", json=gasto(monto_total=35, concepto="Cena"))
    assert r.status_code == 200
    assert r.json()["version"] == 2 and r.json()["monto_total"] == 35

    ev = eventos()
    assert [(e["op_type"], e["version"]) for e in ev] == [("INSERT", 1), ("UPDATE", 2)]
    assert ev[1]["payload"]["version_timestamp"] >= ev[0]["payload"]["version_timestamp"]


def test_eliminar_emite_delete_con_ultimo_estado(client):
    gid = client.post("/api/gastos", json=gasto()).json()["id"]
    assert client.delete(f"/api/gastos/{gid}").status_code == 204
    assert client.delete(f"/api/gastos/{gid}").status_code == 404
    ev = eventos()
    assert ev[-1]["op_type"] == "DELETE" and ev[-1]["version"] == 2
    assert ev[-1]["payload"]["concepto"] == "Almuerzo"
    assert client.get("/api/gastos").json() == []


def test_editar_inexistente_404(client):
    assert client.put(f"/api/gastos/{uuid.uuid4()}", json=gasto()).status_code == 404


def test_split_por_defecto_50_50_y_kpi_usa_mi_parte(client):
    r = client.post("/api/gastos", json=gasto(es_compartido=True, monto_total=100))
    assert r.json()["monto_propio"] == 50
    client.post("/api/gastos", json=gasto(es_compartido=True, monto_total=90, monto_propio=30))
    client.post("/api/gastos", json=gasto(monto_total=10))

    k = client.get("/api/kpis/mes").json()["PEN"]
    assert k["total"] == 50 + 30 + 10          # gasto real de mi bolsillo
    assert k["por_cobrar"] == 50 + 60


def test_split_invalido_422(client):
    r = client.post("/api/gastos", json=gasto(es_compartido=True, monto_total=10, monto_propio=20))
    assert r.status_code == 422


def test_no_compartido_ignora_monto_propio(client):
    r = client.post("/api/gastos", json=gasto(monto_total=10, monto_propio=3))
    assert r.json()["monto_propio"] is None


def test_por_cobrar_y_liquidar(client):
    gid = client.post("/api/gastos", json=gasto(es_compartido=True, monto_total=80)).json()["id"]
    pc = client.get("/api/por-cobrar").json()
    assert len(pc) == 1 and pc[0]["pendiente"] == 40 and pc[0]["liquidado"] is False

    r = client.post(f"/api/gastos/{gid}/liquidar", json={"liquidado": True})
    assert r.status_code == 200 and r.json()["liquidado"] is True
    assert client.get("/api/kpis/mes").json()["PEN"]["por_cobrar"] == 0
    assert eventos()[-1]["op_type"] == "UPDATE"


def test_liquidar_no_compartido_404(client):
    gid = client.post("/api/gastos", json=gasto()).json()["id"]
    assert client.post(f"/api/gastos/{gid}/liquidar", json={}).status_code == 404


def test_outbox_publica_y_reintenta(client, monkeypatch):
    client.post("/api/gastos", json=gasto())
    client.post("/api/gastos", json=gasto())
    enviados = []

    monkeypatch.setattr(fabric, "configurado", lambda: True)
    # Primer intento: falla el segundo evento
    monkeypatch.setattr(fabric, "enviar_lote",
                        lambda msgs: enviados.extend(msgs) or [None, "timeout"][: len(msgs)])
    assert outbox.publicar_pendientes() == {"pendientes": 2, "enviados": 1}
    pendientes = [e for e in eventos() if e["enviado_en"] is None]
    assert len(pendientes) == 1 and pendientes[0]["intentos"] == 1 and pendientes[0]["ultimo_error"] == "timeout"

    # Reintento: solo reenvía el pendiente
    monkeypatch.setattr(fabric, "enviar_lote", lambda msgs: [None] * len(msgs))
    assert outbox.publicar_pendientes() == {"pendientes": 1, "enviados": 1}
    assert all(e["enviado_en"] for e in eventos())
    assert all(not g["fabric_pendiente"] for g in client.get("/api/gastos").json())


@pytest.mark.parametrize("campo,valor", [("tipo_gasto", "Otro"), ("moneda", "EUR"), ("metodo_pago", "Cheque")])
def test_enums_invalidos_422(client, campo, valor):
    assert client.post("/api/gastos", json=gasto(**{campo: valor})).status_code == 422
