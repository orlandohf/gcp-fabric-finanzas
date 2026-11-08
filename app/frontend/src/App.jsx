import { useEffect, useMemo, useState } from "react";

const TIPOS = ["Fijo", "Variable Necesario", "Variable Hormiga"];
const METODOS = ["TC", "TD", "Yape-Plin", "Efectivo"];
const CATEGORIAS = ["Alimentación", "Transporte", "Vivienda", "Servicios", "Salud", "Educación",
  "Entretenimiento", "Ropa", "Suscripciones", "Mascotas", "Regalos", "Otros"];
const ENTIDADES = ["BCP", "Interbank", "BBVA", "Scotiabank", "BanBif", "Yape", "Plin", "Efectivo"];

const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

const vacio = () => ({
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
});

const fmt = (monto, moneda) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: moneda }).format(monto);

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.detail || "Error"), { status: r.status });
  return data;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const error = new URLSearchParams(location.search).get("error");

  useEffect(() => {
    api("/api/me").then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="center muted">Cargando…</div>;
  if (!user) return <Login error={error} />;
  return <Panel user={user} />;
}

function Login({ error }) {
  return (
    <div className="center">
      <div className="card login">
        <div className="logo">S/</div>
        <h1>Mis Gastos</h1>
        <p className="muted">Registro personal de gastos</p>
        {error === "denegado" && <p className="alert">Esta cuenta no tiene acceso.</p>}
        {error === "oauth" && <p className="alert">No se pudo iniciar sesión. Intenta otra vez.</p>}
        <a className="btn primary block" href="/auth/login">Entrar con Google</a>
      </div>
    </div>
  );
}

function Panel({ user }) {
  const [gastos, setGastos] = useState([]);
  const [aviso, setAviso] = useState(null);

  const cargar = () =>
    api("/api/gastos").then((g) => { setGastos(g); setAviso(null); })
      .catch((e) => setAviso({ tipo: "error", texto: e.message }));

  useEffect(() => { cargar(); }, []);

  const resumen = useMemo(() => {
    const mes = hoyLima().slice(0, 7);
    const r = { PEN: 0, USD: 0, hormiga: 0 };
    gastos.filter((g) => g.fecha_gasto.startsWith(mes)).forEach((g) => {
      r[g.moneda] += g.monto_total;
      if (g.tipo_gasto === "Variable Hormiga" && g.moneda === "PEN") r.hormiga += g.monto_total;
    });
    return r;
  }, [gastos]);

  const pendientes = gastos.filter((g) => !g.fabric_enviado).length;

  const reenviar = async () => {
    try {
      const r = await api("/api/fabric/reenviar", { method: "POST" });
      setAviso({ tipo: "ok", texto: `Reenviados ${r.reenviados} de ${r.pendientes} a Fabric` });
      cargar();
    } catch (e) { setAviso({ tipo: "error", texto: e.message }); }
  };

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Mis Gastos</h1>
          <span className="muted small">{user.email}</span>
        </div>
        <a className="btn ghost" href="/auth/logout">Salir</a>
      </header>

      <section className="stats">
        <Stat label="Este mes (PEN)" valor={fmt(resumen.PEN, "PEN")} />
        <Stat label="Este mes (USD)" valor={fmt(resumen.USD, "USD")} />
        <Stat label="Hormiga (PEN)" valor={fmt(resumen.hormiga, "PEN")} warn />
      </section>

      {aviso && <p className={`alert ${aviso.tipo}`}>{aviso.texto}</p>}

      <Formulario
        onGuardado={(g) => {
          setGastos((prev) => [g, ...prev]);
          setAviso(g.fabric_enviado
            ? { tipo: "ok", texto: "Gasto guardado y enviado a Fabric ✓" }
            : { tipo: "warn", texto: "Gasto guardado. Envío a Fabric pendiente." });
        }}
        onError={(texto) => setAviso({ tipo: "error", texto })}
      />

      <section className="card">
        <div className="row-between">
          <h2>Últimos gastos</h2>
          {pendientes > 0 && (
            <button className="btn ghost small" onClick={reenviar}>Reenviar {pendientes} a Fabric</button>
          )}
        </div>
        {gastos.length === 0 && <p className="muted">Aún no hay gastos registrados.</p>}
        <ul className="lista">
          {gastos.map((g) => (
            <li key={g.id}>
              <div>
                <strong>{g.concepto}</strong>
                <span className="muted small">
                  {g.fecha_gasto} · {g.categoria} · {g.metodo_pago}{g.entidad_financiera && ` ${g.entidad_financiera}`}
                </span>
                <span className="tags">
                  <span className={`tag ${g.tipo_gasto === "Variable Hormiga" ? "warn" : ""}`}>{g.tipo_gasto}</span>
                  {g.es_compartido && <span className="tag">Compartido</span>}
                  {!g.fabric_enviado && <span className="tag muted">Sin enviar</span>}
                </span>
              </div>
              <span className="monto">{fmt(g.monto_total, g.moneda)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, valor, warn }) {
  return (
    <div className={`card stat ${warn ? "warn" : ""}`}>
      <span className="muted small">{label}</span>
      <strong>{valor}</strong>
    </div>
  );
}

function Formulario({ onGuardado, onError }) {
  const [f, setF] = useState(vacio());
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const guardar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const g = await api("/api/gastos", {
        method: "POST",
        body: JSON.stringify({ ...f, cantidad: Number(f.cantidad), monto_total: Number(f.monto_total) }),
      });
      onGuardado(g);
      setF({ ...vacio(), fecha_gasto: f.fecha_gasto, metodo_pago: f.metodo_pago, entidad_financiera: f.entidad_financiera });
    } catch (err) {
      onError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="card form" onSubmit={guardar}>
      <h2>Nuevo gasto</h2>

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
              onClick={() => setF({ ...f, tipo_gasto: t })}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="full">
        <legend>Método de pago</legend>
        <div className="chips">
          {METODOS.map((m) => (
            <button type="button" key={m} className={`chip ${f.metodo_pago === m ? "on" : ""}`}
              onClick={() => setF({ ...f, metodo_pago: m })}>{m}</button>
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

      <button className="btn primary block full" disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar gasto"}
      </button>
    </form>
  );
}
