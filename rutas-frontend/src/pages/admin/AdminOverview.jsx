import { useState, useEffect } from "react";
import { getAdminStats, getAdminTrips, getAggregateDashboard, getActionItems } from "../../services/api";
import { statusColor, dirLabel, phtDateStr } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

// ── Inline SVG sparkline (no deps) ────────────────────────────────────────────
function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) =>
    `${(i / Math.max(values.length - 1, 1)) * 56},${18 - (v / max) * 16}`
  ).join(" ");
  return (
    <svg width="56" height="20" style={{ display: "block", marginTop: 6, opacity: 0.85 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Metric card with optional sparkline ───────────────────────────────────────
function MetricCard({ label, value, sub, accent, sparkValues, sparkColor }) {
  return (
    <div className="admin-metric-card">
      {accent && <div className="admin-metric-accent" style={{ background: accent }} />}
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value" style={{ color: accent || "white" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 6 }}>{sub}</div>}
      {sparkValues && <Sparkline values={sparkValues} color={sparkColor || accent || "white"} />}
    </div>
  );
}

// ── Action items panel ────────────────────────────────────────────────────────
const ACTION_ACCENT = {
  formalize:   "#30d158",
  staffing:    "#42a5f5",
  consolidate: "#ff9f0a",
};

function ActionItemsPanel({ items }) {
  if (!items || items.length === 0) return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10, padding: "14px 20px", marginBottom: 20,
      fontSize: 12, color: "rgba(255,255,255,0.35)",
    }}>
      No action items at this time — publish stop zones to generate recommendations.
    </div>
  );
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
        {items.map((item) => {
          const accent = ACTION_ACCENT[item.type] || "#8e9ab0";
          return (
            <div key={item.priority} style={{
              display: "flex", alignItems: "flex-start", gap: 14,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderLeft: `3px solid ${accent}`,
              borderRadius: "0 8px 8px 0",
              padding: "11px 16px",
            }}>
              <span style={{
                flexShrink: 0, fontSize: 10, fontWeight: 800,
                padding: "3px 8px", borderRadius: 6,
                background: accent + "22", color: accent,
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>
                P{item.priority}
              </span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.55 }}>
                {item.headline}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", paddingLeft: 2 }}>
        Staffing signals are based on trip start time periods, not per-stop measurements.
      </div>
    </div>
  );
}

// ── Donut progress ring ───────────────────────────────────────────────────────
function DonutRing({ count, total = 70, color, label, sub }) {
  const r = 26;
  const cx = 40; const cy = 40;
  const circumference = 2 * Math.PI * r;
  const safeCount = Math.min(count || 0, total);
  const dash = (safeCount / total) * circumference;
  return (
    <div className="admin-metric-card" style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <svg width={80} height={80} style={{ marginBottom: 6 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          fill="white" fontSize={13} fontWeight={800} fontFamily="var(--font)">
          {safeCount}
        </text>
      </svg>
      <div className="admin-metric-label" style={{ textAlign: "center" }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 4, textAlign: "center" }}>{sub}</div>}
    </div>
  );
}

export default function AdminOverview() {
  const [stats,       setStats]       = useState(null);
  const [trips,       setTrips]       = useState([]);
  const [aggregate,   setAggregate]   = useState(null);
  const [actionItems, setActionItems] = useState([]);
  const [loading,     setLoading]     = useState(true);

  const load = () => {
    setLoading(true);
    Promise.allSettled([getAdminStats(), getAdminTrips(), getAggregateDashboard(), getActionItems()])
      .then(([s, t, a, ai]) => {
        if (s.status  === "fulfilled") setStats(s.value.data);
        if (t.status  === "fulfilled") setTrips(t.value.data);
        if (a.status  === "fulfilled") setAggregate(a.value.data);
        if (ai.status === "fulfilled") setActionItems(ai.value.data.items || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const summaries = aggregate?.trip_summaries || [];
  const recent    = [...trips].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, 5);

  const pubMR  = stats?.published_stops_mr  ?? 0;
  const pubRM  = stats?.published_stops_rm  ?? 0;
  const pubTot = stats?.published_stops_total ?? (pubMR + pubRM);

  const totalOcc    = stats?.total_occupancy_sum;
  const utilRate    = aggregate?.avg_load_factor_pct;
  const mostActive  = stats?.most_active_stop;
  const leastActive = stats?.least_active_stop;

  // ── Sparkline data (last 7 trip-days) ─────────────────────────────────────
  const byDate = {};
  for (const t of summaries) {
    const d = t.date || "unknown";
    if (!byDate[d]) byDate[d] = { logs: 0, loadFactors: [] };
    byDate[d].logs += t.log_count || 0;
    if (t.avg_load_factor_pct != null) byDate[d].loadFactors.push(t.avg_load_factor_pct);
  }
  const last7Dates     = Object.keys(byDate).sort().slice(-7);
  const passSparkVals  = last7Dates.map(d => byDate[d].logs);
  const utilSparkVals  = last7Dates.map(d => {
    const lf = byDate[d].loadFactors;
    return lf.length ? lf.reduce((s, v) => s + v, 0) / lf.length : 0;
  });
  const avgUtil = utilSparkVals.length
    ? utilSparkVals.reduce((s, v) => s + v, 0) / utilSparkVals.length : 0;
  const utilSparkColor = avgUtil > 100 ? "#ff453a" : avgUtil > 80 ? "#ff9f0a" : "#30d158";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Overview</h1>
        <button className="admin-refresh" onClick={load} disabled={loading}>↺ Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading…</div>
      ) : (
        <>
          {/* ── This Week's Action Items ───────────────────────────────── */}
          <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
            This Week&apos;s Action Items
          </div>
          <ActionItemsPanel items={actionItems} />

          {/* ── North-star operational KPIs ────────────────────────────── */}
          <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
            Operations Overview
          </div>
          <div className="admin-metrics" style={{ marginBottom: 20 }}>
            <MetricCard
              label="Total Passengers"
              value={totalOcc != null ? totalOcc.toLocaleString() : "—"}
              sub="Total occupancy readings across all logs"
              accent="#bf5af2"
              sparkValues={passSparkVals.length >= 2 ? passSparkVals : null}
              sparkColor="#bf5af2"
            />
            <MetricCard
              label="Utilization Rate"
              value={utilRate != null ? `${utilRate.toFixed(1)}%` : "—"}
              sub="Avg load factor across all trips"
              accent={utilRate > 100 ? "#ff453a" : utilRate > 80 ? "#ff9f0a" : "#30d158"}
              sparkValues={utilSparkVals.length >= 2 ? utilSparkVals : null}
              sparkColor={utilSparkColor}
            />
            <MetricCard
              label="Most Active Stop"
              value={mostActive?.name ?? (pubTot > 0 ? "Matched to GT" : "—")}
              sub={mostActive ? `${mostActive.demand_tier} · ${dirLabel(mostActive.direction)}` : "Publish zones to populate"}
              accent="#ff9f0a"
            />
            <MetricCard
              label="Least Active Stop"
              value={leastActive?.name ?? (pubTot > 0 ? "Matched to GT" : "—")}
              sub={leastActive ? `${leastActive.demand_tier} · ${dirLabel(leastActive.direction)}` : "Publish zones to populate"}
              accent="#ffd60a"
            />
          </div>

          {/* ── Stop Zone Intelligence (2 donut rings + 2 flat cards) ──── */}
          <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
            Stop Zone Intelligence
          </div>
          <div className="admin-metrics" style={{ marginBottom: 20 }}>
            <DonutRing
              count={pubMR}
              total={70}
              color="#42a5f5"
              label="Malanday → Recto"
              sub={`${pubMR} of 70 GT stops covered`}
            />
            <DonutRing
              count={pubRM}
              total={70}
              color="#00b4d8"
              label="Recto → Malanday"
              sub={`${pubRM} of 70 GT stops covered`}
            />
            <MetricCard
              label="Published Stop Zones"
              value={pubTot > 0 ? pubTot : "—"}
              sub={pubTot > 0 ? `MR: ${pubMR} · RM: ${pubRM}` : "Not yet published"}
              accent="#30d158"
            />
            <MetricCard
              label="Trips Analyzed"
              value={summaries.length || stats?.total_trips || "—"}
              sub="For stop detection"
              accent="#ffd60a"
            />
          </div>

          {/* ── Recent Trips ──────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <div className="admin-card">
              <div className="admin-card-title">
                Recent Trips
                <a href="/route/MR-001" target="_blank" rel="noreferrer" className="admin-public-link">🔗 Public Dashboard</a>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Trip ID</th><th>Direction</th><th>Status</th><th>Date (PHT)</th><th>Logs</th>
                  </tr></thead>
                  <tbody>
                    {recent.map(t => {
                      const sc = statusColor(t.status);
                      return (
                        <tr key={t.trip_id}>
                          <td className="admin-mono" title={t.trip_id} style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                          <td style={{ fontSize: 12, fontWeight: 600, color: t.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8" }}>{dirLabel(t.direction)}</td>
                          <td><span className="admin-status-badge" style={{ background: sc + "22", color: sc }}>{t.status}</span></td>
                          <td className="admin-mono">{phtDateStr(t.start_time)}</td>
                          <td className="admin-mono">{t.log_count?.toLocaleString() || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
