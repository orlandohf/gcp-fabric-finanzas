import { useEffect, useState } from "react";
import { api, fmt } from "./lib.js";
import Stat from "./Stat.jsx";

function sumarPorClave(filas) {
  // Agrupa filas {clave, moneda, total} -> [{clave, PEN, USD}] ordenado por PEN
  const m = {};
  filas.forEach((r) => {
    m[r.clave] ??= { clave: r.clave, PEN: 0, USD: 0 };
    m[r.clave][r.moneda] += r.total;
  });
  return Object.values(m).sort((a, b) => b.PEN - a.PEN || b.USD - a.USD);
}

function Barras({ titulo, filas }) {
  const datos = sumarPorClave(filas);
  const max = Math.max(1, ...datos.map((d) => d.PEN));
  if (!datos.length) return null;
  return (
    <section className="card">
      <h2>{titulo}</h2>
      <ul className="barras">
        {datos.map((d) => (
          <li key={d.clave}>
            <div className="row-between small">
              <span>{d.clave}</span>
              <span className="monto">{fmt(d.PEN)}{d.USD > 0 && ` · ${fmt(d.USD, "USD")}`}</span>
            </div>
            <div className="barra"><span style={{ width: `${(d.PEN / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Resumen() {
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [analisis, setAnalisis] = useState(null);
  const [analizando, setAnalizando] = useState(false);

  useEffect(() => {
    setDatos(null); setError(null); setAnalisis(null);
    api(`/api/resumen?dias=${dias}`).then(setDatos).catch((e) => setError(e.message));
  }, [dias]);

  const analizar = async () => {
    setAnalizando(true); setError(null);
    try { setAnalisis(await api(`/api/ia/consejos?dias=${dias}`, { method: "POST" })); }
    catch (e) { setError(e.message); }
    finally { setAnalizando(false); }
  };

  const tot = (m) => datos?.totales.find((t) => t.moneda === m) || { total: 0, n: 0, compartido: 0, por_cobrar: 0 };
  const hormiga = datos ? sumarPorClave(datos.por_tipo).find((t) => t.clave === "Variable Hormiga")?.PEN || 0 : 0;
  const pen = tot("PEN");

  return (
    <>
      <div className="row-between">
        <div className="segmentado" role="group" aria-label="Período">
          {[7, 30, 90].map((d) => (
            <button key={d} className={dias === d ? "on" : ""} onClick={() => setDias(d)}>{d} días</button>
          ))}
        </div>
      </div>

      {error && <p className="alert">{error}</p>}
      {!datos && !error && <p className="muted center-text">Cargando resumen…</p>}

      {datos && (
        <>
          <section className="stats">
            <Stat label={`Gasto real PEN · ${pen.n}`} valor={fmt(pen.total)} />
            <Stat label="Hormiga" valor={`${fmt(hormiga)}${pen.total ? ` · ${Math.round((hormiga / pen.total) * 100)}%` : ""}`} warn />
            <Stat label="Por cobrar" valor={fmt(pen.por_cobrar)} />
          </section>

          <section className="card ia">
            <div className="row-between">
              <h2>✨ Consejos con IA</h2>
              <button className="btn primary small" onClick={analizar} disabled={analizando}>
                {analizando ? <><span className="spinner" /> Analizando…</> : analisis ? "Volver a analizar" : "Analizar mis gastos"}
              </button>
            </div>
            {!analisis && !analizando && (
              <p className="muted small">Gemini revisa tus gastos de los últimos {dias} días y te sugiere dónde ahorrar. Solo se envían totales agregados, no el detalle de cada gasto.</p>
            )}
            {analisis && (
              <div className="analisis">
                <p>{analisis.resumen}</p>
                {analisis.alerta && <p className="alert warn">⚠️ {analisis.alerta}</p>}
                <ol className="consejos">
                  {analisis.consejos.map((c, i) => (
                    <li key={i}>
                      <strong>{c.titulo}</strong>
                      <p>{c.detalle}</p>
                      {c.ahorro_estimado_mensual > 0 && <span className="tag ok">Ahorro posible: {fmt(c.ahorro_estimado_mensual)}/mes</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          <Barras titulo="Por categoría" filas={datos.por_categoria} />
          <Barras titulo="Por tipo de gasto" filas={datos.por_tipo} />
          <Barras titulo="Por método de pago" filas={datos.por_metodo} />

          {datos.top_hormiga.length > 0 && (
            <section className="card">
              <h2>Top gastos hormiga</h2>
              <ul className="lista">
                {datos.top_hormiga.map((h) => (
                  <li key={h.concepto}>
                    <div><strong className="capital">{h.concepto}</strong><span className="muted small">{h.veces} {h.veces === 1 ? "vez" : "veces"}</span></div>
                    <span className="monto">{fmt(h.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

