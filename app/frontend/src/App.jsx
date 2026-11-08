import { useCallback, useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { cola, esReintentable, sincronizar } from "./cola.js";
import Formulario from "./Formulario.jsx";
import { api, fmt, nuevoId, store } from "./lib.js";
import PorCobrar from "./PorCobrar.jsx";
import Resumen from "./Resumen.jsx";
import Stat from "./Stat.jsx";
import Tutorial from "./Tutorial.jsx";

export default function App() {
  const [user, setUser] = useState(undefined);
  const error = new URLSearchParams(location.search).get("error");

  useEffect(() => {
    api("/api/me").then(setUser).catch((e) => {
      // Sin red pero con sesión previa: dejar usar la app (cola offline)
      setUser(e.status === undefined && store.get("sesion_email") ? { email: store.get("sesion_email"), offline: true } : null);
    });
  }, []);

  useEffect(() => { if (user?.email && !user.offline) store.set("sesion_email", user.email); }, [user]);

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

function AvisoActualizacion() {
  const { needRefresh: [hayNueva, setHayNueva], updateServiceWorker } = useRegisterSW();
  if (!hayNueva) return null;
  return (
    <div className="toast" role="status">
      <span>Hay una nueva versión de la app.</span>
      <div className="acciones">
        <button className="btn ghost small" onClick={() => setHayNueva(false)}>Luego</button>
        <button className="btn primary small" onClick={() => updateServiceWorker(true)}>Actualizar</button>
      </div>
    </div>
  );
}

function Panel({ user }) {
  const [gastos, setGastos] = useState([]);
  const [enCola, setEnCola] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [bdDisponible, setBdDisponible] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [tab, setTab] = useState("registrar");
  const [editando, setEditando] = useState(null);
  const [tutorial, setTutorial] = useState(() => !store.get("tutorial_v2"));

  const cerrarTutorial = useCallback(() => { store.set("tutorial_v2", "1"); setTutorial(false); }, []);

  const recargar = useCallback(async () => {
    setEnCola(await cola.listar().catch(() => []));
    try {
      const [g, k] = await Promise.all([api("/api/gastos"), api("/api/kpis/mes")]);
      setGastos(g); setKpis(k); setBdDisponible(true);
    } catch (e) {
      setBdDisponible(false);
      if (e.status === 401) location.reload();
    }
  }, []);

  const sincronizarCola = useCallback(async () => {
    const r = await sincronizar((g) => api("/api/gastos", { method: "POST", body: JSON.stringify(g) }));
    if (r?.enviados) {
      setAviso({ tipo: "ok", texto: `Se sincronizaron ${r.enviados} gasto${r.enviados > 1 ? "s" : ""} guardados en el teléfono ✓` });
    }
    await recargar();
  }, [recargar]);

  // Sincronización automática: al abrir, al volver la red, al volver a la app y cada minuto si hay cola
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
    if (editando) {
      try {
        const g = await api(`/api/gastos/${editando.id}`, { method: "PUT", body: JSON.stringify(payload) });
        setEditando(null);
        setAviso({ tipo: g.fabric_pendiente ? "warn" : "ok", texto: g.fabric_pendiente ? "Cambios guardados. Envío a Fabric pendiente." : "Cambios guardados ✓" });
        await recargar();
        return true;
      } catch (e) {
        setAviso({ tipo: "error", texto: e.status === undefined || e.status === 503 ? "Para editar necesitas conexión y la base disponible (06:00–23:00)." : e.message });
        return false;
      }
    }

    const gasto = { id: nuevoId(), ...payload };
    try {
      const g = await api("/api/gastos", { method: "POST", body: JSON.stringify(gasto) });
      setAviso(g.fabric_pendiente
        ? { tipo: "warn", texto: "Gasto guardado. Envío a Fabric pendiente (se reintenta solo)." }
        : { tipo: "ok", texto: "Gasto guardado y enviado a Fabric ✓" });
      await recargar();
      return true;
    } catch (e) {
      if (esReintentable(e)) {
        await cola.agregar(gasto);
        setEnCola(await cola.listar());
        setAviso({ tipo: "warn", texto: e.status === undefined
          ? "Sin conexión: guardado en tu teléfono. Se enviará solo cuando vuelva la señal."
          : "La base está en descanso: guardado en tu teléfono. Se enviará solo a partir de las 6:00 a. m." });
        return true;
      }
      setAviso({ tipo: "error", texto: e.message });
      return false;
    }
  };

  const eliminar = async (g) => {
    try {
      await api(`/api/gastos/${g.id}`, { method: "DELETE" });
      setEditando(null);
      setAviso({ tipo: "ok", texto: "Gasto eliminado" });
      await recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: e.message });
    }
  };

  const editar = (g) => {
    setEditando(g);
    setAviso(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const k = (m, campo) => (kpis ? fmt(kpis[m][campo], m) : "—");
  const pendientesFabric = gastos.filter((g) => g.fabric_pendiente).length;

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

      {!bdDisponible && (
        <p className="alert warn">🌙 La base está en descanso (23:00–06:00) o no hay conexión. Puedes seguir registrando: se guarda en tu teléfono.</p>
      )}

      <section className="stats">
        <Stat label="Gasto real del mes" valor={k("PEN", "total")} />
        <Stat label="Hormiga del mes" valor={k("PEN", "hormiga")} warn />
        <Stat label="Por cobrar" valor={k("PEN", "por_cobrar")} />
        {kpis && kpis.USD.n > 0 && <Stat label="Gasto en USD" valor={k("USD", "total")} />}
      </section>

      <nav className="tabs" role="tablist">
        {[["registrar", "Registrar"], ["cobrar", "Por cobrar"], ["resumen", "Resumen e IA"]].map(([id, txt]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""}
            onClick={() => { setTab(id); setEditando(null); }}>{txt}</button>
        ))}
      </nav>

      {aviso && <p className={`alert ${aviso.tipo}`} role="status">{aviso.texto}</p>}

      {tab === "registrar" && (
        <>
          <Formulario editando={editando} onGuardar={guardar} onEliminar={eliminar}
            onCancelar={() => setEditando(null)} onError={(texto) => setAviso({ tipo: "error", texto })} />

          <section className="card">
            <div className="row-between">
              <h2>Últimos gastos</h2>
              {pendientesFabric > 0 && (
                <button className="btn ghost small" onClick={async () => {
                  const r = await api("/api/fabric/reenviar", { method: "POST" }).catch((e) => ({ error: e.message }));
                  setAviso(r.error ? { tipo: "error", texto: r.error } : { tipo: "ok", texto: `Enviados ${r.enviados} de ${r.pendientes} eventos a Fabric` });
                  recargar();
                }}>Reenviar a Fabric</button>
              )}
            </div>
            {gastos.length === 0 && enCola.length === 0 && <p className="muted">Aún no hay gastos registrados.</p>}
            <ul className="lista">
              {enCola.map((g) => (
                <li key={g.id} className="en-cola">
                  <div>
                    <strong>{g.concepto}</strong>
                    <span className="muted small">{g.fecha_gasto} · {g.categoria} · {g.metodo_pago}</span>
                    <span className="tags"><span className="tag warn">📱 En el teléfono, por enviar</span></span>
                  </div>
                  <span className="monto">{fmt(g.monto_total, g.moneda)}</span>
                </li>
              ))}
              {gastos.map((g) => (
                <li key={g.id}>
                  <button className="fila" onClick={() => editar(g)} aria-label={`Editar ${g.concepto}`}>
                    <div>
                      <strong>{g.concepto}</strong>
                      <span className="muted small">
                        {g.fecha_gasto} · {g.categoria} · {g.metodo_pago}{g.entidad_financiera && ` ${g.entidad_financiera}`}
                      </span>
                      <span className="tags">
                        <span className={`tag ${g.tipo_gasto === "Variable Hormiga" ? "warn" : ""}`}>{g.tipo_gasto}</span>
                        {g.es_compartido && <span className="tag">Compartido · tu parte {fmt(g.monto_propio, g.moneda)}</span>}
                        {g.fabric_pendiente && <span className="tag muted">Sin enviar</span>}
                      </span>
                    </div>
                    <span className="monto">{fmt(g.monto_total, g.moneda)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {tab === "cobrar" && <PorCobrar onCambio={recargar} />}
      {tab === "resumen" && <Resumen />}

      {tutorial && <Tutorial onCerrar={cerrarTutorial} />}
      <AvisoActualizacion />
    </div>
  );
}
