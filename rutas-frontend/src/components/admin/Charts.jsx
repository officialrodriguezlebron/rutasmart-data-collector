import { DEMAND_COLOR } from "../../utils/adminFormatters";
import { TIER_ORDER, PERIOD_ORDER, DEF, capacityStatus } from "./definitions";
import { UnavailableState } from "./EmptyState";

/** One neutral colour for counts that describe WHEN data was collected. */
const COLLECTION_FILL = "rgba(255, 255, 255, 0.34)";

/**
 * Chart primitives shared by the redesigned admin pages.
 *
 * Each one takes the per-record distributions returned by
 * /analytics/merged/run-all, so every page draws the same quantity the same
 * way. Each also renders its own denominator and definition, because a
 * figure without them cannot be interpreted.
 */

/** Horizontal bar with a reference line at 100% of seated capacity. */
export function LoadFactorBar({ name, pct, logCount, max }) {
  const scale = Math.max(max, 110);
  const st = capacityStatus(pct);
  return (
    <div className="rs-bar-row">
      <span className="rs-bar-name">{name}</span>
      <div className="rs-bar-track">
        <div
          className="rs-bar-fill"
          style={{
            width: `${Math.min((pct / scale) * 100, 100)}%`,
            background: st.fill,
          }}
        />
        <span
          className="rs-bar-ref"
          style={{ left: `${(100 / scale) * 100}%` }}
          title="100% — all seats filled"
          aria-hidden="true"
        />
      </div>
      <span className="rs-bar-val" style={{ color: st.on }}>
        {pct.toFixed(2)}%
        <span className="rs-sr">
          , {st.label}, from {logCount} recorded observations
        </span>
      </span>
    </div>
  );
}

/** Mean load factor per operating period, computed per GPS log record. */
export function LoadFactorByPeriod({ byPeriod, capacity }) {
  if (!byPeriod) {
    return <UnavailableState reason="The analytics response carried no per-period load factor." />;
  }
  const max = Math.max(110, ...PERIOD_ORDER.map((n) => byPeriod[n]?.avg_lf ?? 0));
  return (
    <>
      <div className="rs-bars">
        {PERIOD_ORDER.map((name) => {
          const p = byPeriod[name];
          if (!p || !p.log_count) {
            return (
              <div className="rs-bar-row" key={name}>
                <span className="rs-bar-name">{name}</span>
                <div className="rs-bar-track" />
                <span className="rs-bar-val"
                  style={{ fontSize: 11, fontWeight: 500, color: "var(--rs-text-3)" }}>
                  No records
                </span>
              </div>
            );
          }
          return (
            <LoadFactorBar key={name} name={name} pct={p.avg_lf}
              logCount={p.log_count} max={max} />
          );
        })}
      </div>
      {/* A short, scannable key. The full definition lives in the page's
          collapsed details section, not above the fold. */}
      <div className="rs-caplegend">
        <span className="rs-caplegend-ref" aria-hidden="true" />
        <span>
          <strong>100% = all {capacity != null ? `${capacity} ` : ""}seats filled.</strong>{" "}
          Bars show mean passenger load against seated capacity.
        </span>
        <span className="rs-caplegend-keys">
          <span className="rs-caplegend-key">
            <i style={{ background: "var(--rs-fill-normal)" }} />below 90%
          </span>
          <span className="rs-caplegend-key">
            <i style={{ background: "var(--rs-fill-moderate)" }} />90–100%
          </span>
          <span className="rs-caplegend-key">
            <i style={{ background: "var(--rs-fill-critical)" }} />above 100%
          </span>
        </span>
      </div>
    </>
  );
}

/** The four demand tiers as a stacked bar plus a table of counts and shares. */
/** The passenger-count band behind each tier, shown next to its label. */
const TIER_BAND = {
  Normal: "26 or fewer",
  Moderate: "27 to 31",
  High: "32 to 36",
  Critical: "37 or more",
};

export function DemandDistribution({ distribution, totalLogs }) {
  if (!distribution) {
    return <UnavailableState reason="The analytics response carried no demand distribution." />;
  }
  return (
    <>
      <div
        className="rs-stack"
        role="img"
        aria-label={TIER_ORDER
          .map((t) => `${t} ${(distribution[t]?.pct ?? 0).toFixed(2)}%`)
          .join(", ")}
      >
        {TIER_ORDER.map((t) => {
          const pct = distribution[t]?.pct ?? 0;
          if (pct <= 0) return null;
          return (
            <div
              key={t}
              className="rs-stack-seg"
              style={{ width: `${pct}%`, background: DEMAND_COLOR[t] }}
              title={`${t}: ${pct.toFixed(2)}% (${(distribution[t]?.count ?? 0).toLocaleString()} records)`}
            />
          );
        })}
      </div>

      <div className="rs-tablewrap" style={{ marginTop: 14 }}>
        <table className="rs-table">
          <thead>
            <tr>
              <th scope="col">Passenger demand level</th>
              <th scope="col">Passengers aboard</th>
              <th scope="col" className="rs-num">Observations</th>
              <th scope="col" className="rs-num">Share</th>
            </tr>
          </thead>
          <tbody>
            {TIER_ORDER.map((t) => (
              <tr key={t}>
                <td>
                  <span className="rs-pill"
                    style={{ background: `${DEMAND_COLOR[t]}26`, color: DEMAND_COLOR[t] }}>
                    {t} demand
                  </span>
                </td>
                <td className="rs-tierband">{TIER_BAND[t]}</td>
                <td className="rs-num">{(distribution[t]?.count ?? 0).toLocaleString()}</td>
                <td className="rs-num">{(distribution[t]?.pct ?? 0).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalLogs != null && (
        <p className="rs-chart-caption">
          Share of {totalLogs.toLocaleString()} recorded observations. Each observation is
          classified on its own passenger count, not on the trip it belongs to.
        </p>
      )}
    </>
  );
}

/** Share of GPS log records per operating period. */
export function TimeDistribution({ distribution, note = true }) {
  if (!distribution) {
    return <UnavailableState reason="The analytics response carried no time distribution." />;
  }
  return (
    <>
      <div className="rs-bars">
        {PERIOD_ORDER.map((name) => {
          const pct = distribution[name]?.pct ?? 0;
          const count = distribution[name]?.count ?? 0;
          return (
            <div className="rs-bar-row" key={name}>
              <span className="rs-bar-name">{name}</span>
              <div className="rs-bar-track">
                {/* One neutral colour on purpose. PERIOD_COLOR reuses the
                    demand-tier hexes (Afternoon Peak is the Critical red),
                    which made a collection-schedule chart read as a demand
                    chart. */}
                <div className="rs-bar-fill"
                  style={{ width: `${pct}%`, background: COLLECTION_FILL }} />
              </div>
              <span className="rs-bar-val">
                {pct.toFixed(1)}%
                <span className="rs-sr">, {count} recorded observations</span>
              </span>
            </div>
          );
        })}
      </div>
      {note && (
        <p className="rs-chart-caption">
            When recording happened across the selected trips, in PHT. This is the
            collection schedule, not a measure of demand — use capacity by operating
            period for that.
          </p>
      )}
    </>
  );
}
