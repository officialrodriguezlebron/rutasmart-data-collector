import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getAggregateDashboard } from "../../services/api";
import { goodColor, dirLabel, periodColorCard, PERIOD_COLOR, DEMAND_COLOR } from "../../utils/adminFormatters";
import TripMap from "../TripMap";
import "../AdminDashboard.css";

function MetricCard({ label, value, sub, accent }) {
  return (
    <div className="admin-metric-card">
      {accent && <div className="admin-metric-accent" style={{ background: accent }} />}
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value" style={{ color: accent || "white" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── Horizontal stacked bar (all periods in one row) ───────────────────────────
function StackedBar({ distribution, colorMap }) {
  const total = Object.values(distribution).reduce((s, c) => s + c, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
        {Object.entries(distribution).map(([period, count]) => (
          <div key={period}
            style={{ width: `${(count / total) * 100}%`, background: colorMap[period] || "#8e9ab0", minWidth: count > 0 ? 2 : 0 }}
            title={`${period}: ${count}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {Object.entries(distribution).map(([period, count]) => (
          <div key={period} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: colorMap[period] || "#8e9ab0", flexShrink: 0 }} />
            <span style={{ color: "rgba(255,255,255,0.55)" }}>{period}</span>
            <span style={{ color: colorMap[period] || "#8e9ab0", fontWeight: 700 }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SVG donut chart ───────────────────────────────────────────────────────────
function DonutChart({ segments, size = 80 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = 28; const cx = size / 2; const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let accumulated = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {segments.map(seg => {
          const dash    = (seg.value / total) * circumference;
          const offset  = accumulated;
          accumulated  += dash;
          return (
            <circle key={seg.label} cx={cx} cy={cy} r={r}
              fill="none" stroke={seg.color} strokeWidth={12}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
        })}
        {/* Donut hole */}
        <circle cx={cx} cy={cy} r={20} fill="#05101f" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
            <span style={{ color: "rgba(255,255,255,0.55)" }}>{seg.label}</span>
            <span style={{ color: seg.color, fontWeight: 700, fontFamily: "var(--mono)" }}>{seg.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminCorridors() {
  const [aggregate,  setAggregate]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [mapTripId,  setMapTripId]  = useState(null);

  const load = () => {
    setLoading(true);
    getAggregateDashboard()
      .then(r => setAggregate(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const summaries = aggregate?.trip_summaries || [];

  // Build demand distribution segments (merge Critical→High, Moderate→Medium, Normal→Low)
  const demandSegments = (() => {
    if (!aggregate?.demand_distribution) return [];
    const d = aggregate.demand_distribution;
    const merged = {
      "High Demand":   (d.High || 0) + (d.Critical || 0),
      "Medium Demand": d.Moderate || 0,
      "Low Demand":    d.Normal   || 0,
    };
    return [
      { label: "High Demand",   value: merged["High Demand"],   color: "#ff453a" },
      { label: "Medium Demand", value: merged["Medium Demand"], color: "#ffd60a" },
      { label: "Low Demand",    value: merged["Low Demand"],    color: "#30d158" },
    ].filter(s => s.value > 0);
  })();

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <div className="admin-topbar">
          <h1>Corridor Analysis</h1>
          <button className="admin-refresh" onClick={load} disabled={loading}>↺ Refresh</button>
        </div>

        {loading ? (
          <div className="admin-loading">Computing aggregate data across all trips…</div>
        ) : !aggregate ? (
          <div className="admin-loading">No data available.</div>
        ) : (
          <>
            <div className="admin-metrics">
              <MetricCard label="Trips Analyzed"    value={aggregate.total_trips}                  sub="Completed trips"    accent="#42a5f5" />
              <MetricCard label="Total GPS Logs"    value={aggregate.total_logs?.toLocaleString()} sub="Signal pings total" accent="#00b4d8" />
              <MetricCard label="Avg Load Factor"   value={`${aggregate.avg_load_factor_pct}%`}   sub="Across all trips"  accent={aggregate.avg_load_factor_pct > 100 ? "#ff453a" : "#30d158"} />
              <MetricCard label="Peak Period"       value={aggregate.peak_critical_period || "—"}  sub="Highest demand"    accent="#ff9f0a" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
              {/* Stacked bar replaces individual time period bars */}
              {aggregate.time_distribution && (
                <div className="admin-card">
                  <div className="admin-card-title">Trips by Time Period</div>
                  <StackedBar distribution={aggregate.time_distribution} colorMap={PERIOD_COLOR} />
                </div>
              )}
              {/* Donut replaces demand distribution bars */}
              {demandSegments.length > 0 && (
                <div className="admin-card">
                  <div className="admin-card-title">Demand Distribution</div>
                  <DonutChart segments={demandSegments} size={80} />
                </div>
              )}
            </div>

            {/* By-corridor bars — unchanged from Checkpoint 1 */}
            <div className="admin-card" style={{ marginBottom: 18 }}>
              <div className="admin-card-title">By Corridor</div>
              {[
                { label: "Malanday → Recto", dir: "MALANDAY-RECTO", color: "#42a5f5" },
                { label: "Recto → Malanday", dir: "RECTO-MALANDAY", color: "#00b4d8" },
              ].map(({ label, dir, color }) => {
                const ct   = summaries.filter(t => t.direction === dir);
                const avg  = ct.length ? ct.reduce((s, t) => s + (t.good_pct || 0), 0) / ct.length : 0;
                const logs = ct.reduce((s, t) => s + (t.log_count || 0), 0);
                return (
                  <div key={dir} className="agg-bar-row" style={{ marginBottom: 14 }}>
                    <span className="agg-bar-label" style={{ width: 160, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
                      {label}
                    </span>
                    <div className="agg-bar-track">
                      <div className="agg-bar-fill" style={{ width: `${avg}%`, background: color }} />
                    </div>
                    <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, minWidth: 70, textAlign: "right" }}>{logs.toLocaleString()} logs</span>
                    <span style={{ fontWeight: 700, color, fontSize: 13, minWidth: 44, textAlign: "right" }}>{avg.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Trip Summaries with quality visual column */}
            <div className="admin-card">
              <div className="admin-card-title">
                Trip Summaries
                <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.42)", marginLeft: 8 }}>{summaries.length} completed trips</span>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: "0 0 10px" }}>
                Click <strong>Map</strong> on any trip to inspect its map-matched path, detected stop clusters, and demand heatmap.
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Trip ID</th><th>Date</th><th>Direction</th><th>Period</th><th>Pings</th><th>Signal Quality</th><th>Load Factor</th><th style={{ width: 70 }}>Map</th>
                  </tr></thead>
                  <tbody>
                    {summaries.map(t => {
                      const lf = typeof t.avg_lf_pct === "number" ? t.avg_lf_pct : null;
                      const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                      const pc = periodColorCard(t.dominant_period);
                      return (
                        <tr key={t.trip_id}>
                          <td className="admin-mono" title={t.trip_id} style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                          <td className="admin-mono" style={{ color: "#8e9ab0" }}>{t.date || "—"}</td>
                          <td style={{ fontSize: 11, fontWeight: 700, color: t.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8" }}>{dirLabel(t.direction)}</td>
                          <td><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 700 }}>{t.time_period || "—"}</span></td>
                          <td className="admin-mono">{t.log_count?.toLocaleString() || "—"}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
                              {gp != null ? `${typeof gp === "number" ? gp.toFixed(1) : gp}%` : "—"}
                            </span>
                            <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 99, marginTop: 3 }}>
                              {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 99 }} />}
                            </div>
                          </td>
                          <td style={{ fontWeight: 700, color: lf != null ? (lf > 120 ? "#ff453a" : lf > 80 ? "#ff9f0a" : "#30d158") : "#8e9ab0" }}>
                            {lf != null ? `${lf.toFixed(0)}%` : "—"}
                          </td>
                          <td>
                            <button onClick={() => setMapTripId(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>Map</button>
                          </td>
                        </tr>
                      );
                    })}
                    {summaries.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: "center", color: "rgba(255,255,255,0.38)", padding: "32px 0" }}>No completed trips to analyze.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {mapTripId && createPortal(
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />,
        document.body
      )}
    </>
  );
}
