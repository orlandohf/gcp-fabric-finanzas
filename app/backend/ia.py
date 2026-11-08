"""Gemini (Vertex AI): escaneo de boucher/foto y consejos sobre los gastos."""
import json
import logging
import os
import threading
from datetime import date, datetime

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

import config

log = logging.getLogger("ia")

CATEGORIAS = ["Alimentación", "Transporte", "Vivienda", "Servicios", "Salud", "Educación",
              "Entretenimiento", "Ropa", "Suscripciones", "Mascotas", "Regalos", "Otros"]
TIPOS = ["Fijo", "Variable Necesario", "Variable Hormiga"]
METODOS = ["TC", "TD", "Yape-Plin", "Efectivo"]

MODELO = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
UBICACION = os.environ.get("GEMINI_LOCATION", "global")
PROYECTO = os.environ.get("GOOGLE_CLOUD_PROJECT", "")


class ErrorIA(Exception):
    pass


_client: genai.Client | None = None
_lock = threading.Lock()


def _cliente() -> genai.Client:
    global _client
    with _lock:
        if _client is None:
            # Usa la Service Account de Cloud Run (roles/aiplatform.user); sin API keys
            _client = genai.Client(vertexai=True, project=PROYECTO, location=UBICACION)
    return _client


def _generar(contenidos, schema, temperatura: float):
    try:
        resp = _cliente().models.generate_content(
            model=MODELO,
            contents=contenidos,
            config=types.GenerateContentConfig(
                temperature=temperatura,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        return json.loads(resp.text)
    except Exception as e:
        log.exception("Error llamando a Gemini")
        raise ErrorIA(str(e)) from e


# ---------- Escaneo de foto / boucher ----------
class Escaneo(BaseModel):
    concepto: str = Field(description="Descripción corta del gasto, ej. 'Almuerzo en Pardos'")
    categoria: str = Field(description=f"Una de: {', '.join(CATEGORIAS)}")
    tipo_gasto: str = Field(description=f"Una de: {', '.join(TIPOS)}")
    metodo_pago: str = Field(description=f"Una de: {', '.join(METODOS)}, o '' si no se ve")
    entidad_financiera: str = Field(description="Banco o billetera si aparece (BCP, Interbank, BBVA, Yape...), o ''")
    moneda: str = Field(description="PEN o USD")
    monto_total: float = Field(description="Monto total pagado; estimado si no es un comprobante")
    cantidad: float = Field(description="Número de unidades/ítems principales; 1 si no aplica")
    fecha_gasto: str = Field(description="Fecha del comprobante en formato YYYY-MM-DD, o '' si no aparece")
    es_comprobante: bool = Field(description="true si la foto es un boucher, ticket, factura o captura de pago")
    confianza: str = Field(description="alta, media o baja")
    nota: str = Field(description="Una frase breve explicando qué se detectó o qué revisar")


PROMPT_ESCANEO = f"""Eres un asistente de finanzas personales en Perú. Analiza la imagen y extrae un gasto.
- Puede ser un boucher/voucher de POS, ticket, boleta, factura, captura de Yape/Plin o banca móvil,
  o una foto de un producto/plato/servicio (en ese caso estima un precio razonable en Perú).
- Si es un comprobante, usa el TOTAL pagado (no subtotales ni IGV por separado).
- "S/" o "PEN" = PEN; "$" o "US$" = USD.
- metodo_pago: TC = tarjeta de crédito, TD = tarjeta de débito, Yape-Plin = billeteras, Efectivo.
  Si el boucher dice "CREDITO"/"VISA CREDIT" usa TC; "DEBITO" usa TD.
- tipo_gasto: Fijo = recurrente mensual (alquiler, servicios, suscripciones, cuotas);
  Variable Necesario = no recurrente pero necesario (supermercado, salud, transporte al trabajo);
  Variable Hormiga = pequeño gasto prescindible y frecuente (snacks, café, delivery, antojos).
- categoria debe ser exactamente una de: {', '.join(CATEGORIAS)}.
- Hoy es {{hoy}} (America/Lima). Responde en español."""


def _normalizar(e: dict) -> dict:
    def elegir(valor, opciones, defecto):
        return valor if valor in opciones else defecto

    return {
        "concepto": (e.get("concepto") or "").strip()[:200],
        "categoria": elegir(e.get("categoria"), CATEGORIAS, "Otros"),
        "tipo_gasto": elegir(e.get("tipo_gasto"), TIPOS, "Variable Necesario"),
        "metodo_pago": elegir(e.get("metodo_pago"), METODOS, ""),
        "entidad_financiera": (e.get("entidad_financiera") or "").strip()[:60],
        "moneda": elegir((e.get("moneda") or "").upper(), ["PEN", "USD"], "PEN"),
        "monto_total": round(max(float(e.get("monto_total") or 0), 0), 2),
        "cantidad": round(max(float(e.get("cantidad") or 1), 0.01), 2),
        "fecha_gasto": _fecha_valida(e.get("fecha_gasto")),
        "es_comprobante": bool(e.get("es_comprobante")),
        "confianza": elegir(e.get("confianza"), ["alta", "media", "baja"], "media"),
        "nota": (e.get("nota") or "")[:300],
    }


def _fecha_valida(valor) -> str:
    """Acepta YYYY-MM-DD o DD/MM/YYYY (formato peruano); descarta fechas futuras o muy antiguas."""
    texto = str(valor or "").strip()
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            d = datetime.strptime(texto, formato).date()
            break
        except ValueError:
            continue
    else:
        return ""
    hoy = datetime.now(config.TZ).date()
    return d.isoformat() if (hoy - d).days <= 400 and d <= hoy else ""


def escanear(imagen: bytes, mime_type: str) -> dict:
    hoy = datetime.now(config.TZ).date().isoformat()
    datos = _generar(
        [types.Part.from_bytes(data=imagen, mime_type=mime_type), PROMPT_ESCANEO.replace("{hoy}", hoy)],
        Escaneo,
        temperatura=0.1,
    )
    return _normalizar(datos)


# ---------- Consejos sobre el resumen ----------
class Consejo(BaseModel):
    titulo: str
    detalle: str
    ahorro_estimado_mensual: float = Field(description="Ahorro mensual estimado en PEN si aplica el consejo; 0 si no aplica")


class Analisis(BaseModel):
    resumen: str = Field(description="2-3 frases describiendo el patrón de gasto")
    alerta: str = Field(description="El hallazgo más importante a vigilar, o '' si no hay")
    consejos: list[Consejo] = Field(description="3 a 5 consejos concretos y accionables")


PROMPT_CONSEJOS = """Eres un asesor de finanzas personales en Perú, cercano y directo.
Analiza este resumen de gastos de los últimos {dias} días (montos agregados, JSON) y da consejos
específicos basados en los datos: menciona categorías, montos y porcentajes reales.
Presta atención especial a los gastos hormiga, el uso de tarjeta de crédito (TC) y los gastos compartidos.
No inventes ingresos ni datos que no estén. Si hay pocos datos, dilo y sugiere qué registrar.
Montos en PEN salvo que se indique USD. Responde en español, tuteando.

Datos:
{datos}"""


def aconsejar(resumen: dict, dias: int) -> dict:
    datos = json.dumps(resumen, ensure_ascii=False, default=str)
    return _generar(PROMPT_CONSEJOS.format(dias=dias, datos=datos), Analisis, temperatura=0.4)
