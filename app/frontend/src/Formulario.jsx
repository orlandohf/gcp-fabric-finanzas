import { useEffect, useRef, useState } from "react";
import { CATEGORIAS, ENTIDADES, METODOS, TIPOS, api, hoyLima, prepararImagen } from "./lib.js";

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
  modo_split: g.es_compartido && g.monto_propio !== null && Math.abs(g.monto_propio * 2 - g.monto_total) > 0.01 ? "monto" : "mitad",
  monto_propio: g.monto_propio !== null && g.monto_propio !== undefined ? String(g.monto_propio) : "",
});

/** Estado del formulario → cuerpo para la API. */
export function aPayload(f) {
  const total = Number(f.monto_total);
  let propio = null;
  if (f.es_compartido) propio = f.modo_split === "mitad" ? Math.round(total * 50) / 100 : Number(f.monto_propio);
  return {
    fecha_gasto: f.fecha_gasto, categoria: f.categoria, concepto: f.concepto, tipo_gasto: f.tipo_gasto,
    metodo_pago: f.metodo_pago, entidad_financiera: f.entidad_financiera, moneda: f.moneda,
    cantidad: Number(f.cantidad), monto_total: total, es_compartido: f.es_compartido, monto_propio: propio,
  };
}

export default function Formulario({ editando, onGuardar, onEliminar, onCancelar, onError }) {
  const [f, setF] = useState(() => (editando ? aFormulario(editando) : vacio()));
  const [enviando, setEnviando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [deteccion, setDeteccion] = useState(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setF(editando ? aFormulario(editando) : vacio());
    setDeteccion(null);
    setConfirmarBorrado(false);
  }, [editando]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const escanear = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
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
      setDeteccion(r);
    } catch (err) {
      onError(err.status === undefined ? "El escaneo necesita conexión a internet." : `Escaneo: ${err.message}`);
    } finally {
      setEscaneando(false);
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    const payload = aPayload(f);
    if (payload.es_compartido && payload.monto_propio > payload.monto_total) {
      onError("Tu parte no puede ser mayor que el monto total.");
      return;
    }
    setEnviando(true);
    try {
      const ok = await onGuardar(payload);
      if (ok && !editando) {
        setDeteccion(null);
        setF({ ...vacio(), fecha_gasto: f.fecha_gasto, metodo_pago: f.metodo_pago, entidad_financiera: f.entidad_financiera });
      }
    } finally {
      setEnviando(false);
    }
  };

  const total = Number(f.monto_total) || 0;
  const miParte = f.modo_split === "mitad" ? total / 2 : Number(f.monto_propio) || 0;

  return (
    <form className={`card form ${editando ? "editando" : ""}`} onSubmit={guardar}>
      <div className="row-between full">
        <h2>{editando ? "Editar gasto" : "Nuevo gasto"}</h2>
        {editando && <button type="button" className="btn ghost small" onClick={onCancelar}>Cancelar</button>}
      </div>

      {!editando && (
        <div className="full">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={escanear} />
          <button type="button" className="btn scan block" disabled={escaneando} onClick={() => fileRef.current?.click()}>
            {escaneando ? <><span className="spinner" /> Analizando foto…</> : <>📷 Escanear foto o boucher con IA</>}
          </button>
          {deteccion && (
            <p className={`alert ${deteccion.confianza === "baja" ? "warn" : "ok"} deteccion`}>
              <strong>{deteccion.es_comprobante ? "Comprobante detectado" : "Monto estimado"}</strong>
              {" · confianza "}{deteccion.confianza}. {deteccion.nota} Revisa los datos y guarda.
            </p>
          )}
        </div>
      )}

      <label className="full">Concepto
        <input required maxLength={200} value={f.concepto} onChange={set("concepto")} placeholder="Ej. Almuerzo menú" />
      </label>

      <label>Monto total
        <div className="monto-input">
          <select value={f.moneda} onChange={set("moneda")} aria-label="Moneda">
            <option>PEN</option><option>USD</option>
          </select>
          <input required type="number" inputMode="decimal" min="0" step="0.01"
            value={f.monto_total} onChange={set("monto_total")} placeholder="0.00" />
        </div>
      </label>

      <label>Cantidad
        <input required type="number" inputMode="decimal" min="0.01" step="0.01" value={f.cantidad} onChange={set("cantidad")} />
      </label>

      <label>Fecha del gasto
        <input required type="date" value={f.fecha_gasto} onChange={set("fecha_gasto")} />
      </label>

      <label>Categoría
        <input required list="categorias" maxLength={60} value={f.categoria} onChange={set("categoria")} placeholder="Elige o escribe" />
        <datalist id="categorias">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
      </label>

      <fieldset className="full">
        <legend>Tipo de gasto</legend>
        <div className="chips">
          {TIPOS.map((t) => (
            <button type="button" key={t} className={`chip ${f.tipo_gasto === t ? "on" : ""}`}
              aria-pressed={f.tipo_gasto === t} onClick={() => setF({ ...f, tipo_gasto: t })}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="full">
        <legend>Método de pago</legend>
        <div className="chips">
          {METODOS.map((m) => (
            <button type="button" key={m} className={`chip ${f.metodo_pago === m ? "on" : ""}`}
              aria-pressed={f.metodo_pago === m} onClick={() => setF({ ...f, metodo_pago: m })}>{m}</button>
          ))}
        </div>
      </fieldset>

      <label>Entidad financiera
        <input list="entidades" maxLength={60} value={f.entidad_financiera} onChange={set("entidad_financiera")} placeholder="Opcional" />
        <datalist id="entidades">{ENTIDADES.map((c) => <option key={c} value={c} />)}</datalist>
      </label>

      <label className="check">
        <input type="checkbox" checked={f.es_compartido} onChange={set("es_compartido")} />
        Gasto compartido
      </label>

      {f.es_compartido && (
        <div className="full split">
          <div className="segmentado" role="group" aria-label="Cómo se divide">
            <button type="button" className={f.modo_split === "mitad" ? "on" : ""} onClick={() => setF({ ...f, modo_split: "mitad" })}>50 / 50</button>
            <button type="button" className={f.modo_split === "monto" ? "on" : ""} onClick={() => setF({ ...f, modo_split: "monto" })}>Mi parte</button>
          </div>
          {f.modo_split === "monto" && (
            <label>¿Cuánto es tuyo?
              <input required type="number" inputMode="decimal" min="0" step="0.01" max={f.monto_total || undefined}
                value={f.monto_propio} onChange={set("monto_propio")} placeholder="0.00" />
            </label>
          )}
          <p className="muted small">
            Tu gasto real: <strong>{miParte.toFixed(2)}</strong> · Por cobrar: <strong>{Math.max(total - miParte, 0).toFixed(2)}</strong> {f.moneda}
          </p>
        </div>
      )}

      <button className="btn primary block full" disabled={enviando}>
        {enviando ? "Guardando…" : editando ? "Guardar cambios" : "Guardar gasto"}
      </button>

      {editando && (
        <div className="full borrar">
          {!confirmarBorrado ? (
            <button type="button" className="btn peligro-ghost block" onClick={() => setConfirmarBorrado(true)}>Eliminar gasto</button>
          ) : (
            <div className="confirmar" role="alert">
              <span>¿Eliminar «{editando.concepto}»? No se puede deshacer.</span>
              <div className="acciones">
                <button type="button" className="btn ghost small" onClick={() => setConfirmarBorrado(false)}>No</button>
                <button type="button" className="btn peligro small" onClick={() => onEliminar(editando)}>Sí, eliminar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
