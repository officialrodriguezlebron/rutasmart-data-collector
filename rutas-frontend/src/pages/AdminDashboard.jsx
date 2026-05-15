import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAdminStats, getAdminTrips, deleteTrip,
  importTripCSV, createUser, getConductors,
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

        </main>
      </div>

      {mapTripId && <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />}
    </>
  );
}
