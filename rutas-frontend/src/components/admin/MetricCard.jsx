/**
 * One headline figure, with its definition attached.
 *
 * Two behaviours matter here:
 *
 * 1. `definition` renders an info affordance carrying the metric's meaning.
 *    It is a real <button> with an aria-label, not a bare title attribute,
 *    so it is reachable by keyboard and announced by a screen reader.
 *
 * 2. When `value` is null or undefined the card renders an explicit
 *    "Not available" state instead of a dash or a zero. A missing metric
 *    must never be indistinguishable from a measured zero.
 */
export default function MetricCard({
  label,
  value,
  sub,
  accent,
  definition,
  unavailableNote,
}) {
  const missing = value === null || value === undefined;

  return (
    <div className="rs-metric">
      {accent && <div className="rs-metric-accent" style={{ background: accent }} />}

      <div className="rs-metric-label">
        <span>{label}</span>
        {definition && (
          <button
            type="button"
            className="rs-tip"
            aria-label={`What ${label} means: ${definition}`}
            title={definition}
          >
            i
          </button>
        )}
      </div>

      <div
        className={`rs-metric-value${missing ? " rs-na" : ""}`}
        style={!missing && accent ? { color: accent } : undefined}
      >
        {missing ? "Not available" : value}
      </div>

      <div className="rs-metric-sub">
        {missing ? (unavailableNote || "Not available in current dataset") : sub}
      </div>
    </div>
  );
}
