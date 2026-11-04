import { TIER_DEFS, PERIOD_DEFS } from "./definitions";

/**
 * Legends for the two classification schemes the dashboard displays.
 *
 * Both carry the boundary rule next to the colour, so the reader never has
 * to remember what "Moderate" or "Off-Peak" covers. The tier boundaries are
 * stated relative to capacity C, matching the manuscript, and the capacity
 * actually used is passed in so the absolute counts can be shown too.
 */

export default function DemandTierLegend({ capacity }) {
  const counts = capacity
    ? [
        `<= ${capacity}`,
        `${capacity + 1} to ${capacity + 5}`,
        `${capacity + 6} to ${capacity + 10}`,
        `> ${capacity + 10}`,
      ]
    : [];

  return (
    <div className="rs-legend">
      {TIER_DEFS.map((t, i) => (
        <div key={t.name} className="rs-legend-item" style={{ minWidth: 168 }}>
          <span className="rs-legend-swatch" style={{ background: t.fill }} aria-hidden="true" />
          <span>
            <span className="rs-legend-name" style={{ color: t.on }}>{t.name}</span>
            <span className="rs-legend-def">
              <br />
              {t.def}
              {counts[i] ? ` Occupancy ${counts[i]} passengers.` : ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function PeriodLegend() {
  return (
    <div className="rs-legend">
      {PERIOD_DEFS.map((p) => (
        <div key={p.name} className="rs-legend-item">
          <span>
            <span className="rs-legend-name">{p.name}</span>
            <span className="rs-legend-def">
              <br />
              {p.range} PHT
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
