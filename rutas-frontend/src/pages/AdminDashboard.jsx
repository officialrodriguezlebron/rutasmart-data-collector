import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAdminStats, getAdminTrips, deleteTrip,
  importTripCSV, createUser, getConductors,
  getAggregateDashboard,
} from "../services/api";
import { authService } from "../services/authService";
import TripMap from "./TripMap";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user     = authService.getUser();

  const [stats,      setStats]      = useState(null);
  const [trips,      setTrips]      = useState([]);
  const [conductors, setConductors] = useState([]);
  const [aggregate,  setAggregate]  = useState(null);
  const [aggLoading, setAggLoading] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState("overview");

  const [importing,      setImporting]      = useState(false);
  const [importMessage,  setImportMessage]  = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [mapTripId,      setMapTripId]      = useState(null);

  // New conductor form
  const [newName,    setNewName]    = useState("");
  const [newEmpId,   setNewEmpId]   = useState("");
  const [newPin,     setNewPin]     = useState("");
  const [newJeep,    setNewJeep]    = useState("");
  const [creating,   setCreating]   = useState(false);
  const [createMsg,  setCreateMsg]  = useState(null);

  useEffect(() => {
    if (!authService.isAdmin()) { navigate("/login", { replace: true }); return; }
    fetchData();
  }, []);

  // Lazy-load aggregate data only when the tab is opened
  useEffect(() => {
    if (tab !== "aggregate" || aggregate) return;
    setAggLoading(true);
    getAggregateDashboard()
      .then(r => setAggregate(r.data))
      .catch(e => console.error("Aggregate load failed:", e))
      .finally(() => setAggLoading(false));
  }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([
        getAdminStats(), getAdminTrips(), getConductors()
      ]);
      setStats(s.data); setTrips(t.data); setConductors(c.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleLogout = () => { authService.clearSession(); navigate("/login", { replace: true }); };

  const handleDelete = async (tripId) => {
    if (!window.confirm(`Delete trip ${tripId}?\n\nPermanently removes all GPS logs.`)) return;
    setDeletingId(tripId);
    try {
      const res = await deleteTrip(tripId);
      setImportMessage({ type: "success", text: `Deleted — ${res.data.logs_removed} logs removed.` });
      fetchData();
    } catch (e) {
      setImportMessage({ type: "error", text: e.response?.data?.detail || "Delete failed." });
    } finally { setDeletingId(null); }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMessage(null);
    try {
      const res = await importTripCSV(file);
      setImportMessage({ type: "success", text: `Imported "${res.data.imported}" — ${res.data.logs_imported} logs added.` });
      fetchData();
    } catch (err) {
      setImportMessage({ type: "error", text: err.response?.data?.detail || "Import failed." });
    } finally { setImporting(false); e.target.value = ""; }
  };

  const handleCreateConductor = async (e) => {
    e.preventDefault();
    setCreateMsg(null);
    if (!newName || !newEmpId || !newPin) {
      setCreateMsg({ type: "error", text: "Name, Employee ID and PIN are required." });
      return;
    }
    setCreating(true);
    try {
      await createUser({
        role: "CONDUCTOR",
        display_name: newName,
        employee_id:  newEmpId,
        pin:          newPin,
        jeep_code:    newJeep || undefined,
      });
      setCreateMsg({ type: "success", text: `Conductor "${newName}" (${newEmpId}) created.` });
      setNewName(""); setNewEmpId(""); setNewPin(""); setNewJeep("");
      fetchData();
    } catch (err) {
      setCreateMsg({ type: "error", text: err.response?.data?.detail || "Failed to create account." });
    } finally { setCreating(false); }
  };

  const statusColor = (s) =>
    s === "ACTIVE" ? "#00c853" : s === "COMPLETED" ? "#1565c0" : "#888";

  const TABS = [
    { key: "overview",   label: "Overview"   },
    { key: "trips",      label: "Trips"      },
    { key: "conductors", label: "Conductors" },
    { key: "aggregate",  label: "All Trips ✦" },
    { key: "analytics",  label: "Analytics"  },
  ];

  return (
    <>
      <div className="admin-page">

        {/* Sidebar */}
        <aside className="admin-sidebar">
          <div className="admin-logo">
            <h2>RutaSmart</h2>
            <span>Admin Panel</span>
          </div>

          <div className="admin-user-info">
            <div className="admin-user-avatar">{user?.display_name?.charAt(0) || "A"}</div>
            <div>
              <div className="admin-user-name">{user?.display_name}</div>
              <div className="admin-user-role">Administrator</div>
            </div>
          </div>

          <nav className="admin-nav">
            <div className="admin-nav-section">MAIN</div>
            {TABS.map(({ key, label }) => (
              <button key={key}
                className={`admin-nav-item ${tab === key ? "active" : ""}`}
                onClick={() => key === "analytics" ? navigate("/analytics") : setTab(key)}>
                {label}
              </button>
            ))}
          </nav>

          <button className="admin-signout" onClick={handleLogout}>Sign Out</button>
        </aside>

        {/* Main */}
        <main className="admin-main">

          <div className="admin-topbar">
            <h1>
              {tab === "overview"   && "Overview"}
              {tab === "trips"      && "Trips"}
              {tab === "conductors" && "Conductors"}
              {tab === "aggregate"  && "All Trips"}
            </h1>
            <button className="admin-refresh" onClick={fetchData}>↺ Refresh</button>
          </div>

          {loading && <div className="admin-loading">Loading…</div>}

          {/* ── OVERVIEW ─────────────────────────────────────── */}
          {!loading && tab === "overview" && stats && (<>
            <div className="admin-metrics">
              {[
                { label: "Active Trips", value: stats.active_trips,                accent: "#00c853" },
                { label: "Total Trips",  value: stats.total_trips,                 accent: "#42a5f5" },
                { label: "GPS Logs",     value: stats.total_logs.toLocaleString(), accent: "#ce93d8" },
                { label: "Users",        value: stats.total_users,                 accent: "#80cbc4" },
              ].map(({ label, value, accent }) => (
                <div key={label} className="admin-metric-card">
                  <div className="admin-metric-accent" style={{ background: accent }} />
                  <div className="admin-metric-label">{label}</div>
                  <div className="admin-metric-value" style={{ color: accent }}>{value}</div>
                </div>
              ))}
            </div>

            <div className="admin-card">
              <div className="admin-card-title">
                Active Jeepneys
                <a href="/route/MR-001" target="_blank" rel="noreferrer" className="admin-public-link">
                  🔗 Public Dashboard
                </a>
              </div>
              {stats.active_jeeps.length === 0
                ? <p className="admin-empty">No jeepneys currently active on route MR-001.</p>
                : <div className="admin-jeep-list">
                    {stats.active_jeeps.map(j => <span key={j} className="admin-jeep-badge">{j}</span>)}
                  </div>
              }
            </div>

            <div className="admin-card">
              <div className="admin-card-title">System Health</div>
              <div className="admin-health-grid">
                {[
                  ["API Server (Railway)",   "UP"],
                  ["PostgreSQL 15 (Railway)","UP"],
                  ["PWA (Vercel)",           "UP"],
                ].map(([s, st]) => (
                  <div key={s} className="admin-health-row">
                    <span className="admin-health-dot" />
                    <span>{s}</span>
                    <span className="admin-health-status">{st}</span>
                  </div>
                ))}
              </div>
              <p className="admin-health-note">
                Backend · Railway · FastAPI + PostgreSQL 15 &nbsp;|&nbsp;
                Frontend · Vercel · React PWA
              </p>
            </div>

            <div className="admin-card">
              <div className="admin-card-title">Recent Trips</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Trip ID</th><th>Jeep</th><th>Status</th><th>Start</th>
                  </tr></thead>
                  <tbody>
                    {trips.slice(0,5).map(t => (
                      <tr key={t.trip_id}>
                        <td className="admin-mono">{t.trip_id}</td>
                        <td>{t.jeep_code}</td>
                        <td>
                          <span className="admin-status-badge"
                            style={{ background: statusColor(t.status)+"22", color: statusColor(t.status) }}>
                            {t.status}
                          </span>
                        </td>
                        <td className="admin-mono" style={{ color:"#8e9ab0" }}>{t.start_time?.slice(0,16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ── TRIPS ────────────────────────────────────────── */}
          {!loading && tab === "trips" && (<>
            <div className="admin-card">
              <div className="admin-card-title">Import Trip from CSV</div>
              <p className="admin-card-desc">
                Required columns: latitude, longitude, accuracy, occupancy_count, timestamp
              </p>
              <label htmlFor="csv-input" className="admin-import-btn"
                style={{ opacity: importing ? 0.6 : 1, cursor: importing ? "not-allowed" : "pointer" }}>
                {importing ? "Importing…" : "📂 Choose CSV file to import"}
              </label>
              <input id="csv-input" type="file" accept=".csv"
                style={{ display:"none" }} onChange={handleImport} disabled={importing} />
              {importMessage && (
                <div className={`admin-msg ${importMessage.type}`}>{importMessage.text}</div>
              )}
            </div>

            <div className="admin-card" style={{ padding:0, overflow:"hidden" }}>
              <div style={{ padding:"16px 22px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div className="admin-card-title" style={{ marginBottom:0 }}>
                  All Trips ({trips.length})
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Trip ID</th><th>Jeep</th><th>Direction</th>
                    <th>Cap</th><th>Status</th><th>Start</th><th>Actions</th>
                  </tr></thead>
                  <tbody>
                    {trips.map(t => (
                      <tr key={t.trip_id}>
                        <td className="admin-mono">{t.trip_id}</td>
                        <td>{t.jeep_code}</td>
                        <td style={{ fontSize:11 }}>{t.direction}</td>
                        <td style={{ textAlign:"center" }}>{t.official_capacity}</td>
                        <td>
                          <span className="admin-status-badge"
                            style={{ background: statusColor(t.status)+"22", color: statusColor(t.status) }}>
                            {t.status}
                          </span>
                        </td>
                        <td className="admin-mono" style={{ color:"#8e9ab0" }}>{t.start_time?.slice(0,16)}</td>
                        <td>
                          <div className="admin-action-group">
                            {t.status === "COMPLETED" && (<>
                              <button className="admin-action-btn"
                                onClick={() => navigate(`/analytics?trip=${t.trip_id}`)}>
                                Analyse
                              </button>
                              <button className="admin-action-btn map"
                                onClick={() => setMapTripId(t.trip_id)}>🗺</button>
                            </>)}
                            <button className="admin-action-btn danger"
                              onClick={() => handleDelete(t.trip_id)}
                              disabled={deletingId === t.trip_id}>
                              {deletingId === t.trip_id ? "…" : "Del"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {trips.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign:"center", padding:32, color:"#8e9ab0" }}>
                        No trips yet. Run a field ride or import a CSV above.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ── CONDUCTORS ───────────────────────────────────── */}
          {!loading && tab === "conductors" && (<>

            {/* Create form */}
            <div className="admin-card">
              <div className="admin-card-title">Create Conductor Account</div>
              <form className="admin-conductor-form" onSubmit={handleCreateConductor}>
                <div className="admin-form-row">
                  <div className="admin-form-field">
                    <label>Full Name *</label>
                    <input type="text" value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Juan dela Cruz" required />
                  </div>
                  <div className="admin-form-field">
                    <label>Employee ID *</label>
                    <input type="text" value={newEmpId}
                      onChange={e => setNewEmpId(e.target.value)}
                      placeholder="e.g. CDR-2024-099" required />
                  </div>
                </div>
                <div className="admin-form-row">
                  <div className="admin-form-field">
                    <label>PIN Code *</label>
                    <input type="password" value={newPin}
                      onChange={e => setNewPin(e.target.value.replace(/\D/g,""))}
                      placeholder="4–8 digits" maxLength={8}
                      inputMode="numeric" required />
                  </div>
                  <div className="admin-form-field">
                    <label>Jeep Code <span style={{ fontWeight:400, color:"#aaa" }}>(optional)</span></label>
                    <input type="text" value={newJeep}
                      onChange={e => setNewJeep(e.target.value)}
                      placeholder="e.g. JPN-003" />
                  </div>
                </div>
                {createMsg && (
                  <div className={`admin-msg ${createMsg.type}`}>{createMsg.text}</div>
                )}
                <button type="submit" className="admin-create-btn" disabled={creating}>
                  {creating ? "Creating…" : "+ Create Conductor Account"}
                </button>
              </form>
            </div>

            {/* Conductor list */}
            <div className="admin-card" style={{ padding:0, overflow:"hidden" }}>
              <div style={{ padding:"16px 22px 12px" }}>
                <div className="admin-card-title" style={{ marginBottom:0 }}>
                  Conductor Accounts ({conductors.length})
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Name</th><th>Employee ID</th><th>Jeep</th>
                    <th>Status</th><th>Created</th>
                  </tr></thead>
                  <tbody>
                    {conductors.map(c => (
                      <tr key={c.employee_id}>
                        <td style={{ fontWeight:600 }}>{c.display_name}</td>
                        <td className="admin-mono">{c.employee_id}</td>
                        <td className="admin-mono">{c.jeep_code || "—"}</td>
                        <td>
                          <span className="admin-status-badge"
                            style={{ background: c.is_active ? "#00c85322" : "#88888822",
                                     color: c.is_active ? "#00c853" : "#888" }}>
                            {c.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="admin-mono" style={{ color:"#8e9ab0" }}>
                          {c.created_at?.slice(0,10) || "—"}
                        </td>
                      </tr>
                    ))}
                    {conductors.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign:"center", padding:32, color:"#8e9ab0" }}>
                        No conductors yet. Create one above.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ── ALL TRIPS AGGREGATE TAB ──────────────────────────── */}
          {tab === "aggregate" && (
            <div className="agg-container">
              <div className="agg-header">
                <h2 className="agg-title">All Trips — Aggregate Summary</h2>
                <button
                  className="agg-refresh-btn"
                  onClick={() => {
                    setAggregate(null);
                    setAggLoading(true);
                    getAggregateDashboard()
                      .then(r => setAggregate(r.data))
                      .catch(e => console.error(e))
                      .finally(() => setAggLoading(false));
                  }}
                >↻ Refresh</button>
              </div>

              {aggLoading && (
                <div className="agg-loading">
                  <div className="tripmap-spinner" />
                  <p>Computing aggregate data across all trips…</p>
                </div>
              )}

              {aggregate && !aggLoading && (<>

                {/* ── KPI strip ─────────────────────────────────── */}
                <div className="agg-kpi-strip">
                  {[
                    { label: "Trips Analyzed",     value: aggregate.total_trips,           color: "#1565c0" },
                    { label: "Total GPS Logs",      value: aggregate.total_logs.toLocaleString(), color: "#42a5f5" },
                    { label: "Avg Load Factor",     value: `${aggregate.avg_load_factor_pct}%`,   color: aggregate.avg_load_factor_pct > 100 ? "#c62828" : "#2e7d32" },
                    { label: "Peak Critical Period", value: aggregate.peak_critical_period || "—", color: "#ef6c00" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="agg-kpi-card">
                      <div className="agg-kpi-value" style={{ color }}>{value}</div>
                      <div className="agg-kpi-label">{label}</div>
                    </div>
                  ))}
                </div>

                {/* ── Two-column charts ─────────────────────────── */}
                <div className="agg-charts-row">

                  {/* Time period distribution */}
                  <div className="agg-chart-card">
                    <div className="agg-chart-title">
                      Time Period Distribution
                      <span className="agg-chart-subtitle">GPS logs across all trips</span>
                    </div>
                    {(() => {
                      const d = aggregate.time_distribution;
                      const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
                      const COLOR = { "Morning Peak": "#1565c0", "Midday": "#00acc1", "Afternoon Peak": "#ef6c00", "Off-Peak": "#8e9ab0" };
                      return Object.entries(d).map(([period, count]) => (
                        <div key={period} className="agg-bar-row">
                          <span className="agg-bar-label">{period}</span>
                          <div className="agg-bar-track">
                            <div
                              className="agg-bar-fill"
                              style={{ width: `${(count / total) * 100}%`, background: COLOR[period] }}
                            />
                          </div>
                          <span className="agg-bar-pct">{((count / total) * 100).toFixed(1)}%</span>
                          <span className="agg-bar-count">({count.toLocaleString()})</span>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Demand intensity distribution */}
                  <div className="agg-chart-card">
                    <div className="agg-chart-title">
                      Demand Intensity Distribution
                      <span className="agg-chart-subtitle">across all GPS log records</span>
                    </div>
                    {(() => {
                      const d = aggregate.demand_distribution;
                      const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
                      const COLOR = { Normal: "#2e7d32", Moderate: "#f9a825", High: "#ef6c00", Critical: "#c62828" };
                      return Object.entries(d).map(([tier, count]) => (
                        <div key={tier} className="agg-bar-row">
                          <span className="agg-bar-label">{tier}</span>
                          <div className="agg-bar-track">
                            <div
                              className="agg-bar-fill"
                              style={{ width: `${(count / total) * 100}%`, background: COLOR[tier] }}
                            />
                          </div>
                          <span className="agg-bar-pct">{((count / total) * 100).toFixed(1)}%</span>
                          <span className="agg-bar-count">({count.toLocaleString()})</span>
                        </div>
                      ));
                    })()}
                  </div>

                </div>

                {/* ── Critical demand by period ──────────────────── */}
                <div className="agg-chart-card" style={{ marginBottom: 20 }}>
                  <div className="agg-chart-title">
                    Critical Demand Logs by Time Period
                    <span className="agg-chart-subtitle">which period has the most overcrowded moments</span>
                  </div>
                  {(() => {
                    const d = aggregate.critical_by_period;
                    const max = Math.max(...Object.values(d), 1);
                    const COLOR = { "Morning Peak": "#1565c0", "Midday": "#00acc1", "Afternoon Peak": "#ef6c00", "Off-Peak": "#8e9ab0" };
                    return Object.entries(d).map(([period, count]) => (
                      <div key={period} className="agg-bar-row">
                        <span className="agg-bar-label">
                          {period}
                          {period === aggregate.peak_critical_period && (
                            <span className="agg-peak-badge">WORST</span>
                          )}
                        </span>
                        <div className="agg-bar-track">
                          <div
                            className="agg-bar-fill"
                            style={{
                              width: `${(count / max) * 100}%`,
                              background: period === aggregate.peak_critical_period ? "#c62828" : COLOR[period],
                            }}
                          />
                        </div>
                        <span className="agg-bar-count">{count.toLocaleString()} critical logs</span>
                      </div>
                    ));
                  })()}
                </div>

                {/* ── Per-trip breakdown table ───────────────────── */}
                <div className="agg-chart-card">
                  <div className="agg-chart-title">
                    Per-Trip Breakdown
                    <span className="agg-chart-subtitle">{aggregate.trip_summaries.length} completed trips</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="admin-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Trip ID</th>
                          <th>Jeep</th>
                          <th>Direction</th>
                          <th>Date</th>
                          <th>Logs</th>
                          <th>Avg LF</th>
                          <th>Max Occ</th>
                          <th>Cap</th>
                          <th>Dominant Tier</th>
                          <th>Peak Period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aggregate.trip_summaries.map(t => {
                          const TIER_COLOR = { Normal: "#2e7d32", Moderate: "#f9a825", High: "#ef6c00", Critical: "#c62828" };
                          return (
                            <tr key={t.trip_id}>
                              <td className="admin-mono" style={{ fontSize: 10, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                              <td className="admin-mono" style={{ fontWeight: 700 }}>{t.jeep_code}</td>
                              <td style={{ fontSize: 11 }}>{t.direction === "MALANDAY-RECTO" ? "→ Recto" : "← Malanday"}</td>
                              <td className="admin-mono">{t.date}</td>
                              <td className="admin-mono">{t.log_count}</td>
                              <td className="admin-mono" style={{ color: t.avg_lf_pct > 100 ? "#c62828" : "#2e7d32", fontWeight: 700 }}>{t.avg_lf_pct}%</td>
                              <td className="admin-mono">{t.max_occupancy}</td>
                              <td className="admin-mono">{t.capacity}</td>
                              <td>
                                <span className="admin-status-badge" style={{ background: TIER_COLOR[t.dominant_tier] + "22", color: TIER_COLOR[t.dominant_tier] }}>
                                  {t.dominant_tier}
                                </span>
                              </td>
                              <td style={{ fontSize: 11 }}>{t.dominant_period}</td>
                            </tr>
                          );
                        })}
                        {aggregate.trip_summaries.length === 0 && (
                          <tr><td colSpan={10} style={{ textAlign: "center", padding: 32, color: "#8e9ab0" }}>
                            No completed trips found.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </>)}
            </div>
          )}

        </main>
      </div>

      {mapTripId && <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />}
    </>
  );
}
