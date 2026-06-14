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
              {aggregate.time_distribution && (
                <div className="admin-card">
                  <div className="admin-card-title">Trips by Time Period</div>
                  {(() => {
                    const d = aggregate.time_distribution;
                    const max = Math.max(...Object.values(d), 1);
                    return Object.entries(d).map(([p, count]) => (
                      <div key={p} className="agg-bar-row">
                        <span className="agg-bar-label">{p}</span>
                        <div className="agg-bar-track">
                          <div className="agg-bar-fill" style={{ width: `${(count / max) * 100}%`, background: PERIOD_COLOR[p] || "#42a5f5" }} />
                        </div>
                        <span style={{ width: 20, textAlign: "right", fontWeight: 700, color: "#374151", fontSize: 13 }}>{count}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
              {aggregate.demand_distribution && (
                <div className="admin-card">
                  <div className="admin-card-title">Demand Distribution</div>
                  {(() => {
                    const d = aggregate.demand_distribution;
                    const max = Math.max(...Object.values(d), 1);
                    const TIER_LABEL = { Normal: "Low Demand", Moderate: "Medium Demand", High: "High Demand", Critical: "High Demand" };
                    return Object.entries(d).map(([tier, count]) => (
                      <div key={tier} className="agg-bar-row">
                        <span className="agg-bar-label" style={{ width: 80 }}>{TIER_LABEL[tier] || tier}</span>
                        <div className="agg-bar-track">
                          <div className="agg-bar-fill" style={{ width: `${(count / max) * 100}%`, background: DEMAND_COLOR[tier] || "#42a5f5" }} />
                        </div>
                        <span style={{ width: 55, textAlign: "right", fontWeight: 700, color: DEMAND_COLOR[tier] || "#374151", fontSize: 12, fontFamily: "var(--mono)" }}>{count.toLocaleString()}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

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

            <div className="admin-card">
              <div className="admin-card-title">
                Trip Summaries
                <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.42)", marginLeft: 8 }}>{summaries.length} completed trips</span>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: "0 0 10px" }}>
                Click <strong>🗺 Map</strong> on any trip to inspect its map-matched path, DBSCAN clusters, and demand heatmap.
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Trip ID</th><th>Date</th><th>Direction</th><th>Period</th><th>Pings</th><th>Signal Quality</th><th>Load Factor</th><th style={{ width: 70 }}>Map</th>
                  </tr></thead>
                  <tbody>
                    {summaries.map(t => {
                      const lf = typeof t.avg_load_factor_pct === "number" ? t.avg_load_factor_pct : null;
                      const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                      const pc = periodColorCard(t.time_period);
                      return (
                        <tr key={t.trip_id}>
                          <td className="admin-mono" title={t.trip_id} style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                          <td className="admin-mono" style={{ color: "#8e9ab0" }}>{t.date || "—"}</td>
                          <td style={{ fontSize: 11, fontWeight: 700, color: t.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8" }}>{dirLabel(t.direction)}</td>
                          <td><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 700 }}>{t.time_period || "—"}</span></td>
                          <td className="admin-mono">{t.log_count?.toLocaleString() || "—"}</td>
                          <td style={{ fontWeight: 700, color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
                            {gp != null ? `${typeof gp === "number" ? gp.toFixed(1) : gp}%` : "—"}
                          </td>
                          <td style={{ fontWeight: 700, color: lf != null ? (lf > 120 ? "#ff453a" : lf > 80 ? "#ff9f0a" : "#30d158") : "#8e9ab0" }}>
                            {lf != null ? `${lf.toFixed(0)}%` : "—"}
                          </td>
                          <td>
                            <button onClick={() => setMapTripId(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>🗺 Map</button>
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
