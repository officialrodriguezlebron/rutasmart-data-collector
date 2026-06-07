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
    logout:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />,
    upload:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />,
    refresh:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
  };
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0 }}>
      {icons[name]}
    </svg>
  );
};

const NAV = [
  { id: "overview",   label: "Overview",   icon: "overview"   },
  { id: "trips",      label: "Trips",      icon: "trips"      },
  { id: "conductors", label: "Conductors", icon: "conductors" },
  { id: "aggregate",  label: "Aggregate",  icon: "aggregate"  },
  { id: "analytics",  label: "Analytics",  icon: "analytics"  },
  { id: "stopzones",  label: "Stop Zones", icon: "stopzones"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const goodColor   = (v) => v >= 88 ? "#22c55e" : v >= 78 ? "#f59e0b" : "#ef4444";
const statusColor = (s) => s === "ACTIVE" ? "#22c55e" : s === "COMPLETED" ? "#3b82f6" : "#9ca3af";
const dirLabel    = (d) => d === "MALANDAY-RECTO" ? "Malanday → Recto" : d === "RECTO-MALANDAY" ? "Recto → Malanday" : (d || "—");

const periodColor = (p) => {
  if (!p) return { bg: "#f3f4f6", text: "#6b7280" };
  if (p.includes("Morning"))   return { bg: "#fef3c7", text: "#92400e" };
  if (p.includes("Off"))       return { bg: "#d1fae5", text: "#065f46" };
  if (p.includes("Afternoon")) return { bg: "#dbeafe", text: "#1e40af" };
  return { bg: "#ede9fe", text: "#4c1d95" };
};

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

const PERIOD_COLOR = { "Morning Peak": "#f59e0b", "Midday": "#3b82f6", "Afternoon Peak": "#ef4444", "Off-Peak": "#22c55e" };
const DEMAND_COLOR = { Normal: "#22c55e", Moderate: "#f59e0b", High: "#ef6c00", Critical: "#ef4444" };
const TIER_COLORS  = { Normal: "#2e7d32", Moderate: "#f9a825", High: "#ef6c00", Critical: "#c62828" };

const btnBase = {
  padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit", border: "none",
};

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
      {accent && <div style={{ width: 28, height: 3, borderRadius: 2, background: accent, marginBottom: 8 }} />}
      <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#111", letterSpacing: "-0.5px" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 12, color: "#9ca3af" }}>{sub}</div>}
    </div>
  );
}

// ─── PublishStopZonesPanel ────────────────────────────────────────────────────
function PublishStopZonesPanel() {
  const [aggTrips,     setAggTrips]     = useState([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(false);

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
      "and updates the passenger map. Both directions will be replaced."
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
    <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0ef", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Passenger Stop Zone Map</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
            GOOD-flagged logs from all completed trips are pooled into DBSCAN to detect stop zones for both corridors.
          </div>
        </div>
        <button
          onClick={handlePublish}
          disabled={loading || aggTrips.length === 0}
          style={{
            ...btnBase,
            padding: "10px 18px", fontSize: 13,
            background: (loading || aggTrips.length === 0) ? "#e5e7eb" : "#6366f1",
            color:      (loading || aggTrips.length === 0) ? "#9ca3af" : "#fff",
            cursor:     (loading || aggTrips.length === 0) ? "not-allowed" : "pointer",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {loading ? "Publishing…" : "📤 Publish Stop Zones"}
        </button>
      </div>

      <div style={{ padding: "16px 24px" }}>
        {tripsLoading ? (
          <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading trips…</div>
        ) : sortedDates.length === 0 ? (
          <div style={{ fontSize: 13, color: "#ef4444" }}>No completed trips found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {sortedDates.map(date => (
              <div key={date}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <Icon name="clock" size={13} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>📅 {date}</span>
                </div>
                {["MALANDAY-RECTO", "RECTO-MALANDAY"].map(dir => {
                  const dirTrips = byDate[date][dir];
                  if (!dirTrips.length) return null;
                  return (
                    <div key={dir} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>{dirLabel(dir)}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {dirTrips.map(t => {
                          const pc = periodColor(t.dominant_period || t.time_period);
                          const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                          return (
                            <div key={t.trip_id} style={{
                              display: "grid", gridTemplateColumns: "70px 130px 1fr 80px 32px",
                              alignItems: "center", gap: 8,
                              background: "#fafaf9", borderRadius: 8, padding: "7px 12px",
                              border: "1px solid #f0f0ef", fontSize: 12,
                            }}>
                              <span style={{ color: "#6b7280", fontWeight: 500 }}>{t.pht_start || "—"}</span>
                              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 500, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {t.dominant_period || t.time_period || "—"}
                              </span>
                              <span style={{ color: "#374151" }}>{t.log_count?.toLocaleString()} logs</span>
                              <span style={{ fontWeight: 600, textAlign: "right", color: gp == null ? "#9ca3af" : gp >= 95 ? "#15803d" : gp >= 70 ? "#92400e" : "#991b1b" }}>
                                {gp != null ? `${gp}% GOOD` : "—"}
                              </span>
                              <span style={{
                                textAlign: "center", borderRadius: 5, padding: "2px 4px", fontSize: 11, fontWeight: 700,
                                background: gp >= 95 ? "#d1fae5" : gp >= 70 ? "#fef3c7" : "#fee2e2",
                                color:      gp >= 95 ? "#065f46" : gp >= 70 ? "#92400e" : "#991b1b",
                              }}>
                                {gp >= 95 ? "✓" : gp >= 70 ? "~" : "✗"}
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
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: status.ok ? "#f0fdf4" : "#fef2f2",
            color:      status.ok ? "#15803d" : "#c62828",
            border:     `1px solid ${status.ok ? "#bbf7d0" : "#fecaca"}`,
          }}>
            {status.ok ? "✅ " : "❌ "}
            {status.lines.map((line, i) => <span key={i}>{line}{i < status.lines.length - 1 && <br />}</span>)}
          </div>
        )}
      </div>
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
  const recent    = [...trips].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total Trips"        value={stats?.total_trips}                                    sub="All corridors"        accent="#6366f1" />
        <StatCard label="GPS Logs"           value={stats?.total_logs?.toLocaleString()}                   sub="Data points"          accent="#06b6d4" />
        <StatCard label="Avg GOOD Rate"      value={summaries.length ? `${allAvg.toFixed(1)}%` : "—"}     sub="Across all trips"     accent="#22c55e" />
        <StatCard label="High-Quality Trips" value={`${highQual} / ${summaries.length}`}                  sub="≥ 88% GOOD threshold" accent="#f59e0b" />
      </div>

      {summaries.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { label: "Malanday → Recto", ts: mrTrips, avg: mrAvg, color: "#6366f1" },
            { label: "Recto → Malanday", ts: rmTrips, avg: rmAvg, color: "#06b6d4" },
          ].map(({ label, ts, avg, color }) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{label}</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#111", letterSpacing: "-1px", marginBottom: 4 }}>
                {ts.length ? `${avg.toFixed(1)}%` : "—"}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 14 }}>avg GOOD rate · {ts.length} trips</div>
              <div style={{ height: 6, borderRadius: 3, background: "#f3f4f6", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${avg}%`, background: color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <PublishStopZonesPanel />

      {recent.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0ef" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Recent trips</span>
          </div>
          {recent.map(t => {
            const sc = statusColor(t.status);
            return (
              <div key={t.trip_id} style={{ padding: "12px 24px", borderBottom: "1px solid #fafafa", display: "grid", gridTemplateColumns: "150px 1fr 110px 90px", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{dirLabel(t.direction)}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{phtDateStr(t.start_time)}</div>
                </div>
                <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, background: sc + "20", color: sc, fontWeight: 600 }}>{t.status}</span>
                <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{t.log_count?.toLocaleString() || "—"} logs</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 14 }}>System Health</div>
        {[
          ["API Server (Railway)", "UP"],
          ["PostgreSQL 15 (Railway)", "UP"],
          ["PWA (Vercel)", "UP"],
        ].map(([svc, st]) => (
          <div key={svc} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ fontSize: 13, color: "#374151", flex: 1 }}>{svc}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#22c55e" }}>{st}</span>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, borderTop: "1px solid #f0f0ef", paddingTop: 8 }}>
          Backend · Railway · FastAPI + PostgreSQL 15 &nbsp;|&nbsp; Frontend · Vercel · React PWA
        </div>
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

  const inputStyle = { padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", background: "#fff" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {importMessage && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: importMessage.type === "success" ? "#f0fdf4" : "#fef2f2",
          color:      importMessage.type === "success" ? "#15803d" : "#c62828",
          border:     `1px solid ${importMessage.type === "success" ? "#bbf7d0" : "#fecaca"}`,
        }}>{importMessage.text}</div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search trip ID, jeep code…" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <select value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); }} style={inputStyle}>
          <option value="all">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="ACTIVE">Active</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={dirF} onChange={e => { setDirF(e.target.value); setPage(1); }} style={inputStyle}>
          <option value="all">All directions</option>
          <option value="MALANDAY-RECTO">Malanday → Recto</option>
          <option value="RECTO-MALANDAY">Recto → Malanday</option>
        </select>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{filtered.length} trips</span>
      </div>

      <div style={{ fontSize: 13, color: "#6b7280" }}>
        All GOOD-flagged logs from every trip are pooled into DBSCAN to detect passenger stop zones.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {Object.entries(grouped).map(([date, dayTrips]) => (
          <div key={date}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 4px" }}>
              <Icon name="clock" size={14} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{date}</span>
            </div>
            {dayTrips.map(t => {
              const s   = summaryMap[t.trip_id];
              const gp  = s?.good_pct;
              const per = s?.dominant_period || s?.time_period;
              const pc  = periodColor(per);
              const sc  = statusColor(t.status);
              const open = expanded === t.trip_id;
              return (
                <div key={t.trip_id} style={{ marginBottom: 4 }}>
                  <div onClick={() => setExpanded(open ? null : t.trip_id)} style={{
                    display: "grid", gridTemplateColumns: "90px 130px 1fr 80px 90px 36px",
                    alignItems: "center", gap: 12, padding: "10px 16px",
                    background: "#fff", border: `1px solid ${open ? "#c7d2fe" : "#f0f0ef"}`,
                    borderRadius: 10, cursor: "pointer",
                  }}>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, background: sc + "18", color: sc, fontWeight: 600, textAlign: "center" }}>{t.status}</span>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 500, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {per || dirLabel(t.direction)}
                    </span>
                    <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                      {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 3 }} />}
                    </div>
                    <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{t.log_count?.toLocaleString() || "—"}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: gp != null ? goodColor(gp) : "#9ca3af" }}>
                      {gp != null ? `${typeof gp === "number" && gp % 1 !== 0 ? gp.toFixed(1) : gp}%` : "—"}
                    </span>
                    <span style={{ color: "#9ca3af", display: "flex", justifyContent: "center", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>
                      <Icon name="chevron" size={14} />
                    </span>
                  </div>

                  {open && (
                    <div style={{ padding: "14px 16px", marginTop: 2, background: "#fafaf9", border: "1px solid #f0f0ef", borderRadius: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
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
                            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{lbl}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111", fontFamily: lbl === "Trip ID" ? "monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lbl === "Trip ID" ? t.trip_id : undefined}>{val}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => onMap(t.trip_id)} style={{ ...btnBase, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>🗺 Map</button>
                        <button onClick={() => onExport(t.trip_id, t.jeep_code)} disabled={exportingId === t.trip_id}
                          style={{ ...btnBase, background: exportDoneId === t.trip_id ? "#f0fdf4" : "#f0f9ff", color: exportDoneId === t.trip_id ? "#15803d" : "#0369a1", border: `1px solid ${exportDoneId === t.trip_id ? "#bbf7d0" : "#bae6fd"}` }}>
                          {exportingId === t.trip_id ? "…" : exportDoneId === t.trip_id ? "✓ Done" : "⬇ CSV"}
                        </button>
                        <button onClick={() => onDelete(t.trip_id)} disabled={deletingId === t.trip_id}
                          style={{ ...btnBase, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
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
          <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 14 }}>No trips match your filters.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
          {[["«", 1], ["‹", Math.max(1, page - 1)]].map(([lbl, t]) => (
            <button key={lbl} onClick={() => setPage(t)} disabled={page === 1}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 13, cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.4 : 1 }}>{lbl}</button>
          ))}
          <span style={{ fontSize: 13, color: "#6b7280", padding: "0 8px" }}>Page {page} of {totalPages}</span>
          {[["›", Math.min(totalPages, page + 1)], ["»", totalPages]].map(([lbl, t]) => (
            <button key={lbl} onClick={() => setPage(t)} disabled={page === totalPages}
              style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 13, cursor: page === totalPages ? "not-allowed" : "pointer", opacity: page === totalPages ? 0.4 : 1 }}>{lbl}</button>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 6 }}>Import Trip CSV</div>
        <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 14 }}>Drag a CSV file onto the page or click below to import a previously exported trip.</div>
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: importing ? "#e5e7eb" : "#6366f1", color: importing ? "#9ca3af" : "#fff",
          borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600,
          cursor: importing ? "not-allowed" : "pointer",
        }}>
          <Icon name="upload" size={16} />
          {importing ? "Importing…" : "Choose CSV"}
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
      setMsg({ type: "success", text: `Conductor "${name}" created.` });
      setName(""); setEmpId(""); setPin(""); setJeep("");
      onRefresh();
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Failed to create." });
    } finally { setBusy(false); }
  };

  const fld = { padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {conductors.map(c => {
          const init = (c.display_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={c.user_id} style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#6366f1" }}>{init}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>{c.display_name}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>ID: {c.employee_id}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["Jeep Code", c.jeep_code || "—"], ["Created", c.created_at?.slice(0, 10) || "—"]].map(([lbl, val]) => (
                  <div key={lbl} style={{ background: "#fafaf9", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {conductors.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: 14 }}>No conductors yet.</div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 16 }}>Create Conductor Account</div>
        {msg && (
          <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13, fontWeight: 500,
            background: msg.type === "success" ? "#f0fdf4" : "#fef2f2",
            color:      msg.type === "success" ? "#15803d" : "#c62828",
            border:     `1px solid ${msg.type === "success" ? "#bbf7d0" : "#fecaca"}`,
          }}>{msg.text}</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Display Name",   v: name,  s: setName,  ph: "e.g. Juan dela Cruz" },
            { label: "Employee ID",    v: empId, s: setEmpId, ph: "e.g. EMP-001" },
            { label: "PIN (6 digits)", v: pin,   s: setPin,   ph: "6-digit PIN", type: "password" },
            { label: "Jeep Code",      v: jeep,  s: setJeep,  ph: "e.g. MR-001 (optional)" },
          ].map(({ label, v, s, ph, type }) => (
            <div key={label}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 5 }}>{label}</div>
              <input type={type || "text"} value={v} onChange={e => s(e.target.value)} placeholder={ph} style={fld} />
            </div>
          ))}
        </div>
        <button onClick={create} disabled={busy} style={{
          ...btnBase, padding: "10px 20px", fontSize: 13,
          background: busy ? "#e5e7eb" : "#6366f1", color: busy ? "#9ca3af" : "#fff",
          cursor: busy ? "not-allowed" : "pointer",
        }}>
          {busy ? "Creating…" : "➕ Create Conductor"}
        </button>
      </div>
    </div>
  );
}

// ─── Aggregate Tab ────────────────────────────────────────────────────────────
function AggregateTab({ aggregate, aggLoading, onMap }) {
  if (aggLoading) return <div style={{ textAlign: "center", padding: "80px 0", color: "#9ca3af", fontSize: 14 }}>Computing aggregate data…</div>;
  if (!aggregate) return <div style={{ textAlign: "center", padding: "80px 0", color: "#9ca3af", fontSize: 14 }}>No data available.</div>;

  const summaries = aggregate.trip_summaries || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <StatCard label="Trips Analyzed"    value={aggregate.total_trips}                  sub="Completed trips"    accent="#6366f1" />
        <StatCard label="Total GPS Logs"    value={aggregate.total_logs?.toLocaleString()} sub="Pooled for DBSCAN"  accent="#06b6d4" />
        <StatCard label="Avg Load Factor"   value={`${aggregate.avg_load_factor_pct}%`}   sub="Across all trips"   accent={aggregate.avg_load_factor_pct > 100 ? "#ef4444" : "#22c55e"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {aggregate.time_distribution && (
          <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 16 }}>Trips by Time Period</div>
            {(() => {
              const d = aggregate.time_distribution;
              const max = Math.max(...Object.values(d), 1);
              return Object.entries(d).map(([p, count]) => (
                <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, width: 110, color: "#6b7280", whiteSpace: "nowrap" }}>{p}</span>
                  <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: PERIOD_COLOR[p] || "#6366f1", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111", width: 20, textAlign: "right" }}>{count}</span>
                </div>
              ));
            })()}
          </div>
        )}
        {aggregate.demand_distribution && (
          <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 16 }}>Demand Distribution</div>
            {(() => {
              const d = aggregate.demand_distribution;
              const max = Math.max(...Object.values(d), 1);
              return Object.entries(d).map(([tier, count]) => (
                <div key={tier} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, width: 80, color: "#6b7280" }}>{tier}</span>
                  <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: DEMAND_COLOR[tier] || "#6366f1", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: DEMAND_COLOR[tier] || "#111", width: 60, textAlign: "right" }}>{count.toLocaleString()}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0ef" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>By Corridor</span>
        </div>
        {[
          { label: "Malanday → Recto", dir: "MALANDAY-RECTO", color: "#6366f1" },
          { label: "Recto → Malanday", dir: "RECTO-MALANDAY", color: "#06b6d4" },
        ].map(({ label, dir, color }) => {
          const ct   = summaries.filter(t => t.direction === dir);
          const avg  = ct.length ? ct.reduce((s, t) => s + (t.good_pct || 0), 0) / ct.length : 0;
          const logs = ct.reduce((s, t) => s + (t.log_count || 0), 0);
          return (
            <div key={dir} style={{ padding: "14px 24px", borderBottom: "1px solid #fafafa", display: "grid", gridTemplateColumns: "200px 1fr 100px 80px 80px", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{label}</span>
              </div>
              <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${avg}%`, background: color, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{logs.toLocaleString()} logs</span>
              <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{ct.length} trips</span>
              <span style={{ fontSize: 13, fontWeight: 700, color, textAlign: "right" }}>{avg.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0ef", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Trip Summaries</span>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{summaries.length} completed trips</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafaf9" }}>
                {["Trip ID", "Date", "Direction", "Period", "Logs", "GOOD %", "Load Factor", "Map"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #f0f0ef" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map(t => {
                const lf = typeof t.avg_load_factor_pct === "number" ? t.avg_load_factor_pct : null;
                const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                const pc = periodColor(t.time_period);
                return (
                  <tr key={t.trip_id} style={{ borderBottom: "1px solid #fafafa" }}>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 11, color: "#6b7280", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.trip_id}>{t.trip_id}</td>
                    <td style={{ padding: "10px 16px", color: "#374151" }}>{t.date || "—"}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: t.direction === "MALANDAY-RECTO" ? "#6366f1" : "#06b6d4" }}>{dirLabel(t.direction)}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 500 }}>{t.time_period || "—"}</span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "#374151" }}>{t.log_count?.toLocaleString() || "—"}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 700, color: gp != null ? goodColor(gp) : "#9ca3af" }}>
                      {gp != null ? `${typeof gp === "number" && gp % 1 !== 0 ? gp.toFixed(1) : gp}%` : "—"}
                    </td>
                    <td style={{ padding: "10px 16px", fontWeight: 700, color: lf != null ? (lf > 120 ? "#ef4444" : lf > 80 ? "#f59e0b" : "#22c55e") : "#9ca3af" }}>
                      {lf != null ? `${lf.toFixed(0)}%` : "—"}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <button onClick={() => onMap(t.trip_id)} style={{ ...btnBase, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>🗺 Map</button>
                    </td>
                  </tr>
                );
              })}
              {summaries.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "48px 16px", textAlign: "center", color: "#9ca3af" }}>No completed trips to analyze.</td></tr>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, padding: "24px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 16 }}>DBSCAN Pipeline Readiness</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {[
            { label: "Malanday → Recto", good: mrGood,         color: "#6366f1" },
            { label: "Recto → Malanday", good: rmGood,         color: "#06b6d4" },
            { label: "Combined Pool",    good: mrGood + rmGood, color: "#22c55e" },
          ].map(({ label, good, color }) => (
            <div key={label} style={{ background: "#fafaf9", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: good > 1000 ? "#22c55e" : "#ef4444" }} />
                <span style={{ fontSize: 11, color: good > 1000 ? "#15803d" : "#b91c1c", fontWeight: 500 }}>{good > 1000 ? "Ready" : "Insufficient"}</span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{good.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>GOOD log points</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0ef", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0ef" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Trip Quality Trend</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafaf9" }}>
                {["Trip ID", "Date", "Corridor", "Period", "Logs", "GOOD %", "Quality"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #f0f0ef" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...summaries].sort((a, b) => (b.good_pct || 0) - (a.good_pct || 0)).map(t => {
                const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                const pc = periodColor(t.time_period);
                return (
                  <tr key={t.trip_id} style={{ borderBottom: "1px solid #fafafa" }}>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 11, color: "#6b7280", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                    <td style={{ padding: "10px 16px", color: "#374151" }}>{t.date || "—"}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: t.direction === "MALANDAY-RECTO" ? "#6366f1" : "#06b6d4" }}>{dirLabel(t.direction)}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 500 }}>{t.time_period || "—"}</span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "#374151" }}>{t.log_count?.toLocaleString() || "—"}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 700, color: gp != null ? goodColor(gp) : "#9ca3af" }}>
                      {gp != null ? `${typeof gp === "number" && gp % 1 !== 0 ? gp.toFixed(1) : gp}%` : "—"}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ width: 60, height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                        {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 3 }} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {summaries.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", color: "#9ca3af" }}>No trip data available.</td></tr>
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
  const [active,     setActive]     = useState("overview");

  const [deletingId,   setDeletingId]   = useState(null);
  const [exportingId,  setExportingId]  = useState(null);
  const [exportDoneId, setExportDoneId] = useState(null);
  const [mapTripId,    setMapTripId]    = useState(null);
  const [importing,    setImporting]    = useState(false);
  const [importMsg,    setImportMsg]    = useState(null);

  useEffect(() => {
    if (!authService.isAdmin()) { navigate("/login", { replace: true }); return; }
    fetchData();
  }, []);

  useEffect(() => {
    const needsAgg = ["aggregate", "analytics", "trips"].includes(active);
    if (needsAgg && !aggregate && !aggLoading) {
      setAggLoading(true);
      getAggregateDashboard()
        .then(r => setAggregate(r.data))
        .catch(e => console.error("Aggregate:", e))
        .finally(() => setAggLoading(false));
    }
  }, [active]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([getAdminStats(), getAdminTrips(), getConductors()]);
      setStats(s.data); setTrips(t.data); setConductors(c.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const refresh = () => {
    fetchData();
    setAggregate(null);
    setAggLoading(false);
  };

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
    setExportingId(tripId);
    setExportDoneId(null);
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

  const pageMeta = {
    overview:   { title: "Overview",    sub: "System-wide summary of all trips and corridors" },
    trips:      { title: "Trips",       sub: "Review completed trips — GOOD logs are pooled into DBSCAN for stop zone detection" },
    conductors: { title: "Conductors",  sub: "Driver performance and trip assignment records" },
    aggregate:  { title: "Aggregate",   sub: "Pooled log statistics ready for DBSCAN clustering" },
    analytics:  { title: "Analytics",   sub: "Trip quality trends and pipeline readiness" },
    stopzones:  { title: "Stop Zones",  sub: "Publish forward and return corridor stop zones to the passenger map" },
  };

  const renderPage = () => {
    if (loading) return <div style={{ textAlign: "center", padding: "100px 0", color: "#9ca3af", fontSize: 14 }}>Loading…</div>;
    switch (active) {
      case "overview":   return <Overview stats={stats} trips={trips} aggregate={aggregate} />;
      case "trips":      return <TripsTab trips={trips} aggregate={aggregate} onDelete={handleDelete} onExport={handleExport} onMap={setMapTripId} exportingId={exportingId} exportDoneId={exportDoneId} deletingId={deletingId} importMessage={importMsg} importing={importing} onImportFile={handleImportFile} />;
      case "conductors": return <ConductorsTab conductors={conductors} onRefresh={fetchData} />;
      case "aggregate":  return <AggregateTab aggregate={aggregate} aggLoading={aggLoading} onMap={setMapTripId} />;
      case "analytics":  return <AnalyticsTab aggregate={aggregate} />;
      case "stopzones":  return <PublishStopZonesPanel />;
      default:           return null;
    }
  };

  const initials = (user?.display_name || "A").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <div style={{ display: "flex", minHeight: "100vh", background: "#f8f8f7", fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>

        {/* ── Sidebar ── */}
        <aside style={{ width: 220, minHeight: "100vh", background: "#fff", borderRight: "1px solid #f0f0ef", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, zIndex: 10 }}>
          <div style={{ padding: "24px 20px 18px", borderBottom: "1px solid #f0f0ef" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="bus" size={16} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>RutaSmart</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>Admin Dashboard</div>
              </div>
            </div>
          </div>

          <div style={{ padding: "12px 20px", borderBottom: "1px solid #f0f0ef", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#6366f1", flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name || "Admin"}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Administrator</div>
            </div>
          </div>

          <nav style={{ padding: "16px 12px", flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px", marginBottom: 8 }}>Navigation</div>
            {NAV.map(n => {
              const on = active === n.id;
              return (
                <button key={n.id} onClick={() => {
                  if (n.id === "analytics") { navigate("/analytics"); return; }
                  setActive(n.id);
                }} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: on ? "#ede9fe" : "transparent",
                  color:      on ? "#4f46e5" : "#6b7280",
                  fontWeight: on ? 600 : 400,
                  fontSize: 13, marginBottom: 2, textAlign: "left", fontFamily: "inherit",
                }}>
                  <Icon name={n.icon} size={16} />
                  {n.label}
                  {on && <div style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: "#6366f1" }} />}
                </button>
              );
            })}
          </nav>

          <div style={{ padding: "12px 20px", borderTop: "1px solid #f0f0ef" }}>
            <button onClick={() => { authService.clearSession(); navigate("/login", { replace: true }); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13, padding: "8px 0", fontFamily: "inherit" }}>
              <Icon name="logout" size={15} />
              Sign Out
            </button>
            <div style={{ fontSize: 10, color: "#c4c4c0", marginTop: 4 }}>Malanday–Recto · FEU-IT · PUJ 547</div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ marginLeft: 220, flex: 1, padding: "32px 36px", minHeight: "100vh" }}>
          <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111", margin: 0, letterSpacing: "-0.5px" }}>
                {pageMeta[active]?.title}
              </h1>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>{pageMeta[active]?.sub}</p>
            </div>
            <button onClick={refresh} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", border: "1px solid #e5e7eb", borderRadius: 8,
              background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151", fontFamily: "inherit",
            }}>
              <Icon name="refresh" size={14} />
              Refresh
            </button>
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
