import { useEffect, useRef, useState } from "react";
import { IcoCamara } from "./iconos.jsx";
import { CATEGORIAS, ENTIDADES, METODOS, TIPOS, api, etiquetaDia, hoyLima, metaCategoria, prepararImagen } from "./lib.js";

export const vacio = () => ({
  fecha_gasto: hoyLima(),
  categoria: "",
  concepto: "",
  tipo_gasto: "Variable Necesario",
  metodo_pago: "TD",
  entidad_financiera: "",
  moneda: "PEN",
  cantidad: "1",
  monto_total: "",
  es_compartido: false,
  modo_split: "mitad", // "mitad" | "monto"
  monto_propio: "",
});

/** Gasto de la API → estado del formulario (para editar). */
export const aFormulario = (g) => ({
  ...vacio(),
  ...g,
  cantidad: String(g.cantidad),
  monto_total: String(g.monto_total),
  modo_split: g.es_compartido && g.monto_propio != null && Math.abs(g.monto_propio * 2 - g.monto_total) > 0.01 ? "monto" : "mitad",
  monto_propio: g.monto_propio != null ? String(g.monto_propio) : "",
});

/** Estado del formulario → cuerpo para la API. */
export function aPayload(f) {
  const total = Number(f.monto_total);
  let propio = null;
  if (f.es_compartido) propio = f.modo_split === "mitad" ? Math.round(total * 50) / 100 : Number(f.monto_propio);
  return {
    fecha_gasto: f.fecha_gasto, categoria: f.categoria.trim(), concepto: f.concepto.trim(), tipo_gasto: f.tipo_gasto,
    metodo_pago: f.metodo_pago, entidad_financiera: f.entidad_financiera.trim(), moneda: f.moneda,
    cantidad: Number(f.cantidad), monto_total: total, es_compartido: f.es_compartido, monto_propio: propio,
  };
}

const AYUDA_TIPO = {
  "Fijo": "Se repite cada mes",
  "Variable Necesario": "No es mensual, pero hace falta",
  "Variable Hormiga": "Pequeño antojo que se acumula",
};

export default function Formulario({ editando, archivoInicial, onGuardar, onEliminar, onError }) {
  const [f, setF] = useState(() => (editando ? aFormulario(editando) : vacio()));
  const [enviando, setEnviando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [deteccion, setDeteccion] = useState(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [otraCategoria, setOtraCategoria] = useState(() => !!editando && !CATEGORIAS.includes(editando.categoria));
  const fileRef = useRef(null);
  const montoRef = useRef(null);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const elegir = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const escanear = async (file) => {
    if (!file) return;
    setEscaneando(true);
    setDeteccion(null);
    try {
      const r = await api("/api/ia/escanear", { method: "POST", body: JSON.stringify(await prepararImagen(file)) });
      setF((prev) => ({
        ...prev,
        concepto: r.concepto || prev.concepto,
        categoria: r.categoria || prev.categoria,
        tipo_gasto: r.tipo_gasto || prev.tipo_gasto,
        metodo_pago: r.metodo_pago || prev.metodo_pago,
        entidad_financiera: r.entidad_financiera || prev.entidad_financiera,
        moneda: r.moneda || prev.moneda,
        monto_total: r.monto_total ? String(r.monto_total) : prev.monto_total,
        cantidad: r.cantidad ? String(r.cantidad) : prev.cantidad,
        fecha_gasto: r.fecha_gasto || prev.fecha_gasto,
      }));
      setOtraCategoria(false);
      setDeteccion(r);
    } catch (err) {
      onError(err.status === undefined ? "El escaneo necesita conexión a internet." : `Escaneo: ${err.message}`);
    } finally {
      setEscaneando(false);
    }
  };

  // Escaneo lanzado desde el botón "Escanear" del inicio (el archivo ya fue elegido con un gesto del usuario)
  useEffect(() => { if (archivoInicial) escanear(archivoInicial); else if (!editando) montoRef.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async (e) => {
    e.preventDefault();
    const payload = aPayload(f);
    if (!payload.categoria) return onError("Elige una categoría.");
    if (payload.es_compartido && payload.monto_propio > payload.monto_total) return onError("Tu parte no puede ser mayor que el monto total.");
    setEnviando(true);
    try { await onGuardar(payload); } finally { setEnviando(false); }
  };

  const total = Number(f.monto_total) || 0;
  const miParte = f.modo_split === "mitad" ? total / 2 : Number(f.monto_propio) || 0;
  const simbolo = f.moneda === "PEN" ? "S/" : "US$";
  const resumenDetalles = [`Cant. ${f.cantidad || 1}`, f.entidad_financiera || "Sin entidad"].join(" · ");

  return (
    <form className="form-gasto" onSubmit={guardar}>
      {escaneando && (
        <div className="escaneando" role="status">
          <span className="spinner grande" />
          <strong>Leyendo tu foto…</strong>
          <span className="muted small">Gemini está detectando monto, categoría y método de pago</span>
        </div>
      )}

      {deteccion && (
        <p className={`alert ${deteccion.confianza === "baja" ? "warn" : "ok"}`}>
          <strong>{deteccion.es_comprobante ? "✓ Comprobante leído" : "≈ Monto estimado"}</strong>
          {" · confianza "}{deteccion.confianza}. {deteccion.nota} Revisa y guarda.
        </p>
      )}

      {/* Monto primero: es lo que más importa y lo que más se escribe */}
      <div className="monto-hero">
        <div className="segmentado mini" role="group" aria-label="Moneda">
          {["PEN", "USD"].map((m) => (
            <button type="button" key={m} className={f.moneda === m ? "on" : ""} aria-pressed={f.moneda === m}
              onClick={() => elegir("moneda", m)}>{m}</button>
          ))}
        </div>
        <label className="monto-grande">
          <span className="simbolo" aria-hidden="true">{simbolo}</span>
          <input ref={montoRef} required type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            aria-label={`Monto total en ${f.moneda}`} value={f.monto_total} onChange={set("monto_total")} />
        </label>
        {!editando && !escaneando && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => { escanear(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="btn link" onClick={() => fileRef.current?.click()}>
              <IcoCamara size={18} /> Llenar con una foto
            </button>
          </>
        )}
      </div>

      <label className="campo">¿En qué fue?
        <input required maxLength={200} value={f.concepto} onChange={set("concepto")} placeholder="Ej. Almuerzo menú, taxi al trabajo" />
      </label>

      <fieldset className="campo">
        <legend>Categoría</legend>
        <div className="chips scroll">
          {CATEGORIAS.map((c) => {
            const m = metaCategoria(c);
            const on = !otraCategoria && f.categoria === c;
            return (
              <button type="button" key={c} className={`chip cat ${on ? "on" : ""}`} style={{ "--h": m.h }} aria-pressed={on}
                onClick={() => { setOtraCategoria(false); elegir("categoria", c); }}>
                <span aria-hidden="true">{m.emoji}</span> {c}
              </button>
            );
          })}
          <button type="button" className={`chip ${otraCategoria ? "on" : ""}`} aria-pressed={otraCategoria}
            onClick={() => { setOtraCategoria(true); elegir("categoria", ""); }}>✏️ Otra</button>
        </div>
        {otraCategoria && (
          <input className="mt" required maxLength={60} value={f.categoria} onChange={set("categoria")} placeholder="Nombre de la categoría" autoFocus />
        )}
      </fieldset>

      <fieldset className="campo">
        <legend>Tipo de gasto</legend>
        <div className="opciones-tipo">
          {TIPOS.map((t) => (
            <button type="button" key={t} className={`opcion ${f.tipo_gasto === t ? "on" : ""} ${t === "Variable Hormiga" ? "hormiga" : ""}`}
              aria-pressed={f.tipo_gasto === t} onClick={() => elegir("tipo_gasto", t)}>
              <strong>{t.replace("Variable ", "")}</strong>
              <span>{AYUDA_TIPO[t]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="campo">
        <legend>Método de pago</legend>
        <div className="chips">
          {METODOS.map((m) => (
            <button type="button" key={m} className={`chip ${f.metodo_pago === m ? "on" : ""}`}
              aria-pressed={f.metodo_pago === m} onClick={() => elegir("metodo_pago", m)}>{m}</button>
          ))}
        </div>
      </fieldset>

      <label className="campo">Fecha
        <div className="fecha-fila">
          <input required type="date" value={f.fecha_gasto} max={hoyLima()} onChange={set("fecha_gasto")} />
          <span className="muted small">{f.fecha_gasto && etiquetaDia(f.fecha_gasto)}</span>
        </div>
      </label>

      <label className="switch-fila">
        <span>
          <strong>Gasto compartido</strong>
          <span className="muted small">Cuenta solo tu parte y lleva lo que te deben</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={f.es_compartido} onChange={set("es_compartido")} />
      </label>

      {f.es_compartido && (
        <div className="split">
          <div className="segmentado" role="group" aria-label="Cómo se divide">
            <button type="button" className={f.modo_split === "mitad" ? "on" : ""} onClick={() => elegir("modo_split", "mitad")}>50 / 50</button>
            <button type="button" className={f.modo_split === "monto" ? "on" : ""} onClick={() => elegir("modo_split", "monto")}>Mi parte</button>
          </div>
          {f.modo_split === "monto" && (
            <label className="campo">¿Cuánto es tuyo?
              <input required type="number" inputMode="decimal" min="0" step="0.01" max={f.monto_total || undefined}
                value={f.monto_propio} onChange={set("monto_propio")} placeholder="0.00" />
            </label>
          )}
          <div className="split-resumen">
            <span>Tu gasto<strong>{simbolo} {miParte.toFixed(2)}</strong></span>
            <span>Te deben<strong>{simbolo} {Math.max(total - miParte, 0).toFixed(2)}</strong></span>
          </div>
        </div>
      )}

      <details className="detalles">
        <summary><span>Más detalles</span><span className="muted small">{resumenDetalles}</span></summary>
        <div className="detalles-cuerpo">
          <label className="campo">Cantidad
            <input required type="number" inputMode="decimal" min="0.01" step="0.01" value={f.cantidad} onChange={set("cantidad")} />
          </label>
          <label className="campo">Entidad financiera
            <input list="entidades" maxLength={60} value={f.entidad_financiera} onChange={set("entidad_financiera")} placeholder="BCP, Yape…" />
            <datalist id="entidades">{ENTIDADES.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        </div>
      </details>

      <div className="form-acciones">
        <button className="btn primary block grande" disabled={enviando || escaneando}>
          {enviando ? <><span className="spinner" /> Guardando…</> : editando ? "Guardar cambios" : "Guardar gasto"}
        </button>
        {editando && (!confirmarBorrado ? (
          <button type="button" className="btn link peligro-texto" onClick={() => setConfirmarBorrado(true)}>Eliminar este gasto</button>
        ) : (
          <div className="confirmar" role="alert">
            <span>¿Eliminar «{editando.concepto}»? No se puede deshacer.</span>
            <div className="acciones">
              <button type="button" className="btn ghost small" onClick={() => setConfirmarBorrado(false)}>No</button>
              <button type="button" className="btn peligro small" onClick={() => onEliminar(editando)}>Sí, eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </form>
  );
}
