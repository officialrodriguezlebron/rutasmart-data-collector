import { DEMAND_COLOR, PERIOD_COLOR } from "../../utils/adminFormatters";
import { TIER_ORDER, PERIOD_ORDER, DEF } from "./definitions";
import { UnavailableState } from "./EmptyState";

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
  const over = pct > 100;
  const scale = Math.max(max, 110);
  return (
    <div className="rs-bar-row">
      <span className="rs-bar-name">{name}</span>
      <div className="rs-bar-track">
        <div
          className="rs-bar-fill"
          style={{
            width: `${Math.min((pct / scale) * 100, 100)}%`,
            background: over ? "var(--rs-fill-critical)" : "var(--rs-fill-info)",
          }}
        />
        <span
          className="rs-bar-ref"
          style={{ left: `${(100 / scale) * 100}%` }}
          title="100% of seated capacity"
          aria-hidden="true"
        />
      </div>
      <span className="rs-bar-val" style={over ? { color: "var(--rs-on-critical)" } : undefined}>
        {pct.toFixed(2)}%
        <span className="rs-sr">
          {over ? ", over seated capacity" : ""}, from {logCount} GPS log records
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
      <dl className="rs-deflist">
        <div><b>Load factor.</b> {DEF.loadFactor}</div>
        {capacity != null && (
          <div><b>Capacity.</b> Official seated capacity C = {capacity} for this selection.</div>
        )}
      </dl>
    </>
  );
}

/** The four demand tiers as a stacked bar plus a table of counts and shares. */
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
              <th scope="col">Tier</th>
              <th scope="col" className="rs-num">GPS log records</th>
              <th scope="col" className="rs-num">Share</th>
            </tr>
          </thead>
          <tbody>
            {TIER_ORDER.map((t) => (
              <tr key={t}>
                <td>
                  <span className="rs-pill"
                    style={{ background: `${DEMAND_COLOR[t]}26`, color: DEMAND_COLOR[t] }}>
                    {t}
                  </span>
                </td>
                <td className="rs-num">{(distribution[t]?.count ?? 0).toLocaleString()}</td>
                <td className="rs-num">{(distribution[t]?.pct ?? 0).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalLogs != null && (
        <dl className="rs-deflist">
          <div>
            <b>Denominator.</b> Shares are of {totalLogs.toLocaleString()} GPS log
            records. Each record is classified on its own occupancy, not on the
            trip it belongs to.
          </div>
        </dl>
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
                <div className="rs-bar-fill"
                  style={{ width: `${pct}%`, background: PERIOD_COLOR[name] }} />
              </div>
              <span className="rs-bar-val">
                {pct.toFixed(1)}%
                <span className="rs-sr">, {count} GPS log records</span>
              </span>
            </div>
          );
        })}
      </div>
      {note && (
        <dl className="rs-deflist">
          <div>
            <b>Reading this chart.</b> These shares describe when recording
            happened across the selected trips, binned to Philippine Standard
            Time. They reflect the collection schedule, so they are not a
            measure of corridor activity by period. Use load factor for that.
          </div>
        </dl>
      )}
    </>
  );
}
