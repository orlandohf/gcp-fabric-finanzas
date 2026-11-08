export const TIPOS = ["Fijo", "Variable Necesario", "Variable Hormiga"];
export const METODOS = ["TC", "TD", "Yape-Plin", "Efectivo"];
export const CATEGORIAS = ["Alimentación", "Transporte", "Vivienda", "Servicios", "Salud", "Educación",
  "Entretenimiento", "Ropa", "Suscripciones", "Mascotas", "Regalos", "Otros"];
export const ENTIDADES = ["BCP", "Interbank", "BBVA", "Scotiabank", "BanBif", "Yape", "Plin", "Efectivo"];

export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export const fmt = (monto, moneda = "PEN") =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: moneda }).format(monto || 0);

/** fetch JSON. Error de red → err.status undefined (la cola offline lo usa para decidir). */
export async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  } catch {
    throw Object.assign(new Error("Sin conexión"), { status: undefined });
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detalle = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(". ") : data.detail;
    throw Object.assign(new Error(detalle || "Error"), { status: r.status, codigo: data.codigo });
  }
  return data;
}

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};

export const nuevoId = () =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

// Reduce la foto a máx. 1600 px en JPEG para que el envío sea rápido
export function prepararImagen(file) {
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
