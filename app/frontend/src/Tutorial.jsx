import { useEffect, useState } from "react";

const PASOS = [
  { icono: "⚡", titulo: "Registra en segundos", texto: "En el inicio ya tienes el formulario: escribe el monto, en qué fue, toca la categoría y Guardar. La app recuerda tu último método de pago y banco, y sugiere si el gasto es fijo según la categoría." },
  { icono: "📷", titulo: "O escanéalo", texto: "¿Tienes el voucher, ticket o captura de Yape/Plin? Toca «Escanear» arriba del formulario y la IA lo llena por ti." },
  { icono: "✅", titulo: "Revisa antes de guardar", texto: "La IA puede equivocarse: confirma el monto, la categoría y el método de pago. Si la confianza es baja, verás un aviso amarillo." },
  { icono: "🐜", titulo: "Tipos de gasto", texto: "Fijo: se repite cada mes (alquiler, servicios). Variable Necesario: no es mensual pero sí necesario (súper, salud). Variable Hormiga: pequeños antojos que se acumulan (café, snacks, delivery)." },
  { icono: "📊", titulo: "Resumen e IA", texto: "En la pestaña «Resumen e IA» ves tus gastos por categoría y método de pago, y puedes pedir consejos personalizados de ahorro." },
  { icono: "🤝", titulo: "Gastos compartidos", texto: "Marca «Gasto compartido» y elige 50/50 o «Mi parte». Tus totales cuentan solo lo que salió de tu bolsillo, y lo demás aparece en «Por cobrar» hasta que lo marques como cobrado." },
  { icono: "✏️", titulo: "Editar o eliminar", texto: "Toca cualquier gasto de la lista para corregirlo o eliminarlo. Los cambios también llegan a Fabric." },
  { icono: "🌙", titulo: "Funciona de noche y sin señal", texto: "La base de datos descansa de 11:00 p. m. a 6:00 a. m. Si registras algo en ese horario o sin internet, se guarda en tu teléfono y se envía solo cuando vuelva a estar disponible." },
  { icono: "📲", titulo: "Instálala", texto: "En Android: menú ⋮ › «Instalar app». En iPhone: botón Compartir › «Agregar a inicio». Se abrirá como una app normal." },
];

export default function Tutorial({ onCerrar }) {
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
