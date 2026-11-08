// Cola offline en IndexedDB: guarda gastos cuando no hay red o la BD está en descanso (23:00–06:00)
// y los sincroniza solos. Idempotente: cada gasto lleva su id (UUID) generado en el cliente.

const DB = "mis-gastos";
const STORE = "cola";

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, modo);
    const resultado = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(resultado?.result ?? resultado);
    t.onerror = () => reject(t.error);
  });
}

export const cola = {
  agregar: (gasto) => tx("readwrite", (s) => s.put({ ...gasto, encolado_en: new Date().toISOString() })),
  listar: () => tx("readonly", (s) => s.getAll()),
  quitar: (id) => tx("readwrite", (s) => s.delete(id)),
};

// Errores que justifican encolar: sin red o BD apagada. Un 4xx de validación NO se encola.
export const esReintentable = (err) => err.status === undefined || err.status === 503 || err.status >= 502;

let sincronizando = false;

/** Envía los gastos en cola. Devuelve {enviados, restantes}. */
export async function sincronizar(enviar) {
  if (sincronizando) return null;
  sincronizando = true;
  let enviados = 0;
  try {
    const pendientes = (await cola.listar()).sort((a, b) => a.encolado_en.localeCompare(b.encolado_en));
    for (const g of pendientes) {
      const { encolado_en: _omitido, ...gasto } = g;
      try {
        await enviar(gasto);
        await cola.quitar(g.id);
        enviados++;
      } catch (err) {
        if (esReintentable(err)) break;          // la BD sigue apagada / sin red: reintentar luego
        await cola.quitar(g.id);                 // inválido: no bloquear la cola
        console.warn("Gasto descartado de la cola por error de validación", g, err);
      }
    }
    return { enviados, restantes: (await cola.listar()).length };
  } finally {
    sincronizando = false;
  }
}
