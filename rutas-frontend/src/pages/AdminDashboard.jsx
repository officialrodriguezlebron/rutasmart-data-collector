import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAdminStats, getAdminTrips, seedUsers,
  deleteTrip, importTripCSV,
} from "../services/api";
import { authService } from "../services/authService";
import TripMap from "./TripMap";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user     = authService.getUser();

  const [stats,  setStats]  = useState(null);
  const [trips,  setTrips]  = useState([]);
  const [loading,setLoading]= useState(true);
  const [tab,    setTab]    = useState("overview");
  const [seeded, setSeeded] = useState(false);

  const [importing,     setImporting]     = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);
  const [mapTripId,     setMapTripId]     = useState(null);

  useEffect(() => {
    if (!authService.isAdmin()) { navigate("/login", { replace: true }); return; }
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([getAdminStats(), getAdminTrips()]);
      setStats(s.data); setTrips(t.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleLogout = () => { authService.clearSession(); navigate("/login", { replace: true }); };

  const handleSeed = async () => {
    try { await seedUsers(); setSeeded(true); fetchData(); } catch (e) { console.error(e); }
  };

  const handleDelete = async (tripId) => {
    if (!window.confirm(`Delete trip ${tripId}?\n\nPermanently removes trip AND all GPS logs.`)) return;
    setDeletingId(tripId);
    try {
      const res = await deleteTrip(tripId);
      setImportMessage({ type: "success", text: `Deleted ${tripId} — ${res.data.logs_removed} logs removed.` });
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

  const statusColor = (s) =>
    s === "ACTIVE" ? "#2e7d32" : s === "COMPLETED" ? "#1565c0" : "#888";

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
            {[
              { key: "overview",  label: "Overview"  },
              { key: "trips",     label: "Trips"     },
              { key: "analytics", label: "Analytics" },
            ].map(({ key, label }) => (
              <button key={key}
                className={`admin-nav-item ${tab === key ? "active" : ""}`}
                onClick={() => key === "analytics" ? navigate("/analytics") : setTab(key)}>
                {label}
              </button>
            ))}
            <div className="admin-nav-section">SYSTEM</div>
            <button className={`admin-nav-item ${tab === "seed" ? "active" : ""}`}
              onClick={() => setTab("seed")}>
              Seed Users
            </button>
          </nav>

          <button className="admin-signout" onClick={handleLogout}>Sign Out</button>
        </aside>

        {/* Main */}
        <main className="admin-main">

          <div className="admin-topbar">
            <h1>
              {tab === "overview" && "Overview"}
              {tab === "trips"    && "Trips"}
              {tab === "seed"     && "Seed Users"}
            </h1>
            <button className="admin-refresh" onClick={fetchData}>↺ Refresh</button>
          </div>

          {loading && <div className="admin-loading">Loading…</div>}

          {/* Overview */}
          {!loading && tab === "overview" && stats && (
            <>
              <div className="admin-metrics">
                {[
                  { label: "Active Trips", value: stats.active_trips,                color: "#2e7d32" },
                  { label: "Total Trips",  value: stats.total_trips,                 color: "#1565c0" },
                  { label: "GPS Logs",     value: stats.total_logs.toLocaleString(), color: "#1f2937" },
                  { label: "Users",        value: stats.total_users,                 color: "#1f2937" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="admin-metric-card">
                    <div className="admin-metric-label">{label}</div>
                    <div className="admin-metric-value" style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="admin-card">
                <div className="admin-card-title">Active Jeeps
                  <a href="/route/MR-001" target="_blank" rel="noreferrer"
                     style={{ fontSize:11, fontWeight:600, color:"#1565c0",
                              marginLeft:10, textDecoration:"underline" }}>
                    🔗 Public Dashboard
                  </a>
                </div>
                {stats.active_jeeps.length === 0
                  ? <p className="admin-empty">No jeeps currently active.</p>
                  : <div className="admin-jeep-list">
                      {stats.active_jeeps.map(j => <span key={j} className="admin-jeep-badge">{j}</span>)}
                    </div>
                }
              </div>

              <div className="admin-card">
                <div className="admin-card-title">System Health</div>
                <div className="admin-health-grid">
                  {[["API Server","UP"],["PostgreSQL DB","UP"],["PWA CDN","UP"]].map(([s,st]) => (
                    <div key={s} className="admin-health-row">
                      <span className="admin-health-dot" />
                      <span>{s}</span>
                      <span className="admin-health-status">{st}</span>
                    </div>
                  ))}
                </div>
                <p className="admin-health-note">Railway · PostgreSQL 15 · FastAPI · React PWA</p>
              </div>

              <div className="admin-card">
                <div className="admin-card-title">Recent Trips (last 5)</div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Trip ID</th><th>Jeep</th><th>Status</th><th>Start</th></tr>
                    </thead>
                    <tbody>
                      {trips.slice(0, 5).map(t => (
                        <tr key={t.trip_id}>
                          <td className="admin-mono" style={{ fontSize: 11 }}>{t.trip_id}</td>
                          <td>{t.jeep_code}</td>
                          <td>
                            <span className="admin-status-badge"
                              style={{ background: statusColor(t.status)+"22", color: statusColor(t.status) }}>
                              {t.status}
                            </span>
                          </td>
                          <td className="admin-mono" style={{ fontSize: 11, color: "#888" }}>
                            {t.start_time?.slice(0,16)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Trips — import + full inventory */}
          {!loading && tab === "trips" && (
            <>
              {/* Import */}
              <div className="admin-card" style={{ marginBottom: 16 }}>
                <div className="admin-card-title">Import Trip from CSV</div>
                <p style={{ fontSize: 13, color: "#666", marginBottom: 14, lineHeight: 1.6 }}>
                  Upload a CSV exported from a previous trip. Required columns:&nbsp;
                  <code style={{ fontFamily: "monospace", fontSize: 12, background: "#f4f6f8",
                                 padding: "1px 6px", borderRadius: 4 }}>
                    latitude, longitude, accuracy, occupancy_count, timestamp
                  </code>
                </p>
                <label htmlFor="csv-import-input" className="admin-seed-btn"
                  style={{ display: "block", textAlign: "center",
                           cursor: importing ? "not-allowed" : "pointer",
                           opacity: importing ? 0.6 : 1 }}>
                  {importing ? "Importing…" : "Choose CSV file to import"}
                </label>
                <input id="csv-import-input" type="file" accept=".csv"
                  style={{ display: "none" }} onChange={handleImport} disabled={importing} />
                {importMessage && (
                  <div style={{
                    marginTop: 12, padding: "10px 14px", borderRadius: 10, fontSize: 13,
                    background: importMessage.type === "success" ? "#e8f5e9" : "#ffebee",
                    color:      importMessage.type === "success" ? "#2e7d32" : "#c62828",
                    border: `1px solid ${importMessage.type === "success" ? "#c8e6c9" : "#ffcdd2"}`,
                  }}>
                    {importMessage.text}
                  </div>
                )}
              </div>

              {/* Full trip table */}
              <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px 12px", display: "flex",
                              justifyContent: "space-between", alignItems: "center" }}>
                  <div className="admin-card-title" style={{ marginBottom: 0 }}>
                    All Trips ({trips.length})
                  </div>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Trip ID</th>
                        <th>Jeep</th>
                        <th>Direction</th>
                        <th>Cap</th>
                        <th>Status</th>
                        <th>Start</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trips.map(t => (
                        <tr key={t.trip_id}>
                          <td className="admin-mono" style={{ fontSize: 10 }}>{t.trip_id}</td>
                          <td>{t.jeep_code}</td>
                          <td style={{ fontSize: 11 }}>{t.direction}</td>
                          <td style={{ textAlign: "center" }}>{t.official_capacity}</td>
                          <td>
                            <span className="admin-status-badge"
                              style={{ background: statusColor(t.status)+"22", color: statusColor(t.status) }}>
                              {t.status}
                            </span>
                          </td>
                          <td className="admin-mono" style={{ fontSize: 10, color: "#888" }}>
                            {t.start_time?.slice(0,16)}
                          </td>
                          <td>
                            <div className="admin-action-group">
                              {t.status === "COMPLETED" && (<>
                                <button className="admin-action-btn"
                                  onClick={() => navigate(`/analytics?trip=${t.trip_id}`)}>
                                  Analyse
                                </button>
                                <button className="admin-action-btn"
                                  style={{ background: "#e3f2fd", color: "#0288d1" }}
                                  onClick={() => setMapTripId(t.trip_id)}>
                                  🗺
                                </button>
                              </>)}
                              <button className="admin-action-btn"
                                style={{ background: "#ffebee", color: "#c62828" }}
                                onClick={() => handleDelete(t.trip_id)}
                                disabled={deletingId === t.trip_id}>
                                {deletingId === t.trip_id ? "…" : "Del"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {trips.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: "center", padding: 28, color: "#aaa" }}>
                            No trips yet. Run a field ride or import a CSV above.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Seed Users */}
          {tab === "seed" && (
            <div className="admin-card" style={{ maxWidth: 480 }}>
              <div className="admin-card-title">Seed Default Users</div>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
                Creates default Admin, Analyst, and two Conductor accounts. Safe to run multiple times.
              </p>
              <div className="admin-credentials">
                {[
                  ["Admin",     "admin@rutasmart.ph",   "Admin2026!",   "—"],
                  ["Analyst",   "analyst@rutasmart.ph", "Analyst2026!", "—"],
                  ["Conductor", "CDR-2024-042",          "PIN: 1234",   "JPN-001"],
                  ["Conductor", "CDR-2024-043",          "PIN: 5678",   "JPN-002"],
                ].map(([role, id, cred, jeep]) => (
                  <div key={id} className="admin-cred-row">
                    <span className="admin-cred-role">{role}</span>
                    <span className="admin-cred-id">{id}</span>
                    <span className="admin-cred-pass">{cred}</span>
                    <span className="admin-cred-jeep">{jeep}</span>
                  </div>
                ))}
              </div>
              <button className="admin-seed-btn" onClick={handleSeed} disabled={seeded}>
                {seeded ? "✓ Users seeded" : "Seed Users"}
              </button>
              {seeded && (
                <p style={{ fontSize: 12, color: "#2e7d32", marginTop: 10 }}>
                  Default users created. You can now log in.
                </p>
              )}
            </div>
          )}

        </main>
      </div>

      {/* Heatmap modal */}
      {mapTripId && (
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />
      )}
    </>
  );
}
