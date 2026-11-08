import { useEffect, useMemo, useRef, useState } from "react";

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

const fmt = (monto, moneda = "PEN") =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: moneda }).format(monto || 0);

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.detail || "Error"), { status: r.status });
  return data;
}

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};

// Reduce la foto a máx. 1600 px en JPEG para que el envío sea rápido
function prepararImagen(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ imagen_base64: c.toDataURL("image/jpeg", 0.85), mime_type: "image/jpeg" });
    };
    img.onerror = () => {
      // El navegador no pudo decodificarla (p. ej. HEIC en Android): se envía tal cual
      URL.revokeObjectURL(url);
      const fr = new FileReader();
      fr.onload = () => resolve({ imagen_base64: fr.result, mime_type: file.type || "image/jpeg" });
      fr.readAsDataURL(file);
    };
    img.src = url;
  });
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
  const [tab, setTab] = useState("registrar");
  const [tutorial, setTutorial] = useState(() => !store.get("tutorial_visto"));

  const cerrarTutorial = () => { store.set("tutorial_visto", "1"); setTutorial(false); };

  const cargar = () =>
    api("/api/gastos").then((g) => { setGastos(g); setAviso(null); })
      .catch((e) => setAviso({ tipo: "error", texto: e.message }));

  useEffect(() => { cargar(); }, []);

  const resumenMes = useMemo(() => {
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
        <div className="acciones">
          <button className="btn ghost icono" onClick={() => setTutorial(true)} aria-label="Tutorial" title="Tutorial">?</button>
          <a className="btn ghost" href="/auth/logout">Salir</a>
        </div>
      </header>

      <section className="stats">
        <Stat label="Este mes (PEN)" valor={fmt(resumenMes.PEN, "PEN")} />
        <Stat label="Este mes (USD)" valor={fmt(resumenMes.USD, "USD")} />
        <Stat label="Hormiga (PEN)" valor={fmt(resumenMes.hormiga, "PEN")} warn />
      </section>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "registrar"} className={tab === "registrar" ? "on" : ""} onClick={() => setTab("registrar")}>Registrar</button>
        <button role="tab" aria-selected={tab === "resumen"} className={tab === "resumen" ? "on" : ""} onClick={() => setTab("resumen")}>Resumen e IA</button>
      </nav>

      {aviso && <p className={`alert ${aviso.tipo}`}>{aviso.texto}</p>}

      {tab === "registrar" ? (
        <>
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
        </>
      ) : (
        <Resumen />
      )}

      {tutorial && <Tutorial onCerrar={cerrarTutorial} />}
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
  const [escaneando, setEscaneando] = useState(false);
  const [deteccion, setDeteccion] = useState(null);
  const fileRef = useRef(null);
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
      onError(err.status === 503 ? err.message : `Escaneo: ${err.message}`);
    } finally {
      setEscaneando(false);
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const g = await api("/api/gastos", {
        method: "POST",
        body: JSON.stringify({ ...f, cantidad: Number(f.cantidad), monto_total: Number(f.monto_total) }),
      });
      onGuardado(g);
      setDeteccion(null);
      setF({ ...vacio(), fecha_gasto: f.fecha_gasto, metodo_pago: f.metodo_pago, entidad_financiera: f.entidad_financiera });
    } catch (err) {
      onError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="card form" onSubmit={guardar}>
      <div className="row-between full">
        <h2>Nuevo gasto</h2>
      </div>

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

// ---------- Resumen + consejos IA ----------
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

function Resumen() {
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

  const tot = (m) => datos?.totales.find((t) => t.moneda === m) || { total: 0, n: 0, compartido: 0 };
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
            <Stat label={`Total PEN · ${pen.n} gastos`} valor={fmt(pen.total)} />
            <Stat label="Hormiga" valor={`${fmt(hormiga)}${pen.total ? ` · ${Math.round((hormiga / pen.total) * 100)}%` : ""}`} warn />
            <Stat label="Compartido" valor={fmt(pen.compartido)} />
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

// ---------- Tutorial ----------
const PASOS = [
  { icono: "📷", titulo: "Escanea y listo", texto: "Toca «Escanear foto o boucher con IA» y toma una foto del voucher, ticket, captura de Yape/Plin o incluso del producto. La IA llena el formulario por ti." },
  { icono: "✅", titulo: "Revisa antes de guardar", texto: "La IA puede equivocarse: confirma el monto, la categoría y el método de pago. Si la confianza es baja, verás un aviso amarillo." },
  { icono: "🐜", titulo: "Tipos de gasto", texto: "Fijo: se repite cada mes (alquiler, servicios). Variable Necesario: no es mensual pero sí necesario (súper, salud). Variable Hormiga: pequeños antojos que se acumulan (café, snacks, delivery)." },
  { icono: "📊", titulo: "Resumen e IA", texto: "En la pestaña «Resumen e IA» ves tus gastos por categoría y método de pago, y puedes pedir consejos personalizados de ahorro." },
  { icono: "🌙", titulo: "Horario", texto: "La base de datos descansa de 11:00 p. m. a 6:00 a. m. para ahorrar costos. En ese horario no se pueden guardar gastos." },
];

function Tutorial({ onCerrar }) {
  const [i, setI] = useState(0);
  const p = PASOS[i];
  const ultimo = i === PASOS.length - 1;

  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="tut-titulo" onClick={(e) => e.stopPropagation()}>
        <div className="tut-icono">{p.icono}</div>
        <h2 id="tut-titulo">{p.titulo}</h2>
        <p>{p.texto}</p>
        <div className="puntos">
          {PASOS.map((_, j) => <button key={j} className={j === i ? "on" : ""} onClick={() => setI(j)} aria-label={`Paso ${j + 1}`} />)}
        </div>
        <div className="row-between">
          <button className="btn ghost" onClick={i === 0 ? onCerrar : () => setI(i - 1)}>{i === 0 ? "Saltar" : "Atrás"}</button>
          <button className="btn primary" onClick={ultimo ? onCerrar : () => setI(i + 1)}>{ultimo ? "¡Entendido!" : "Siguiente"}</button>
        </div>
      </div>
    </div>
  );
}
