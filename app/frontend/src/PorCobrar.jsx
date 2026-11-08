import { useEffect, useState } from "react";
import { api, fmt } from "./lib.js";

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

  if (error) return <p className="alert">{error}</p>;
  if (!items) return <p className="muted center-text">Cargando…</p>;

  const pendientes = items.filter((g) => !g.liquidado);
  const totales = pendientes.reduce((acc, g) => ({ ...acc, [g.moneda]: (acc[g.moneda] || 0) + g.pendiente }), {});

  return (
    <>
      <section className="card">
        <h2>Por cobrar</h2>
        {pendientes.length === 0
          ? <p className="muted">Nadie te debe nada 🎉. Marca un gasto como compartido para llevar la cuenta.</p>
          : <p className="total-cobrar">{Object.entries(totales).map(([m, v]) => fmt(v, m)).join(" · ")}</p>}
      </section>

      {items.length > 0 && (
        <section className="card">
          <ul className="lista">
            {items.map((g) => (
              <li key={g.id} className={g.liquidado ? "liquidado" : ""}>
                <div>
                  <strong>{g.concepto}</strong>
                  <span className="muted small">{g.fecha_gasto} · total {fmt(g.monto_total, g.moneda)} · tu parte {fmt(g.monto_propio, g.moneda)}</span>
                  <button className={`btn small ${g.liquidado ? "ghost" : "primary"}`} onClick={() => alternar(g)}>
                    {g.liquidado ? "Deshacer" : "Marcar cobrado"}
                  </button>
                </div>
                <span className="monto">{fmt(g.pendiente, g.moneda)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
