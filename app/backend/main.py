import logging
import os
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

import base64
import binascii

import config
import db
import fabric
import ia

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Finanzas personales", docs_url=None, redoc_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET,
    https_only=config.COOKIE_SECURE,
    same_site="lax",
    max_age=60 * 60 * 24 * 30,
)

oauth = OAuth()
oauth.register(
    name="google",
    client_id=config.GOOGLE_OAUTH_CLIENT_ID,
    client_secret=config.GOOGLE_OAUTH_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


# ---------- Errores ----------
@app.exception_handler(db.BaseDeDatosNoDisponible)
def _bd_no_disponible(_req, _exc):
    return JSONResponse(
        status_code=503,
        content={"detail": "La base de datos está en horario de descanso (22:00–08:00) o no disponible."},
    )


@app.exception_handler(ia.ErrorIA)
def _error_ia(_req, _exc):
    return JSONResponse(status_code=502, content={"detail": "La IA no pudo procesar la solicitud. Intenta de nuevo."})


# ---------- Auth ----------
def usuario_actual(request: Request) -> dict:
    user = request.session.get("user")
    if not user or user.get("email", "").lower() != config.ALLOWED_EMAIL:
        raise HTTPException(status_code=401, detail="No autenticado")
    return user


@app.get("/auth/login")
async def login(request: Request):
    if not config.configurado(config.GOOGLE_OAUTH_CLIENT_ID):
        raise HTTPException(503, "OAuth aún no configurado")
    redirect_uri = request.url_for("auth_callback")
    return await oauth.google.authorize_redirect(request, str(redirect_uri), prompt="select_account")


@app.get("/auth/callback", name="auth_callback")
async def auth_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as e:
        log.warning("OAuth error: %s", e)
        return RedirectResponse("/?error=oauth")
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").lower()
    if not info.get("email_verified") or email != config.ALLOWED_EMAIL:
        log.warning("Acceso denegado a %s", email)
        request.session.clear()
        return RedirectResponse("/?error=denegado")
    request.session["user"] = {"email": email, "nombre": info.get("name", ""), "foto": info.get("picture", "")}
    return RedirectResponse("/")


@app.get("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


# ---------- API ----------
class GastoIn(BaseModel):
    fecha_gasto: date
    categoria: str = Field(min_length=1, max_length=60)
    concepto: str = Field(min_length=1, max_length=200)
    tipo_gasto: Literal["Fijo", "Variable Necesario", "Variable Hormiga"]
    metodo_pago: Literal["TC", "TD", "Yape-Plin", "Efectivo"]
    entidad_financiera: str = Field(default="", max_length=60)
    moneda: Literal["PEN", "USD"]
    cantidad: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    monto_total: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    es_compartido: bool = False


def _evento(g: dict) -> dict:
    """JSON enviado a Fabric (sin columnas internas)."""
    return {
        "id": str(g["id"]),
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
        "es_compartido": g["es_compartido"],
    }


@app.get("/api/health")  # /healthz está reservado por el frontend de Cloud Run
def health():
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(usuario_actual)):
    return user


@app.get("/api/gastos")
def listar(user: dict = Depends(usuario_actual)):
    return [_evento(g) | {"fabric_enviado": g["fabric_enviado"]} for g in db.listar_gastos()]


@app.post("/api/gastos", status_code=201)
def crear(gasto: GastoIn, user: dict = Depends(usuario_actual)):
    registro = gasto.model_dump() | {"id": uuid.uuid4(), "fecha_registro": datetime.now(config.TZ)}

    # (a) Cloud SQL: fuente de verdad
    db.insertar_gasto(registro)

    # (b) Fabric Eventstream: tiempo real (si falla, queda pendiente de reenvío)
    evento = _evento(registro)
    enviado = fabric.enviar_evento(evento)
    if enviado:
        db.marcar_enviado(registro["id"])
    return evento | {"fabric_enviado": enviado}


@app.post("/api/fabric/reenviar")
def reenviar(user: dict = Depends(usuario_actual)):
    ok = 0
    pendientes = db.pendientes_fabric()
    for g in pendientes:
        if fabric.enviar_evento(_evento(g)):
            db.marcar_enviado(g["id"])
            ok += 1
    return {"pendientes": len(pendientes), "reenviados": ok}


# ---------- IA (Gemini) ----------
MIME_PERMITIDOS = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_IMAGEN = 7 * 1024 * 1024


class ImagenIn(BaseModel):
    imagen_base64: str = Field(max_length=10_000_000)
    mime_type: str = "image/jpeg"


@app.post("/api/ia/escanear")
def escanear(img: ImagenIn, user: dict = Depends(usuario_actual)):
    if img.mime_type not in MIME_PERMITIDOS:
        raise HTTPException(415, "Formato de imagen no soportado")
    try:
        datos = base64.b64decode(img.imagen_base64.split(",")[-1], validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Imagen inválida")
    if len(datos) > MAX_IMAGEN:
        raise HTTPException(413, "Imagen demasiado grande")
    return ia.escanear(datos, img.mime_type)


@app.get("/api/resumen")
def resumen(dias: int = 30, user: dict = Depends(usuario_actual)):
    return db.resumen(max(7, min(dias, 365)))


@app.post("/api/ia/consejos")
def consejos(dias: int = 30, user: dict = Depends(usuario_actual)):
    dias = max(7, min(dias, 365))
    datos = db.resumen(dias)
    if not datos["totales"]:
        return {"resumen": "Aún no hay gastos en este período.", "alerta": "",
                "consejos": [{"titulo": "Empieza a registrar", "ahorro_estimado_mensual": 0,
                              "detalle": "Registra tus gastos unos días (usa el escaneo con IA para ir rápido) y vuelve a pedir el análisis."}]}
    return ia.aconsejar(datos, dias)


# ---------- Frontend (SPA) ----------
if os.path.isdir(os.path.join(config.STATIC_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(config.STATIC_DIR, "assets")), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    index = os.path.join(config.STATIC_DIR, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return JSONResponse({"detail": "Frontend no compilado"}, status_code=404)
