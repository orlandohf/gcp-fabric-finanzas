import { useEffect, useState } from "react";
import { api, fmt, metaCategoria } from "./lib.js";

export default function PorCobrar({ onCambio }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const cargar = () => api("/api/por-cobrar").then(setItems).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const alternar = async (g) => {
    try {
      await api(`/api/gastos/${g.id}/liquidar`, { method: "POST", body: JSON.stringify({ liquidado: !g.liquidado }) });
      await cargar();
      onCambio();
    } catch (e) { setError(e.message); }
  };

  if (error) return <p className="alert warn">{error}</p>;
  if (!items) return <div className="card"><span className="skeleton linea" /><span className="skeleton linea corta mt" /></div>;

  const pendientes = items.filter((g) => !g.liquidado);
  const totales = pendientes.reduce((acc, g) => ({ ...acc, [g.moneda]: (acc[g.moneda] || 0) + g.pendiente }), {});

  return (
    <>
      <section className="card">
        <span className="muted small">Te deben en total</span>
        <p className="total-cobrar">
          {pendientes.length ? Object.entries(totales).map(([m, v]) => fmt(v, m)).join(" · ") : fmt(0)}
        </p>
        <span className="muted small">
          {pendientes.length ? `${pendientes.length} gasto${pendientes.length > 1 ? "s" : ""} por cobrar` : "Nadie te debe nada 🎉"}
        </span>
      </section>

      {items.length === 0 ? (
        <div className="vacio">
          <span className="vacio-emoji">🤝</span>
          <strong>Sin gastos compartidos</strong>
          <span className="muted">Al registrar un gasto, activa «Gasto compartido» para llevar la cuenta aquí.</span>
        </div>
      ) : (
        <section className="grupo">
          <ul className="lista">
            {items.map((g) => {
              const m = metaCategoria(g.categoria);
              return (
                <li key={g.id} className={`cobro ${g.liquidado ? "liquidado" : ""}`}>
                  <span className="avatar-cat" style={{ "--h": m.h }} aria-hidden="true">{m.emoji}</span>
                  <span className="fila-texto">
                    <strong>{g.concepto}</strong>
                    <span className="muted small">{g.fecha_gasto} · total {fmt(g.monto_total, g.moneda)} · tu parte {fmt(g.monto_propio, g.moneda)}</span>
                    <button className={`btn small ${g.liquidado ? "ghost" : "primary"}`} onClick={() => alternar(g)}>
                      {g.liquidado ? "Deshacer" : "✓ Ya me pagaron"}
                    </button>
                  </span>
                  <span className="fila-monto"><strong>{fmt(g.pendiente, g.moneda)}</strong></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
