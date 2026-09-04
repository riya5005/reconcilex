export default function ConfidenceStamp({ score, band }: { score: number; band: "HIGH" | "MEDIUM" | "LOW" }) {
  const color =
    band === "HIGH" ? "var(--alert-red)" : band === "MEDIUM" ? "var(--seal-amber)" : "var(--text-faint)";
  const label = band === "HIGH" ? "Duplicate" : band === "MEDIUM" ? "Review" : "Cleared";

  return (
    <div className="stamp animate-stamp" style={{ color }}>
      <span className="text-2xl font-semibold leading-none">{score}%</span>
      <span className="text-[9px] mt-1">{label}</span>
    </div>
  );
}
