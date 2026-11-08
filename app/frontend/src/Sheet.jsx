import { useEffect, useRef } from "react";
import { IcoCerrar } from "./iconos.jsx";

/** Panel inferior modal (bottom sheet). Cierra con Escape, con el fondo o con la X; devuelve el foco al cerrar. */
export default function Sheet({ titulo, onCerrar, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const anterior = document.activeElement;
    const esc = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    document.body.classList.add("sin-scroll");
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.classList.remove("sin-scroll");
      anterior?.focus?.({ preventScroll: true });
    };
  }, [onCerrar]);

  return (
    <div className="sheet-fondo" onClick={onCerrar}>
      <section ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-titulo"
        onClick={(e) => e.stopPropagation()}>
        <div className="sheet-asa" aria-hidden="true" />
        <header className="sheet-cabecera">
          <h2 id="sheet-titulo">{titulo}</h2>
          <button className="btn ghost icono" onClick={onCerrar} aria-label="Cerrar"><IcoCerrar size={20} /></button>
        </header>
        <div className="sheet-cuerpo">{children}</div>
      </section>
    </div>
  );
}
