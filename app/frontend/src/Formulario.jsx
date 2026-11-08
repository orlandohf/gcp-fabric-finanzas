import { useEffect, useRef, useState } from "react";
import { IcoCamara } from "./iconos.jsx";
import { CATEGORIAS, ENTIDADES, METODOS, TIPOS, api, etiquetaDia, hoyLima, metaCategoria, prepararImagen, store } from "./lib.js";

// Defaults = la respuesta más común (skill /form-design): se recuerdan los últimos usados
const recordados = () => ({
  metodo_pago: store.get("ultimo_metodo") || "TD",
  entidad_financiera: store.get("ultima_entidad") || "",
  moneda: store.get("ultima_moneda") || "PEN",
});

export const vacio = () => ({
  fecha_gasto: hoyLima(),
  categoria: "",
  concepto: "",
  tipo_gasto: "Variable Necesario",
  cantidad: "1",
  monto_total: "",
  es_compartido: false,
  modo_split: "mitad", // "mitad" | "monto"
  monto_propio: "",
  ...recordados(),
});

// Categorías que casi siempre son gasto fijo mensual
const TIPO_POR_CATEGORIA = { Vivienda: "Fijo", Servicios: "Fijo", Suscripciones: "Fijo", "Educación": "Fijo" };

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
  "Fijo": "Cada mes",
  "Variable Necesario": "Hace falta",
  "Variable Hormiga": "Antojo",
};

function validar(f) {
  const e = {};
  if (!(Number(f.monto_total) > 0)) e.monto_total = "Escribe cuánto gastaste.";
  if (!f.concepto.trim()) e.concepto = "Cuéntame en qué fue (ej. almuerzo, taxi).";
  if (!f.categoria.trim()) e.categoria = "Elige una categoría.";
  if (f.es_compartido && f.modo_split === "monto") {
    const p = Number(f.monto_propio);
    if (!(p >= 0) || f.monto_propio === "") e.monto_propio = "Escribe cuánto es tuyo.";
    else if (p > Number(f.monto_total)) e.monto_propio = "Tu parte no puede ser mayor que el total.";
  }
  return e;
}

/**
 * inline = registro rápido en el inicio (acción principal).
 * Sin inline = dentro del bottom sheet (edición o escaneo).
 */
export default function Formulario({ editando, archivoInicial, inline, onGuardar, onEliminar, onError }) {
  const [f, setF] = useState(() => (editando ? aFormulario(editando) : vacio()));
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [deteccion, setDeteccion] = useState(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [masAbierto, setMasAbierto] = useState(!inline);
  const [tipoTocado, setTipoTocado] = useState(!!editando);
  const [otraCategoria, setOtraCategoria] = useState(() => !!editando && !CATEGORIAS.includes(editando.categoria));
  const fileRef = useRef(null);
  const montoRef = useRef(null);

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setF((p) => ({ ...p, [k]: v }));
    if (errores[k]) setErrores((er) => ({ ...er, [k]: undefined }));
  };
  const elegir = (k, v) => { setF((p) => ({ ...p, [k]: v })); if (errores[k]) setErrores((er) => ({ ...er, [k]: undefined })); };

  const elegirCategoria = (c) => {
    setOtraCategoria(false);
    setF((p) => ({ ...p, categoria: c, tipo_gasto: tipoTocado ? p.tipo_gasto : TIPO_POR_CATEGORIA[c] || "Variable Necesario" }));
    setErrores((er) => ({ ...er, categoria: undefined }));
  };

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
      setTipoTocado(true);
      setErrores({});
      setDeteccion(r);
    } catch (err) {
      onError(err.status === undefined ? "El escaneo necesita conexión a internet." : `Escaneo: ${err.message}`);
    } finally {
      setEscaneando(false);
    }
  };

  // Escaneo lanzado desde fuera (el archivo ya fue elegido con un gesto del usuario)
  useEffect(() => { if (archivoInicial) escanear(archivoInicial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async (e) => {
    e.preventDefault();
    const er = validar(f);
    setErrores(er);
    if (Object.keys(er).length) {
      if (er.monto_propio) setMasAbierto(true);
      return;
    }
    setEnviando(true);
    try {
      const ok = await onGuardar(aPayload(f));
      if (ok) {
        store.set("ultimo_metodo", f.metodo_pago);
        store.set("ultima_entidad", f.entidad_financiera);
        store.set("ultima_moneda", f.moneda);
        if (inline) {
          // Ráfaga: se conservan fecha, método, entidad y moneda
          setF((p) => ({ ...vacio(), fecha_gasto: p.fecha_gasto, metodo_pago: p.metodo_pago,
            entidad_financiera: p.entidad_financiera, moneda: p.moneda }));
          setDeteccion(null);
          setTipoTocado(false);
          setOtraCategoria(false);
          setMasAbierto(false);
          montoRef.current?.focus({ preventScroll: true });
        }
      }
    } finally {
      setEnviando(false);
    }
  };

  const total = Number(f.monto_total) || 0;
  const miParte = f.modo_split === "mitad" ? total / 2 : Number(f.monto_propio) || 0;
  const simbolo = f.moneda === "PEN" ? "S/" : "US$";
  const resumenMas = [
    etiquetaDia(f.fecha_gasto),
    f.es_compartido ? "Compartido" : null,
    Number(f.cantidad) > 1 ? `× ${f.cantidad}` : null,
    f.entidad_financiera || null,
  ].filter(Boolean).join(" · ");
  const err = (k) => errores[k] && <p className="error-campo" id={`err-${k}`} role="alert">{errores[k]}</p>;

  return (
    <form className={`form-gasto ${inline ? "inline" : ""}`} onSubmit={guardar} noValidate>
      {escaneando && (
        <div className="escaneando" role="status">
          <span className="spinner grande" />
          <strong>Leyendo tu foto…</strong>
          <span className="muted small">Gemini está detectando monto, categoría y método de pago</span>
        </div>
      )}

      {inline && (
        <div className="form-titulo">
          <h2>Registrar gasto</h2>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { escanear(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn chip-accion" onClick={() => fileRef.current?.click()} disabled={escaneando}>
            <IcoCamara size={16} /> Escanear
          </button>
        </div>
      )}

      {deteccion && (
        <p className={`alert ${deteccion.confianza === "baja" ? "warn" : "ok"}`}>
          <strong>{deteccion.es_comprobante ? "✓ Comprobante leído" : "≈ Monto estimado"}</strong>
          {" · confianza "}{deteccion.confianza}. {deteccion.nota} Revisa y guarda.
        </p>
      )}

      {/* 1. Monto: lo primero y más grande */}
      <div className="monto-fila">
        <label className={`monto-grande ${errores.monto_total ? "con-error" : ""}`}>
          <span className="sr-only">Monto total en {f.moneda}</span>
          <span className="simbolo" aria-hidden="true">{simbolo}</span>
          <input ref={montoRef} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
            aria-invalid={!!errores.monto_total} aria-describedby={errores.monto_total ? "err-monto_total" : undefined}
            value={f.monto_total} onChange={set("monto_total")} />
        </label>
        <div className="segmentado mini" role="group" aria-label="Moneda">
          {["PEN", "USD"].map((m) => (
            <button type="button" key={m} className={f.moneda === m ? "on" : ""} aria-pressed={f.moneda === m}
              onClick={() => elegir("moneda", m)}>{m}</button>
          ))}
        </div>
      </div>
      {err("monto_total")}

      {/* 2. Concepto */}
      <label className="campo">¿En qué fue?
        <input maxLength={200} value={f.concepto} onChange={set("concepto")} placeholder="Ej. almuerzo, taxi, Netflix"
          aria-invalid={!!errores.concepto} aria-describedby={errores.concepto ? "err-concepto" : undefined} />
        {err("concepto")}
      </label>

      {/* 3. Categoría */}
      <fieldset className="campo" aria-describedby={errores.categoria ? "err-categoria" : undefined}>
        <legend>Categoría</legend>
        <div className="chips scroll">
          {CATEGORIAS.map((c) => {
            const m = metaCategoria(c);
            const on = !otraCategoria && f.categoria === c;
            return (
              <button type="button" key={c} className={`chip cat ${on ? "on" : ""}`} style={{ "--h": m.h }} aria-pressed={on}
                onClick={() => elegirCategoria(c)}>
                <span aria-hidden="true">{m.emoji}</span> {c}
              </button>
            );
          })}
          <button type="button" className={`chip ${otraCategoria ? "on" : ""}`} aria-pressed={otraCategoria}
            onClick={() => { setOtraCategoria(true); elegir("categoria", ""); }}>✏️ Otra</button>
        </div>
        {otraCategoria && (
          <input className="mt" maxLength={60} value={f.categoria} onChange={set("categoria")} placeholder="Nombre de la categoría" autoFocus />
        )}
        {err("categoria")}
      </fieldset>

      {/* 4. Método de pago (recordado) */}
      <fieldset className="campo">
        <legend>¿Cómo pagaste?</legend>
        <div className="segmentado metodos" role="group">
          {METODOS.map((m) => (
            <button type="button" key={m} className={f.metodo_pago === m ? "on" : ""} aria-pressed={f.metodo_pago === m}
              onClick={() => elegir("metodo_pago", m)}>{m}</button>
          ))}
        </div>
      </fieldset>

      {/* 5. Tipo (inferido de la categoría hasta que se toque) */}
      <fieldset className="campo">
        <legend>Tipo de gasto</legend>
        <div className="segmentado tipos" role="group">
          {TIPOS.map((t) => (
            <button type="button" key={t} className={`${f.tipo_gasto === t ? "on" : ""} ${t === "Variable Hormiga" ? "hormiga" : ""}`}
              aria-pressed={f.tipo_gasto === t} onClick={() => { setTipoTocado(true); elegir("tipo_gasto", t); }}>
              <strong>{t.replace("Variable ", "")}</strong>
              <small>{AYUDA_TIPO[t]}</small>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Opcionales plegados, con resumen de sus valores actuales */}
      <div className={`detalles ${masAbierto ? "abierto" : ""}`}>
        <button type="button" className="detalles-cabecera" aria-expanded={masAbierto} onClick={() => setMasAbierto((v) => !v)}>
          <span>Más opciones</span>
          <span className="muted small">{resumenMas}</span>
        </button>
        {masAbierto && (
          <div className="detalles-cuerpo">
            <label className="campo">Fecha
              <div className="fecha-fila">
                <input type="date" value={f.fecha_gasto} max={hoyLima()} onChange={set("fecha_gasto")} />
                <span className="muted small">{etiquetaDia(f.fecha_gasto)}</span>
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
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={f.monto_propio} onChange={set("monto_propio")}
                      placeholder="0.00" aria-invalid={!!errores.monto_propio} />
                    {err("monto_propio")}
                  </label>
                )}
                <div className="split-resumen">
                  <span>Tu gasto<strong>{simbolo} {miParte.toFixed(2)}</strong></span>
                  <span>Te deben<strong>{simbolo} {Math.max(total - miParte, 0).toFixed(2)}</strong></span>
                </div>
              </div>
            )}

            <div className="fila-2">
              <label className="campo">Cantidad
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.cantidad} onChange={set("cantidad")} />
              </label>
              <label className="campo">Banco / billetera
                <input list="entidades" maxLength={60} value={f.entidad_financiera} onChange={set("entidad_financiera")} placeholder="BCP, Yape…" />
                <datalist id="entidades">{ENTIDADES.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="form-acciones">
        <button className="btn primary block grande" disabled={enviando || escaneando}>
          {enviando ? <><span className="spinner" /> Guardando…</>
            : editando ? "Guardar cambios"
            : total > 0 ? `Guardar ${simbolo} ${total.toFixed(2)}` : "Guardar gasto"}
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
