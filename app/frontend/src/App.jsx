import { useCallback, useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { cola, esReintentable, sincronizar } from "./cola.js";
import Formulario from "./Formulario.jsx";
import { IcoAyuda, IcoCobrar, IcoInicio, IcoNube, IcoResumen, IcoSalir } from "./iconos.jsx";
import { agruparPorDia, api, etiquetaDia, fmt, mesLima, metaCategoria, nuevoId, store } from "./lib.js";
import PorCobrar from "./PorCobrar.jsx";
import Resumen from "./Resumen.jsx";
import Sheet from "./Sheet.jsx";
import Tutorial from "./Tutorial.jsx";

export default function App() {
  const [user, setUser] = useState(undefined);
  const error = new URLSearchParams(location.search).get("error");

  useEffect(() => {
    api("/api/me").then(setUser).catch((e) => {
      // Sin red pero con sesión previa: dejar usar la app (cola offline)
      const email = store.get("sesion_email");
      setUser(e.status === undefined && email ? { email, nombre: store.get("sesion_nombre") || "", offline: true } : null);
    });
  }, []);

  useEffect(() => {
    if (user?.email && !user.offline) { store.set("sesion_email", user.email); store.set("sesion_nombre", user.nombre || ""); }
  }, [user]);

  if (user === undefined) return <div className="pantalla-carga"><div className="logo pulso">S/</div></div>;
  if (!user) return <Login error={error} />;
  return <Panel user={user} />;
}

function Login({ error }) {
  return (
    <div className="login-fondo">
      <div className="login">
        <div className="logo">S/</div>
        <h1>Mis Gastos</h1>
        <p>Registra en segundos, entiende a dónde va tu plata y ahorra con ayuda de IA.</p>
        <ul className="login-puntos">
          <li>📷 Escanea el voucher y listo</li>
          <li>🐜 Detecta tus gastos hormiga</li>
          <li>🤝 Lleva la cuenta de lo compartido</li>
        </ul>
        {error === "denegado" && <p className="alert">Tu correo aún no está invitado. Pídele acceso a quien te compartió la app.</p>}
        {error === "oauth" && <p className="alert">No se pudo iniciar sesión. Intenta otra vez.</p>}
        <a className="btn blanco block grande" href="/auth/login">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Entrar con Google
        </a>
        <p className="login-legal">Acceso solo por invitación. Cada cuenta ve únicamente sus propios gastos. A la IA solo llegan la foto que escaneas y tus totales agregados.</p>
      </div>
    </div>
  );
}

function AvisoActualizacion() {
  const { needRefresh: [hayNueva, setHayNueva], updateServiceWorker } = useRegisterSW();
  if (!hayNueva) return null;
  return (
    <div className="toast fijo" role="status">
      <span>✨ Hay una nueva versión de la app.</span>
      <div className="acciones">
        <button className="btn ghost small" onClick={() => setHayNueva(false)}>Luego</button>
        <button className="btn primary small" onClick={() => updateServiceWorker(true)}>Actualizar</button>
      </div>
    </div>
  );
}

function Toast({ aviso, onCerrar }) {
  useEffect(() => {
    if (!aviso || aviso.tipo === "error") return;
    const t = setTimeout(onCerrar, 4500);
    return () => clearTimeout(t);
  }, [aviso, onCerrar]);
  if (!aviso) return null;
  return (
    <div className={`toast ${aviso.tipo}`} role={aviso.tipo === "error" ? "alert" : "status"}>
      <span>{aviso.texto}</span>
      <button className="btn ghost small" onClick={onCerrar} aria-label="Cerrar aviso">OK</button>
    </div>
  );
}

function Hero({ kpis, bdDisponible }) { // resumen compacto del mes
  const pen = kpis?.PEN;
  const pctHormiga = pen?.total ? Math.round((pen.hormiga / pen.total) * 100) : 0;
  return (
    <section className="hero compacto" aria-label="Resumen del mes">
      <div className="hero-top">
        <span>Gasto real de {mesLima()}</span>
        {!bdDisponible && <span className="hero-chip"><IcoNube size={14} /> Modo sin conexión</span>}
      </div>
      {kpis ? <strong className="hero-monto">{fmt(pen.total)}</strong> : <span className="skeleton hero-skel" />}
      <div className="hero-metricas">
        <div>
          <span>Hormiga</span>
          <strong>{kpis ? fmt(pen.hormiga) : "—"}</strong>
          <div className="barra-mini" aria-label={`${pctHormiga}% del gasto`}><span style={{ width: `${Math.min(pctHormiga, 100)}%` }} /></div>
        </div>
        <div>
          <span>Por cobrar</span>
          <strong>{kpis ? fmt(pen.por_cobrar) : "—"}</strong>
        </div>
        <div>
          <span>En dólares</span>
          <strong>{kpis ? fmt(kpis.USD.total, "USD") : "—"}</strong>
        </div>
      </div>
    </section>
  );
}

function FilaGasto({ g, onClick, enCola }) {
  const m = metaCategoria(g.categoria);
  const contenido = (
    <>
      <span className="avatar-cat" style={{ "--h": m.h }} aria-hidden="true">{m.emoji}</span>
      <span className="fila-texto">
        <strong>{g.concepto}</strong>
        <span className="muted small">
          {g.categoria} · {g.metodo_pago}{g.entidad_financiera && ` · ${g.entidad_financiera}`}
        </span>
        <span className="tags">
          {g.tipo_gasto === "Variable Hormiga" && <span className="tag warn">🐜 Hormiga</span>}
          {g.es_compartido && <span className="tag">🤝 Tu parte {fmt(g.monto_propio, g.moneda)}</span>}
          {enCola && <span className="tag warn">📱 Por enviar</span>}
          {g.fabric_pendiente && <span className="tag muted" title="Aún no llega a Fabric; se reintenta solo">⟳ Sin sincronizar</span>}
        </span>
      </span>
      <span className="fila-monto">
        <strong>{fmt(g.monto_total, g.moneda)}</strong>
        {g.cantidad > 1 && <span className="muted small">× {g.cantidad}</span>}
      </span>
    </>
  );
  return enCola
    ? <li className="fila en-cola">{contenido}</li>
    : <li><button className="fila" onClick={onClick} aria-label={`Editar ${g.concepto}`}>{contenido}</button></li>;
}

function ListaSkeleton() {
  return (
    <ul className="lista" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="fila"><span className="skeleton avatar-cat" /><span className="fila-texto"><span className="skeleton linea" /><span className="skeleton linea corta" /></span></li>
      ))}
    </ul>
  );
}

const TABS = [
  { id: "inicio", txt: "Inicio", Ico: IcoInicio },
  { id: "cobrar", txt: "Por cobrar", Ico: IcoCobrar },
  { id: "resumen", txt: "Resumen", Ico: IcoResumen },
];

function Panel({ user }) {
  const [gastos, setGastos] = useState(null);
  const [enCola, setEnCola] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [bdDisponible, setBdDisponible] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [tab, setTab] = useState("inicio");
  const [hoja, setHoja] = useState(null); // null | {modo: "editar", gasto}
  const [menu, setMenu] = useState(false);
  const [tutorial, setTutorial] = useState(() => !store.get("tutorial_v3"));

  const cerrarTutorial = useCallback(() => { store.set("tutorial_v3", "1"); setTutorial(false); }, []);
  const cerrarAviso = useCallback(() => setAviso(null), []);
  const cerrarHoja = useCallback(() => setHoja(null), []);

  const recargar = useCallback(async () => {
    setEnCola(await cola.listar(user.email).catch(() => []));
    try {
      const [g, k] = await Promise.all([api("/api/gastos"), api("/api/kpis/mes")]);
      setGastos(g); setKpis(k); setBdDisponible(true);
    } catch (e) {
      if (e.status === 401) return location.reload();
      setBdDisponible(false);
      setGastos((prev) => prev ?? []);
    }
  }, [user.email]);

  const sincronizarCola = useCallback(async () => {
    const r = await sincronizar((g) => api("/api/gastos", { method: "POST", body: JSON.stringify(g) }), user.email);
    if (r?.enviados) setAviso({ tipo: "ok", texto: `Se sincronizaron ${r.enviados} gasto${r.enviados > 1 ? "s" : ""} guardados en el teléfono ✓` });
    await recargar();
  }, [recargar, user.email]);

  useEffect(() => {
    sincronizarCola();
    const alVolver = () => document.visibilityState === "visible" && sincronizarCola();
    window.addEventListener("online", sincronizarCola);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.removeEventListener("online", sincronizarCola);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [sincronizarCola]);

  useEffect(() => {
    if (!enCola.length) return;
    const t = setInterval(sincronizarCola, 60_000);
    return () => clearInterval(t);
  }, [enCola.length, sincronizarCola]);

  const guardar = async (payload) => {
    if (hoja?.modo === "editar") {
      try {
        const g = await api(`/api/gastos/${hoja.gasto.id}`, { method: "PUT", body: JSON.stringify(payload) });
        setHoja(null);
        setAviso({ tipo: g.fabric_pendiente ? "warn" : "ok", texto: g.fabric_pendiente ? "Cambios guardados. Fabric se sincroniza en breve." : "Cambios guardados ✓" });
        await recargar();
        return true;
      } catch (e) {
        setAviso({ tipo: "error", texto: e.status === undefined || e.status === 503 ? "Para editar necesitas conexión y la base disponible (6:00 a. m.–11:00 p. m.)." : e.message });
        return false;
      }
    }

    const gasto = { id: nuevoId(), ...payload };
    try {
      const g = await api("/api/gastos", { method: "POST", body: JSON.stringify(gasto) });
      setHoja(null);
      setAviso(g.fabric_pendiente
        ? { tipo: "warn", texto: "Gasto guardado. Fabric se sincroniza en breve." }
        : { tipo: "ok", texto: `${fmt(g.monto_total, g.moneda)} en ${g.categoria} guardado ✓` });
      await recargar();
      return true;
    } catch (e) {
      if (esReintentable(e)) {
        await cola.agregar(gasto, user.email);
        setEnCola(await cola.listar(user.email));
        setHoja(null);
        setAviso({ tipo: "warn", texto: e.status === undefined
          ? "Sin conexión: lo guardé en tu teléfono y se enviará solo."
          : "La base está descansando: lo guardé en tu teléfono y se enviará solo desde las 6:00 a. m." });
        return true;
      }
      setAviso({ tipo: "error", texto: e.message });
      return false;
    }
  };

  const eliminar = async (g) => {
    try {
      await api(`/api/gastos/${g.id}`, { method: "DELETE" });
      setHoja(null);
      setAviso({ tipo: "ok", texto: "Gasto eliminado" });
      await recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: e.message });
    }
  };

  const nombre = (user.nombre || "").split(" ")[0];
  const grupos = gastos ? agruparPorDia(gastos) : [];
  const pendientesFabric = (gastos || []).filter((g) => g.fabric_pendiente).length;

  return (
    <div className="app">
      <header className="cabecera">
        <div>
          <span className="muted small">{saludo()}{nombre && `, ${nombre}`}</span>
          <h1>{tab === "inicio" ? "Mis Gastos" : TABS.find((t) => t.id === tab).txt}</h1>
        </div>
        <div className="menu-wrap">
          <button className="avatar" onClick={() => setMenu((v) => !v)} aria-label="Menú" aria-expanded={menu}>
            {user.foto ? <img src={user.foto} alt="" referrerPolicy="no-referrer" /> : (nombre[0] || "?").toUpperCase()}
          </button>
          {menu && (
            <div className="menu" role="menu" onClick={() => setMenu(false)}>
              <span className="muted small menu-email">{user.email}</span>
              <button role="menuitem" onClick={() => setTutorial(true)}><IcoAyuda size={18} /> Cómo usar la app</button>
              <a role="menuitem" href="/auth/logout"><IcoSalir size={18} /> Cerrar sesión</a>
            </div>
          )}
        </div>
      </header>

      <main className="contenido">
        {tab === "inicio" && (
          <>
            <Hero kpis={kpis} bdDisponible={bdDisponible} />

            <section className="card registro" aria-label="Registrar gasto">
              <Formulario inline onGuardar={guardar} onEliminar={eliminar} onError={(texto) => setAviso({ tipo: "error", texto })} />
            </section>

            <section className="seccion">
              <div className="seccion-titulo">
                <h2>Movimientos</h2>
                {pendientesFabric > 0 && (
                  <button className="btn link small" onClick={async () => {
                    const r = await api("/api/fabric/reenviar", { method: "POST" }).catch((e) => ({ error: e.message }));
                    setAviso(r.error ? { tipo: "error", texto: r.error } : { tipo: "ok", texto: `Sincronizados ${r.enviados} de ${r.pendientes} con Fabric` });
                    recargar();
                  }}>Sincronizar Fabric</button>
                )}
              </div>

              {enCola.length > 0 && (
                <div className="grupo">
                  <h3 className="grupo-titulo"><span>📱 En tu teléfono</span><span>{enCola.length} por enviar</span></h3>
                  <ul className="lista">{enCola.map((g) => <FilaGasto key={g.id} g={g} enCola />)}</ul>
                </div>
              )}

              {gastos === null && <ListaSkeleton />}
              {gastos?.length === 0 && enCola.length === 0 && (
                <div className="vacio">
                  <span className="vacio-emoji">🧾</span>
                  <strong>Aún no hay gastos</strong>
                  <span className="muted">Escanea tu primer voucher o regístralo a mano.</span>
                </div>
              )}

              {grupos.map((gr) => (
                <div className="grupo" key={gr.fecha}>
                  <h3 className="grupo-titulo"><span>{etiquetaDia(gr.fecha)}</span><span>{fmt(gr.totalPEN)}</span></h3>
                  <ul className="lista">
                    {gr.items.map((g) => <FilaGasto key={g.id} g={g} onClick={() => setHoja({ modo: "editar", gasto: g })} />)}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}

        {tab === "cobrar" && <PorCobrar onCambio={recargar} />}
        {tab === "resumen" && <Resumen />}
      </main>

      <nav className="nav-inferior" aria-label="Secciones">
        {TABS.map(({ id, txt, Ico }) => (
          <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined}
            onClick={() => { setTab(id); window.scrollTo({ top: 0 }); }}>
            <Ico /> <span>{txt}</span>
          </button>
        ))}
      </nav>

      {hoja && (
        <Sheet titulo="Editar gasto" onCerrar={cerrarHoja}>
          <Formulario key={hoja.gasto.id} editando={hoja.gasto}
            onGuardar={guardar} onEliminar={eliminar} onError={(texto) => setAviso({ tipo: "error", texto })} />
        </Sheet>
      )}

      <Toast aviso={aviso} onCerrar={cerrarAviso} />
      {tutorial && <Tutorial onCerrar={cerrarTutorial} />}
      <AvisoActualizacion />
    </div>
  );
}

function saludo() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}
