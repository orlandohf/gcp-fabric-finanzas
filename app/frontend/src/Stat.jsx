export default function Stat({ label, valor, warn }) {
  return (
    <div className={`card stat ${warn ? "warn" : ""}`}>
      <span className="muted small">{label}</span>
      <strong>{valor}</strong>
    </div>
  );
}
