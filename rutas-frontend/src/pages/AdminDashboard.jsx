import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  getAdminStats, getAdminTrips, deleteTrip, exportTrip,
  importTripCSV, createUser, getConductors,
  getAggregateDashboard, publishStopZones,
} from "../services/api";
import { authService } from "../services/authService";
import TripMap from "./TripMap";
import StopZonePublishPreview from "../components/StopZonePublishPreview";
import StopZoneManagement from "./StopZoneManagement";
import "./AdminDashboard.css";

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    overview:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
    trips:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />,
    conductors: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
    aggregate:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
    analytics:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />,
    stopzones:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
    bus:        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 17h8M3 9h18M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM7 17v2m10-2v2" />,
    clock:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
    chevron:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />,
  };
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0 }}>
      {icons[name]}
    </svg>
  );
};

const NAV = [
  { id: "overview",   label: "Overview"   },
  { id: "trips",      label: "Trips"      },
  { id: "conductors", label: "Conductors" },
  { id: "aggregate",  label: "Aggregate"  },
  { id: "analytics",  label: "Analytics"  },
  { id: "stopzones",  label: "Stop Zones" },
  { id: "zonemgmt",   label: "Zone Mgmt"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const goodColor   = (v) => v >= 88 ? "#30d158" : v >= 78 ? "#ffd60a" : "#ff453a";
const statusColor = (s) => s === "ACTIVE" ? "#30d158" : s === "COMPLETED" ? "#42a5f5" : "#8e9ab0";
const dirLabel    = (d) => d === "MALANDAY-RECTO" ? "Malanday → Recto" : d === "RECTO-MALANDAY" ? "Recto → Malanday" : (d || "—");

const periodColor = (p) => {
  if (!p) return { bg: "rgba(255,255,255,0.12)", text: "rgba(255,255,255,0.70)" };
  if (p.includes("Morning"))   return { bg: "rgba(255,214,10,0.18)",  text: "#ffd60a" };
  if (p.includes("Off"))       return { bg: "rgba(48,209,88,0.18)",   text: "#30d158" };
  if (p.includes("Afternoon")) return { bg: "rgba(66,165,245,0.18)",  text: "#42a5f5" };
  return { bg: "rgba(191,90,242,0.18)", text: "#bf5af2" };
};

// Same palette as periodColor — all cards are now dark glass
const periodColorCard = periodColor;

const PERIOD_COLOR = { "Morning Peak": "#ffd60a", "Midday": "#42a5f5", "Afternoon Peak": "#ff453a", "Off-Peak": "#30d158" };
const DEMAND_COLOR = { Normal: "#30d158", Moderate: "#ffd60a", High: "#ff9f0a", Critical: "#ff453a" };

const phtDateStr = (utcStr) => {
  if (!utcStr) return "—";
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  d.setHours(d.getHours() + 8);
  return d.toISOString().slice(0, 10);
};
const phtTimeStr = (utcStr) => {
  if (!utcStr) return "—";
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  d.setHours(d.getHours() + 8);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

// ─── Metric card (dark glass) ─────────────────────────────────────────────────
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

// ─── Corridor glass card (dark, floating) ─────────────────────────────────────
function CorridorCard({ label, avg, count, color }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.10)",
      backdropFilter: "saturate(180%) blur(20px)",
      WebkitBackdropFilter: "saturate(180%) blur(20px)",
      border: "1px solid rgba(255,255,255,0.16)",
      borderRadius: 20,
      padding: "22px 24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.80)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 38, fontWeight: 800, color, letterSpacing: "-1.5px", lineHeight: 1, marginBottom: 6 }}>
        {count ? `${avg.toFixed(1)}%` : "—"}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        avg GOOD rate · {count} trips
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${avg}%`, background: color, borderRadius: 99, transition: "width .6s ease" }} />
      </div>
    </div>
  );
}

// ─── PublishStopZonesPanel ────────────────────────────────────────────────────
function PublishStopZonesPanel() {
  const [aggTrips,     setAggTrips]     = useState([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [showPreview,  setShowPreview]  = useState(false);

  useEffect(() => {
    getAggregateDashboard()
      .then(r => setAggTrips(r.data.trip_summaries || []))
      .catch(() => setAggTrips([]))
      .finally(() => setTripsLoading(false));
  }, []);

  const byDate = {};
  for (const t of aggTrips) {
    if (!byDate[t.date]) byDate[t.date] = { "MALANDAY-RECTO": [], "RECTO-MALANDAY": [] };
    if (t.direction in byDate[t.date]) byDate[t.date][t.direction].push(t);
  }
  const sortedDates = Object.keys(byDate).sort();

  const handlePublish = async () => {
    if (!window.confirm(
      "Publish stop zones for MR-001 (both directions)?\n\n" +
      "Runs DBSCAN across all completed trips for Malanday→Recto and Recto→Malanday " +
      "and updates the passenger map."
    )) return;
    setLoading(true);
    setStatus(null);
    try {
      const [resMR, resRM] = await Promise.all([
        publishStopZones("MR-001", "MALANDAY-RECTO"),
        publishStopZones("MR-001", "RECTO-MALANDAY"),
      ]);
      setStatus({
        ok: true,
        lines: [
          `Malanday → Recto: ${resMR.data.stop_zones} stop zones published (${resMR.data.logs_analyzed?.toLocaleString()} logs)`,
          `Recto → Malanday: ${resRM.data.stop_zones} stop zones published (${resRM.data.logs_analyzed?.toLocaleString()} logs)`,
        ],
      });
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || "Publish failed.";
      setStatus({ ok: false, lines: [detail] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="admin-card-title" style={{ justifyContent: "space-between" }}>
        <span>🗺 Passenger Stop Zone Map</span>
        <button
          onClick={() => setShowPreview(true)}
          disabled={tripsLoading || aggTrips.length === 0}
          style={{
            padding: "7px 16px",
            background: tripsLoading || aggTrips.length === 0
              ? "rgba(0,0,0,0.10)" : "linear-gradient(135deg,#1044a3,#1565c0)",
            color: tripsLoading || aggTrips.length === 0 ? "#8e9ab0" : "white",
            border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700,
            cursor: tripsLoading || aggTrips.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "var(--font)", boxShadow: tripsLoading || aggTrips.length === 0 ? "none" : "0 4px 12px rgba(16,68,163,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          📤 Publish Stop Zones
        </button>
      </div>
      <p className="admin-card-desc">
        RutaSmart identifies high-demand passenger activity areas from collected GPS data and recommends stop zones for transport planners. Review both corridors before publishing to the passenger map.
      </p>

      {tripsLoading ? (
        <div style={{ fontSize: 13, color: "#8e9ab0" }}>Loading trips…</div>
      ) : sortedDates.length === 0 ? (
        <div style={{ fontSize: 13, color: "#c62828" }}>No completed trips found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", padding: "2px 4px" }}>
            GOOD %:&nbsp;
            <span style={{ color: "#30d158", fontWeight: 700 }}>≥95% excellent</span>
            {" · "}
            <span style={{ color: "#ffd60a", fontWeight: 700 }}>≥70% normal</span>
            {" · "}
            <span style={{ color: "#ff453a", fontWeight: 700 }}>&lt;70% degraded</span>
          </div>
          {sortedDates.map(date => (
            <div key={date}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <Icon name="clock" size={13} />
                <span style={{ fontSize: 12, fontWeight: 800, color: "#42a5f5", textTransform: "uppercase", letterSpacing: "0.06em" }}>📅 {date}</span>
              </div>
              {["MALANDAY-RECTO", "RECTO-MALANDAY"].map(dir => {
                const dirTrips = byDate[date][dir];
                if (!dirTrips.length) return null;
                return (
                  <div key={dir} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.40)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 4 }}>
                      {dirLabel(dir)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {dirTrips.map(t => {
                        const pc = periodColorCard(t.dominant_period || t.time_period);
                        const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                        const gpColor = gp == null ? "rgba(255,255,255,0.38)" : gp >= 95 ? "#30d158" : gp >= 70 ? "#ffd60a" : "#ff453a";
                        return (
                          <div key={t.trip_id} style={{
                            display: "grid", gridTemplateColumns: "64px 120px 1fr 88px",
                            alignItems: "center", gap: 8,
                            background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px",
                            border: "1px solid rgba(255,255,255,0.10)", fontSize: 12,
                          }}>
                            <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 600, fontFamily: "var(--mono)" }}>{t.pht_start || "—"}</span>
                            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {t.dominant_period || t.time_period || "—"}
                            </span>
                            <span style={{ color: "rgba(255,255,255,0.70)" }}>{t.log_count?.toLocaleString()} logs</span>
                            <span style={{ fontWeight: 700, textAlign: "right", fontSize: 12, color: gpColor }}>
                              {gp != null ? `${gp.toFixed(1)}%` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className={`admin-msg ${status.ok ? "success" : "error"}`} style={{ marginTop: 14 }}>
          {status.ok ? "✅ " : "❌ "}
          {status.lines.map((line, i) => <span key={i}>{line}{i < status.lines.length - 1 && <br />}</span>)}
        </div>
      )}

      {showPreview && (
        <StopZonePublishPreview
          routeId="MR-001"
          onClose={() => setShowPreview(false)}
          onSuccess={() => setStatus({ ok: true, lines: ["Stop zones published successfully."] })}
        />
      )}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function Overview({ stats, trips, aggregate }) {
  const summaries = aggregate?.trip_summaries || [];
  const mrTrips   = summaries.filter(t => t.direction === "MALANDAY-RECTO");
  const rmTrips   = summaries.filter(t => t.direction === "RECTO-MALANDAY");
  const mrAvg     = mrTrips.length ? mrTrips.reduce((s, t) => s + (t.good_pct || 0), 0) / mrTrips.length : 0;
  const rmAvg     = rmTrips.length ? rmTrips.reduce((s, t) => s + (t.good_pct || 0), 0) / rmTrips.length : 0;
  const allAvg    = summaries.length ? summaries.reduce((s, t) => s + (t.good_pct || 0), 0) / summaries.length : 0;
  const highQual  = summaries.filter(t => (t.good_pct || 0) >= 88).length;
  const recent    = [...trips].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, 5);

  const pubMR  = stats?.published_stops_mr  ?? 0;
  const pubRM  = stats?.published_stops_rm  ?? 0;
  const pubTot = stats?.published_stops_total ?? (pubMR + pubRM);

  const totalOcc    = stats?.total_occupancy_sum;
  const utilRate    = aggregate?.avg_load_factor_pct;
  const mostActive  = stats?.most_active_stop;
  const leastActive = stats?.least_active_stop;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Data collection narrative ──────────────────────────────────── */}
      <div style={{
        background: "rgba(66,165,245,0.08)", border: "1px solid rgba(66,165,245,0.20)",
        borderRadius: 12, padding: "12px 16px", marginBottom: 18, fontSize: 12,
        color: "rgba(255,255,255,0.60)", lineHeight: 1.6,
      }}>
        <span style={{ color: "#42a5f5", fontWeight: 700 }}>Field Dataset — </span>
        A total of <strong style={{ color: "rgba(255,255,255,0.85)" }}>20 trip recordings</strong> collected across a
        24-day field testing period (May 19 – June 11, 2026), covering both corridor directions
        across 14 distinct collection days, structured as two Scrum data-collection sprints
        (Sprint 1: May 19–28 · Sprint 2: June 1–11), averaging 1–2 trips per collection day.
      </div>

      {/* ── North-star operational KPIs ───────────────────────────────── */}
      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
        Operations Overview
      </div>
      <div className="admin-metrics" style={{ marginBottom: 20 }}>
        <MetricCard
          label="Total Passengers"
          value={totalOcc != null ? totalOcc.toLocaleString() : "—"}
          sub="Total occupancy readings across all logs"
          accent="#bf5af2"
        />
        <MetricCard
          label="Utilization Rate"
          value={utilRate != null ? `${utilRate.toFixed(1)}%` : "—"}
          sub="Avg load factor across all trips"
          accent={utilRate > 100 ? "#ff453a" : utilRate > 80 ? "#ff9f0a" : "#30d158"}
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

      {/* ── Stop Zone Intelligence ─────────────────────────────────────── */}
      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
        Stop Zone Intelligence
      </div>
      <div className="admin-metrics" style={{ marginBottom: 20 }}>
        <MetricCard label="Published Stop Zones" value={pubTot > 0 ? pubTot : "—"} sub={pubTot > 0 ? `MR: ${pubMR} · RM: ${pubRM}` : "Not yet published"} accent="#30d158" />
        <MetricCard label="Malanday → Recto"     value={pubMR > 0 ? `${pubMR} stops` : "—"} sub="Published corridor"   accent="#42a5f5" />
        <MetricCard label="Recto → Malanday"     value={pubRM > 0 ? `${pubRM} stops` : "—"} sub="Published corridor"   accent="#00b4d8" />
        <MetricCard label="Trips Analyzed"       value={summaries.length || stats?.total_trips || "—"}                    sub="For stop detection"  accent="#ffd60a" />
      </div>

      {/* ── System Health KPIs ────────────────────────────────────────── */}
      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, paddingLeft: 2 }}>
        System Health
      </div>
      <div className="admin-metrics">
        <MetricCard label="Total Trips"        value={stats?.total_trips}                                 sub="All corridors"        accent="#42a5f5" />
        <MetricCard label="GPS Logs"           value={stats?.total_logs?.toLocaleString()}                sub="Data points"          accent="#00b4d8" />
        <MetricCard label="Avg GOOD Rate"      value={summaries.length ? `${allAvg.toFixed(1)}%` : "—"} sub="Across all trips"     accent="#30d158" />
        <MetricCard label="High-Quality Trips" value={`${highQual}/${summaries.length}`}                 sub="≥ 88% GOOD threshold" accent="#ffd60a" />
      </div>

      {summaries.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
          <CorridorCard label="Malanday → Recto" avg={mrAvg} count={mrTrips.length} color="#42a5f5" />
          <CorridorCard label="Recto → Malanday" avg={rmAvg} count={rmTrips.length} color="#00b4d8" />
        </div>
      )}

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

      <div className="admin-card">
        <div className="admin-card-title">System Health</div>
        <div className="admin-health-grid">
          {[["API Server (Railway)", "UP"], ["PostgreSQL 15 (Railway)", "UP"], ["PWA (Vercel)", "UP"]].map(([svc, st]) => (
            <div key={svc} className="admin-health-row">
              <span className="admin-health-dot" />
              <span>{svc}</span>
              <span className="admin-health-status">{st}</span>
            </div>
          ))}
        </div>
        <p className="admin-health-note">Backend · Railway · FastAPI + PostgreSQL 15 &nbsp;|&nbsp; Frontend · Vercel · React PWA</p>
      </div>
    </div>
  );
}

// ─── Trips Tab ────────────────────────────────────────────────────────────────
function TripsTab({ trips, aggregate, onDelete, onExport, onMap, exportingId, exportDoneId, deletingId, importMessage, importing, onImportFile }) {
  const [expanded, setExpanded] = useState(null);
  const [search,   setSearch]   = useState("");
  const [statusF,  setStatusF]  = useState("all");
  const [dirF,     setDirF]     = useState("all");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 12;

  const summaryMap = {};
  for (const s of (aggregate?.trip_summaries || [])) summaryMap[s.trip_id] = s;

  const filtered = trips.filter(t => {
    const q = search.toLowerCase();
    return (!q || t.trip_id?.toLowerCase().includes(q) || t.jeep_code?.toLowerCase().includes(q))
      && (statusF === "all" || t.status === statusF)
      && (dirF    === "all" || t.direction === dirF);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const grouped = {};
  for (const t of paginated) {
    const k = phtDateStr(t.start_time);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(t);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {importMessage && (
        <div className={`admin-msg ${importMessage.type}`} style={{ marginBottom: 14 }}>{importMessage.text}</div>
      )}

      <div className="admin-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div className="trips-filter-bar">
          <input
            className="trips-search"
            placeholder="🔍 Search trip ID, jeep code…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <select className="trips-filter-select" value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); }}>
            <option value="all">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="ACTIVE">Active</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select className="trips-filter-select" value={dirF} onChange={e => { setDirF(e.target.value); setPage(1); }}>
            <option value="all">All directions</option>
            <option value="MALANDAY-RECTO">Malanday → Recto</option>
            <option value="RECTO-MALANDAY">Recto → Malanday</option>
          </select>
          <span className="trips-count">{filtered.length} trip{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div style={{ padding: "8px 20px 12px", background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
            All GOOD-flagged logs from every completed trip are pooled into DBSCAN to detect passenger stop zones.
          </span>
        </div>

        <div style={{ padding: "0 16px 8px" }}>
          {Object.entries(grouped).map(([date, dayTrips]) => (
            <div key={date}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 4px 5px" }}>
                <Icon name="clock" size={13} />
                <span style={{ fontSize: 11, fontWeight: 800, color: "#42a5f5", textTransform: "uppercase", letterSpacing: "0.08em" }}>{date}</span>
              </div>
              {dayTrips.map(t => {
                const s    = summaryMap[t.trip_id];
                const gp   = s?.good_pct;
                const per  = s?.dominant_period || s?.time_period;
                const pc   = periodColorCard(per);
                const sc   = statusColor(t.status);
                const open = expanded === t.trip_id;
                return (
                  <div key={t.trip_id} style={{ marginBottom: 4 }}>
                    <div
                      onClick={() => setExpanded(open ? null : t.trip_id)}
                      style={{
                        display: "grid", gridTemplateColumns: "88px 120px 1fr 78px 86px 32px",
                        alignItems: "center", gap: 10, padding: "9px 12px",
                        background: open ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${open ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 10, cursor: "pointer", transition: "background .12s",
                      }}
                    >
                      <span className="admin-status-badge" style={{ background: sc + "18", color: sc, fontSize: 10, padding: "3px 8px", textAlign: "center" }}>{t.status}</span>
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {per || dirLabel(t.direction)}
                      </span>
                      <div style={{ height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
                        {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 99 }} />}
                      </div>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", textAlign: "right", fontFamily: "var(--mono)" }}>{(s?.log_count ?? t.log_count)?.toLocaleString() || "—"}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
                        {gp != null ? `${typeof gp === "number" ? gp.toFixed(1) : gp}%` : "—"}
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.40)", display: "flex", justifyContent: "center", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>
                        <Icon name="chevron" size={13} />
                      </span>
                    </div>

                    {open && (
                      <div style={{ padding: "12px 12px 10px", marginTop: 2, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
                          {[
                            ["Trip ID",    t.trip_id],
                            ["Jeep Code",  t.jeep_code || t.recorder_id || "—"],
                            ["Start (PHT)", phtTimeStr(t.start_time)],
                            ...(s ? [
                              ["GOOD Logs",   s.good_count?.toLocaleString() || "—"],
                              ["Total Logs",  s.log_count?.toLocaleString()  || "—"],
                              ["Load Factor", s.avg_load_factor_pct != null ? `${s.avg_load_factor_pct.toFixed(0)}%` : "—"],
                            ] : []),
                          ].map(([lbl, val]) => (
                            <div key={lbl}>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 2 }}>{lbl}</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.88)", fontFamily: lbl === "Trip ID" ? "var(--mono)" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lbl === "Trip ID" ? t.trip_id : undefined}>{val}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 7 }}>
                          <button onClick={() => onMap(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>🗺 Map</button>
                          <button onClick={() => onExport(t.trip_id, t.jeep_code)} disabled={exportingId === t.trip_id} className="trips-action-btn"
                            style={{ background: exportDoneId === t.trip_id ? "rgba(48,209,88,0.10)" : "rgba(66,165,245,0.10)", color: exportDoneId === t.trip_id ? "#1a6630" : "#42a5f5", border: `1px solid ${exportDoneId === t.trip_id ? "rgba(48,209,88,0.30)" : "rgba(66,165,245,0.30)"}` }}>
                            {exportingId === t.trip_id ? "…" : exportDoneId === t.trip_id ? "✓ Done" : "⬇ CSV"}
                          </button>
                          <button onClick={() => onDelete(t.trip_id)} disabled={deletingId === t.trip_id} className="trips-action-btn" style={{ background: "rgba(255,69,58,0.10)", color: "#c62828", border: "1px solid rgba(255,69,58,0.25)" }}>
                            {deletingId === t.trip_id ? "…" : "🗑 Delete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "rgba(255,255,255,0.38)", fontSize: 14 }}>No trips match your filters.</div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="trips-pagination">
            {[["«", 1], ["‹", Math.max(1, page - 1)]].map(([lbl, t]) => (
              <button key={lbl} className="trips-page-btn" onClick={() => setPage(t)} disabled={page === 1}>{lbl}</button>
            ))}
            <span className="trips-page-info">Page {page} of {totalPages}</span>
            {[["›", Math.min(totalPages, page + 1)], ["»", totalPages]].map(([lbl, t]) => (
              <button key={lbl} className="trips-page-btn" onClick={() => setPage(t)} disabled={page === totalPages}>{lbl}</button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Import Trip CSV</div>
        <p className="admin-card-desc">Drag a CSV file onto the page or click below to import a previously exported trip.</p>
        <label className="admin-import-btn" style={{ opacity: importing ? 0.6 : 1, cursor: importing ? "not-allowed" : "pointer" }}>
          {importing ? "Importing…" : "📂 Choose CSV"}
          <input type="file" accept=".csv" style={{ display: "none" }} onChange={onImportFile} disabled={importing} />
        </label>
      </div>
    </div>
  );
}

// ─── Conductors Tab ───────────────────────────────────────────────────────────
function ConductorsTab({ conductors, onRefresh }) {
  const [name,  setName]  = useState("");
  const [empId, setEmpId] = useState("");
  const [pin,   setPin]   = useState("");
  const [jeep,  setJeep]  = useState("");
  const [busy,  setBusy]  = useState(false);
  const [msg,   setMsg]   = useState(null);

  const create = async () => {
    if (!name || !empId || pin.length !== 6) {
      setMsg({ type: "error", text: "All fields required. PIN must be exactly 6 digits." });
      return;
    }
    setBusy(true);
    try {
      await createUser({ role: "CONDUCTOR", display_name: name, employee_id: empId, pin, jeep_code: jeep || undefined });
      setMsg({ type: "success", text: `Conductor "${name}" (${empId}) created.` });
      setName(""); setEmpId(""); setPin(""); setJeep("");
      onRefresh();
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Failed to create." });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-card">
        <div className="admin-card-title">Conductors ({conductors.length})</div>
        {conductors.length === 0 ? (
          <p className="admin-empty">No conductors yet.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {conductors.map(c => {
              const init = (c.display_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div key={c.user_id} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div className="admin-user-avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{init}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.90)" }}>{c.display_name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{c.employee_id}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[["Jeep Code", c.jeep_code || "—"], ["Created", c.created_at?.slice(0, 10) || "—"]].map(([lbl, val]) => (
                      <div key={lbl} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 2 }}>{lbl}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Create Conductor Account</div>
        {msg && <div className={`admin-msg ${msg.type}`} style={{ marginBottom: 14 }}>{msg.text}</div>}
        <div className="admin-conductor-form">
          <div className="admin-form-row">
            {[
              { label: "Display Name",   v: name,  s: setName,  ph: "e.g. Juan dela Cruz" },
              { label: "Employee ID",    v: empId, s: setEmpId, ph: "e.g. EMP-001" },
              { label: "PIN (6 digits)", v: pin,   s: setPin,   ph: "6-digit PIN", type: "password" },
              { label: "Jeep Code",      v: jeep,  s: setJeep,  ph: "e.g. MR-001 (optional)" },
            ].map(({ label, v, s, ph, type }) => (
              <div key={label} className="admin-form-field">
                <label>{label}</label>
                <input type={type || "text"} value={v} onChange={e => s(e.target.value)} placeholder={ph} />
              </div>
            ))}
          </div>
          <button className="admin-create-btn" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "➕ Create Conductor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Aggregate Tab ────────────────────────────────────────────────────────────
function AggregateTab({ aggregate, aggLoading, onMap }) {
  if (aggLoading) return <div className="admin-loading">Computing aggregate data across all trips…</div>;
  if (!aggregate) return <div className="admin-loading">No data available.</div>;

  const summaries = aggregate.trip_summaries || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-metrics">
        <MetricCard label="Trips Analyzed"    value={aggregate.total_trips}                  sub="Completed trips"   accent="#42a5f5" />
        <MetricCard label="Total GPS Logs"    value={aggregate.total_logs?.toLocaleString()} sub="Pooled for DBSCAN" accent="#00b4d8" />
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
              return Object.entries(d).map(([tier, count]) => (
                <div key={tier} className="agg-bar-row">
                  <span className="agg-bar-label" style={{ width: 80 }}>{tier}</span>
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
              <th>Trip ID</th><th>Date</th><th>Direction</th><th>Period</th><th>Logs</th><th>GOOD %</th><th>Load Factor</th><th style={{ width: 70 }}>Map</th>
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
                      <button onClick={() => onMap(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>🗺 Map</button>
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
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────
function AnalyticsTab({ aggregate }) {
  const summaries = aggregate?.trip_summaries || [];
  const mrGood = summaries.filter(t => t.direction === "MALANDAY-RECTO").reduce((s, t) => s + (t.good_count || 0), 0);
  const rmGood = summaries.filter(t => t.direction === "RECTO-MALANDAY").reduce((s, t) => s + (t.good_count || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-card">
        <div className="admin-card-title">DBSCAN Pipeline Readiness</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "Malanday → Recto", good: mrGood,         color: "#42a5f5" },
            { label: "Recto → Malanday", good: rmGood,         color: "#00b4d8" },
            { label: "Combined Pool",    good: mrGood + rmGood, color: "#30d158" },
          ].map(({ label, good, color }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(255,255,255,0.14)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: good > 1000 ? "#30d158" : "#ff453a" }} />
                <span style={{ fontSize: 10, color: good > 1000 ? "#30d158" : "#ff453a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{good > 1000 ? "Ready" : "Insufficient"}</span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: "-0.5px", fontFamily: "var(--mono)" }}>{good.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.06em" }}>GOOD log points</div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Trip Quality Trend</div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr>
              <th>Trip ID</th><th>Date</th><th>Corridor</th><th>Period</th><th>Logs</th><th>GOOD %</th><th>Quality</th>
            </tr></thead>
            <tbody>
              {[...summaries].sort((a, b) => (b.good_pct || 0) - (a.good_pct || 0)).map(t => {
                const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                const pc = periodColorCard(t.time_period);
                return (
                  <tr key={t.trip_id}>
                    <td className="admin-mono" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                    <td className="admin-mono" style={{ color: "#8e9ab0" }}>{t.date || "—"}</td>
                    <td style={{ fontSize: 11, fontWeight: 700, color: t.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8" }}>{dirLabel(t.direction)}</td>
                    <td><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 700 }}>{t.time_period || "—"}</span></td>
                    <td className="admin-mono">{t.log_count?.toLocaleString() || "—"}</td>
                    <td style={{ fontWeight: 700, color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
                      {gp != null ? `${typeof gp === "number" ? gp.toFixed(1) : gp}%` : "—"}
                    </td>
                    <td>
                      <div style={{ width: 60, height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
                        {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 99 }} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {summaries.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "32px 0", textAlign: "center", color: "rgba(255,255,255,0.38)" }}>No trip data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const user     = authService.getUser();

  const [stats,      setStats]      = useState(null);
  const [trips,      setTrips]      = useState([]);
  const [conductors, setConductors] = useState([]);
  const [aggregate,  setAggregate]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [aggLoading, setAggLoading] = useState(false);
  const [tab,        setTab]        = useState("overview");

  const [deletingId,   setDeletingId]   = useState(null);
  const [exportingId,  setExportingId]  = useState(null);
  const [exportDoneId, setExportDoneId] = useState(null);
  const [mapTripId,    setMapTripId]    = useState(null);
  const [importing,    setImporting]    = useState(false);
  const [importMsg,    setImportMsg]    = useState(null);

  useEffect(() => {
    if (!authService.isAdmin()) { navigate("/login", { replace: true }); return; }
    fetchData();
    // Fetch aggregate immediately so Overview KPIs have data
    setAggLoading(true);
    getAggregateDashboard()
      .then(r => setAggregate(r.data))
      .catch(e => console.error("Aggregate:", e))
      .finally(() => setAggLoading(false));
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([getAdminStats(), getAdminTrips(), getConductors()]);
      setStats(s.data); setTrips(t.data); setConductors(c.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const refresh = () => { fetchData(); setAggregate(null); };

  const handleDelete = async (tripId) => {
    if (!window.confirm(`Delete trip ${tripId}?\n\nPermanently removes all GPS logs.`)) return;
    setDeletingId(tripId);
    try {
      const res = await deleteTrip(tripId);
      setImportMsg({ type: "success", text: `Deleted — ${res.data.logs_removed} logs removed.` });
      fetchData();
      setAggregate(prev => prev ? { ...prev, trip_summaries: prev.trip_summaries.filter(t => t.trip_id !== tripId) } : prev);
    } catch (e) {
      setImportMsg({ type: "error", text: e.response?.data?.detail || "Delete failed." });
    } finally { setDeletingId(null); }
  };

  const handleExport = async (tripId, jeepCode) => {
    if (exportingId === tripId) return;
    setExportingId(tripId); setExportDoneId(null);
    try {
      const res = await exportTrip(tripId);
      const fn  = `rutasmart_${(jeepCode || "trip").replace(/[^a-zA-Z0-9]/g, "_")}_${tripId.slice(-8)}_${new Date().toISOString().slice(0, 10)}.csv`;
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a   = document.createElement("a"); a.href = url; a.setAttribute("download", fn);
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
      setExportDoneId(tripId);
      setTimeout(() => setExportDoneId(null), 2500);
    } catch (e) {
      setImportMsg({ type: "error", text: e.response?.data?.detail || "Export failed." });
    } finally { setExportingId(null); }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg(null);
    try {
      const res = await importTripCSV(file);
      setImportMsg({ type: "success", text: `Imported "${res.data.imported}" — ${res.data.logs_imported} logs added.` });
      fetchData();
    } catch (err) {
      setImportMsg({ type: "error", text: err.response?.data?.detail || "Import failed." });
    } finally { setImporting(false); e.target.value = ""; }
  };

  const PAGE_TITLES = {
    overview:   "Overview",
    trips:      "Trips",
    conductors: "Conductors",
    aggregate:  "Aggregate Dashboard",
    analytics:  "Analytics",
    stopzones:  "Stop Zones",
    zonemgmt:   "Zone Management",
  };

  const renderPage = () => {
    if (loading) return <div className="admin-loading">Loading…</div>;
    switch (tab) {
      case "overview":   return <Overview stats={stats} trips={trips} aggregate={aggregate} />;
      case "trips":      return <TripsTab trips={trips} aggregate={aggregate} onDelete={handleDelete} onExport={handleExport} onMap={setMapTripId} exportingId={exportingId} exportDoneId={exportDoneId} deletingId={deletingId} importMessage={importMsg} importing={importing} onImportFile={handleImportFile} />;
      case "conductors": return <ConductorsTab conductors={conductors} onRefresh={fetchData} />;
      case "aggregate":  return <AggregateTab aggregate={aggregate} aggLoading={aggLoading} onMap={setMapTripId} />;
      case "analytics":  return <AnalyticsTab aggregate={aggregate} />;
      case "stopzones":  return <PublishStopZonesPanel />;
      case "zonemgmt":   return <StopZoneManagement />;
      default:           return null;
    }
  };

  const initials = (user?.display_name || "A").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <div className="admin-page">
        {/* ── Sidebar ── */}
        <aside className="admin-sidebar">
          <div className="admin-logo">
            <h2>RutaSmart</h2>
            <span>Admin Panel</span>
          </div>

          <div className="admin-user-info">
            <div className="admin-user-avatar">{initials}</div>
            <div>
              <div className="admin-user-name">{user?.display_name || "Admin"}</div>
              <div className="admin-user-role">Administrator</div>
            </div>
          </div>

          <nav className="admin-nav">
            <div className="admin-nav-section">Main</div>
            {NAV.map(n => (
              <button key={n.id}
                className={`admin-nav-item ${tab === n.id ? "active" : ""}`}
                onClick={() => setTab(n.id)}>
                {n.label}
              </button>
            ))}
          </nav>

          <button className="admin-signout" onClick={() => { authService.clearSession(); navigate("/login", { replace: true }); }}>
            Sign Out
          </button>
        </aside>

        {/* ── Main ── */}
        <main className="admin-main">
          <div className="admin-topbar">
            <h1>{PAGE_TITLES[tab]}</h1>
            <button className="admin-refresh" onClick={refresh}>↺ Refresh</button>
          </div>
          {renderPage()}
        </main>
      </div>

      {mapTripId && createPortal(
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />,
        document.body
      )}
    </>
  );
}
