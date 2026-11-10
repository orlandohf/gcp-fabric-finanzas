import base64
import binascii
import logging
import os
import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal
from urllib.parse import urlparse

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from starlette.middleware.sessions import SessionMiddleware

import config
import db
import ia
import outbox

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Finanzas personales", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _verificar_config():
    if config.session_secret_inseguro():
        raise RuntimeError("SESSION_SECRET no configurado: no se arranca con cookies firmadas con el secreto de desarrollo")
    log.info("Usuarios invitados: %d", len(config.ALLOWED_EMAILS))


# ---------- Cabeceras de seguridad + defensa CSRF ----------
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    # el service worker cachea las fuentes de Google (fetch desde sw.js)
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
CABECERAS_SEGURIDAD = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
METODOS_SEGUROS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def seguridad(request: Request, call_next):
    # CSRF (defensa en profundidad además de SameSite=Lax): una escritura con Origin de otro sitio se rechaza
    origen = request.headers.get("origin")
    if request.method not in METODOS_SEGUROS and origen and urlparse(origen).netloc != request.headers.get("host"):
        log.warning("Origin rechazado: %s", origen)
        return JSONResponse(status_code=403, content={"detail": "Origen no permitido"})
    resp = await call_next(request)
    for k, v in CABECERAS_SEGURIDAD.items():
        resp.headers.setdefault(k, v)
    if config.COOKIE_SECURE:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith(("/api/", "/auth/")):
        resp.headers.setdefault("Cache-Control", "no-store")  # datos financieros: nunca en cachés intermedias
    return resp


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
        content={"detail": "La base de datos está en horario de descanso (23:00–06:00) o no disponible.",
                 "codigo": "bd_descanso"},
    )


@app.exception_handler(db.IdDeOtroUsuario)
def _id_ajeno(_req, _exc):
    return JSONResponse(status_code=409, content={"detail": "Ese identificador de gasto ya está en uso. Vuelve a intentarlo."})


@app.exception_handler(ia.ErrorIA)
def _error_ia(_req, _exc):
    return JSONResponse(status_code=502, content={"detail": "La IA no pudo procesar la solicitud. Intenta de nuevo."})


# ---------- Auth ----------
def sesion_actual(request: Request) -> dict:
    """Sesión válida y correo aún invitado (se revisa en cada request: quitarlo de la lista corta el acceso).
    No toca la BD: sirve de noche (BD apagada) para /api/me y la cola offline."""
    user = request.session.get("user")
    if not user or not config.email_permitido(user.get("email", "")):
        raise HTTPException(status_code=401, detail="No autenticado")
    return user


def usuario_actual(request: Request, user: Annotated[dict, Depends(sesion_actual)]) -> dict:
    """Sesión + id interno del usuario (UUID). Se resuelve una vez y queda en la cookie firmada."""
    if not user.get("id"):
        user = user | {"id": str(db.registrar_usuario(user["email"], user.get("nombre", "")))}
        request.session["user"] = user
    return user


Sesion = Annotated[dict, Depends(sesion_actual)]
Usuario = Annotated[dict, Depends(usuario_actual)]


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
    if not info.get("email_verified") or not config.email_permitido(email):
        log.warning("Acceso denegado a %s", email)
        request.session.clear()
        return RedirectResponse("/?error=denegado")
    request.session.clear()  # sesión nueva en cada login (evita arrastrar datos de otra cuenta)
    request.session["user"] = {"email": email, "nombre": info.get("name", ""), "foto": info.get("picture", "")}
    try:
        request.session["user"]["id"] = str(db.registrar_usuario(email, info.get("name", "")))
    except db.BaseDeDatosNoDisponible:
        pass  # BD en descanso: el id se resuelve en el primer request con la BD encendida
    return RedirectResponse("/")


@app.get("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


# ---------- Modelos ----------
class GastoIn(BaseModel):
    id: uuid.UUID | None = Field(default=None, description="Generado por el cliente (idempotencia de la cola offline)")
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
    monto_propio: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2,
                                         description="Parte que pagué yo (solo si es compartido)")

    @model_validator(mode="after")
    def _validar_split(self):
        if not self.es_compartido:
            self.monto_propio = None
        elif self.monto_propio is None:
            self.monto_propio = (self.monto_total / 2).quantize(Decimal("0.01"), ROUND_HALF_UP)
        elif self.monto_propio > self.monto_total:
            raise ValueError("Tu parte no puede ser mayor que el monto total")
        return self


class LiquidarIn(BaseModel):
    liquidado: bool = True


def _salida(g: dict, pendiente: bool) -> dict:
    """Vista pública del gasto (sin metadatos del contrato de eventos)."""
    datos = db.evento(g, "INSERT")
    for interno in ("op_type", "schema_version", "usuario_id"):
        datos.pop(interno)
    return datos | {"fabric_pendiente": pendiente}


def _campos(gasto: GastoIn) -> dict:
    return gasto.model_dump(exclude={"id"})


# ---------- API ----------
@app.get("/api/health")  # /healthz está reservado por el frontend de Cloud Run
def health():
    return {"ok": True}


@app.get("/api/me")
def me(user: Sesion):
    return {k: user.get(k, "") for k in ("email", "nombre", "foto")}


@app.get("/api/gastos")
def listar(user: Usuario, tareas: BackgroundTasks):
    filas = db.listar_gastos(user["id"])
    if any(g["fabric_pendiente"] for g in filas):
        tareas.add_task(outbox.publicar_en_segundo_plano)  # auto-retry
    return [_salida(g, g["fabric_pendiente"]) for g in filas]


@app.post("/api/gastos", status_code=201)
def crear(gasto: GastoIn, user: Usuario):
    registro = _campos(gasto) | {"id": gasto.id or uuid.uuid4(), "fecha_registro": datetime.now(config.TZ)}
    fila, _creado = db.crear_gasto(user["id"], registro)   # (a) PostgreSQL + evento en outbox (misma transacción)
    outbox.publicar_pendientes()               # (b) Fabric, incluye reintento de pendientes viejos
    return _salida(fila, db.fabric_pendiente(fila["id"]))


@app.put("/api/gastos/{gasto_id}")
def editar(gasto_id: uuid.UUID, gasto: GastoIn, user: Usuario):
    fila = db.actualizar_gasto(user["id"], gasto_id, _campos(gasto))
    if not fila:
        raise HTTPException(404, "Gasto no encontrado")
    outbox.publicar_pendientes()
    return _salida(fila, db.fabric_pendiente(gasto_id))


@app.delete("/api/gastos/{gasto_id}", status_code=204)
def eliminar(gasto_id: uuid.UUID, user: Usuario):
    if not db.eliminar_gasto(user["id"], gasto_id):
        raise HTTPException(404, "Gasto no encontrado")
    outbox.publicar_pendientes()


@app.get("/api/kpis/mes")
def kpis_mes(user: Usuario):
    vacio = {"n": 0, "total": 0.0, "hormiga": 0.0, "por_cobrar": 0.0}
    por_moneda = {k["moneda"]: k for k in db.kpis_mes(user["id"])}
    return {m: por_moneda.get(m, vacio | {"moneda": m}) for m in ("PEN", "USD")}


@app.get("/api/por-cobrar")
def listar_por_cobrar(user: Usuario):
    return [_salida(g, False) | {"pendiente": g["pendiente"]} for g in db.por_cobrar(user["id"])]


@app.post("/api/gastos/{gasto_id}/liquidar")
def liquidar(gasto_id: uuid.UUID, body: LiquidarIn, user: Usuario):
    fila = db.marcar_liquidado(user["id"], gasto_id, body.liquidado)
    if not fila:
        raise HTTPException(404, "Gasto compartido no encontrado")
    outbox.publicar_pendientes()
    return _salida(fila, db.fabric_pendiente(gasto_id))


@app.post("/api/fabric/reenviar")
def reenviar(user: Usuario):
    return outbox.publicar_pendientes()


# ---------- IA (Gemini) ----------
MIME_PERMITIDOS = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_IMAGEN = 7 * 1024 * 1024


def _cuota_ia(user: dict, accion: str, limite: int) -> None:
    """429 si el usuario agotó su cuota diaria. Con la BD en descanso no se bloquea (solo invitados)."""
    try:
        permitido = db.consumir_cuota_ia(user["id"], accion, limite)
    except db.BaseDeDatosNoDisponible:
        return
    if not permitido:
        raise HTTPException(429, f"Llegaste al límite diario de {limite} usos de IA. Vuelve mañana.")


def usuario_ia(request: Request, user: Sesion) -> dict:
    """Como usuario_actual, pero sin exigir la BD (el escaneo funciona de noche)."""
    try:
        return usuario_actual(request, user)
    except db.BaseDeDatosNoDisponible:
        return user


class ImagenIn(BaseModel):
    imagen_base64: str = Field(max_length=10_000_000)
    mime_type: str = "image/jpeg"


@app.post("/api/ia/escanear")
def escanear(img: ImagenIn, user: Annotated[dict, Depends(usuario_ia)]):
    if img.mime_type not in MIME_PERMITIDOS:
        raise HTTPException(415, "Formato de imagen no soportado")
    try:
        datos = base64.b64decode(img.imagen_base64.split(",")[-1], validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Imagen inválida")
    if len(datos) > MAX_IMAGEN:
        raise HTTPException(413, "Imagen demasiado grande")
    if user.get("id"):
        _cuota_ia(user, "escanear", config.IA_LIMITE_ESCANEOS_DIA)
    return ia.escanear(datos, img.mime_type)


@app.get("/api/resumen")
def resumen(user: Usuario, dias: int = 30):
    return db.resumen(user["id"], max(7, min(dias, 365)))


@app.post("/api/ia/consejos")
def consejos(user: Usuario, dias: int = 30):
    dias = max(7, min(dias, 365))
    datos = db.resumen(user["id"], dias)
    if not datos["totales"]:
        return {"resumen": "Aún no hay gastos en este período.", "alerta": "",
                "consejos": [{"titulo": "Empieza a registrar", "ahorro_estimado_mensual": 0,
                              "detalle": "Registra tus gastos unos días (usa el escaneo con IA para ir rápido) y vuelve a pedir el análisis."}]}
    _cuota_ia(user, "consejos", config.IA_LIMITE_CONSEJOS_DIA)
    return ia.aconsejar(datos, dias)


# ---------- Frontend (SPA + PWA) ----------
_assets = os.path.join(config.STATIC_DIR, "assets")
if os.path.isdir(_assets):
    app.mount("/assets", StaticFiles(directory=_assets), name="assets")

# Archivos de la raíz del build (service worker, manifest, íconos) — lista blanca
_RAIZ = {"sw.js", "manifest.webmanifest", "registerSW.js", "favicon.svg", "favicon.ico",
         "pwa-64x64.png", "pwa-192x192.png", "pwa-512x512.png", "maskable-icon-512x512.png",
         "apple-touch-icon-180x180.png"}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path in _RAIZ or path.startswith("workbox-"):
        archivo = os.path.join(config.STATIC_DIR, os.path.basename(path))
        if os.path.isfile(archivo):
            # El service worker nunca debe quedar cacheado por el navegador
            headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "registerSW.js") else None
            media = "application/manifest+json" if path.endswith(".webmanifest") else None
            return FileResponse(archivo, headers=headers, media_type=media)
        raise HTTPException(404)
    if path.startswith("api/"):
        raise HTTPException(404)
    index = os.path.join(config.STATIC_DIR, "index.html")
    if os.path.isfile(index):
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend no compilado"}, status_code=404)
