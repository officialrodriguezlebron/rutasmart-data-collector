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
import "./AdminDashboard.css";

function PublishStopZonesPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    if (!window.confirm(
      "Publish stop zones for MR-001?\n\n" +
      "This runs DBSCAN across all completed trips and updates the passenger map. " +
      "The current published map will be replaced."
    )) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await publishStopZones("MR-001");
      setStatus({ ok: true, msg: res.data.message });
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail || "Publish failed." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "rgba(21,101,192,0.10)",
      border: "1px solid rgba(21,101,192,0.30)",
      borderRadius: 16,
      padding: "18px 20px",
      margin: "16px 0",
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#1565c0", marginBottom: 6 }}>
        🗺 Passenger Stop Zone Map
      </div>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 14px", lineHeight: 1.5 }}>
        Run DBSCAN across all completed trips and publish the detected stop zones
        to the passenger dashboard. Review the cluster map in the Analytics Engine
        before publishing.
      </p>
      <button
        onClick={handlePublish}
        disabled={loading}
        style={{
          background: loading ? "#ccc" : "#1565c0",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "10px 22px",
          fontSize: 14,
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {loading ? "Publishing…" : "📤 Publish Stop Zones"}
      </button>
      {status && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 10,
          fontSize: 13,
          background: status.ok ? "rgba(46,125,50,0.10)" : "rgba(198,40,40,0.10)",
          color: status.ok ? "#2e7d32" : "#c62828",
          fontWeight: 500,
        }}>
          {status.ok ? "✅" : "❌"} {status.msg}
        </div>
      )}
    </div>
  );
}

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
  const [dragOver,       setDragOver]       = useState(false);
  const [dropFile,       setDropFile]       = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [exportingId,    setExportingId]    = useState(null);
  const [exportDoneId,   setExportDoneId]   = useState(null);
  const [mapTripId,      setMapTripId]      = useState(null);

  // ── Trips tab — filter, pagination, multi-select ────────────────────────
  const [tripSearch,   setTripSearch]   = useState("");
  const [tripStatus,   setTripStatus]   = useState("all");
  const [tripDir,      setTripDir]      = useState("all");
  const [tripPage,     setTripPage]     = useState(1);
  const [selected,     setSelected]     = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const PAGE_SIZE = 10;

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
      setSelected(prev => { const s = new Set(prev); s.delete(tripId); return s; });
      fetchData();
    } catch (e) {
      setImportMessage({ type: "error", text: e.response?.data?.detail || "Delete failed." });
    } finally { setDeletingId(null); }
  };

  const handleExport = async (tripId, jeepCode) => {
    if (exportingId === tripId) return;
    setExportingId(tripId);
    setExportDoneId(null);
    try {
      const res = await exportTrip(tripId);
      const date = new Date().toISOString().slice(0, 10);
      const filename = `rutasmart_${(jeepCode || "trip").replace(/[^a-zA-Z0-9]/g, "_")}_${tripId.slice(-8)}_${date}.csv`;
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportDoneId(tripId);
      setTimeout(() => setExportDoneId(null), 2500);
    } catch (e) {
      setImportMessage({ type: "error", text: e.response?.data?.detail || "Export failed." });
    } finally {
      setExportingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} selected trip(s)?\n\nThis permanently removes all GPS logs for each trip.`)) return;
    setBulkDeleting(true);
    const results = await Promise.allSettled(
      Array.from(selected).map(id => deleteTrip(id))
    );
    const deleted = results.filter(r => r.status === "fulfilled").length;
    const failed  = results.length - deleted;
    setSelected(new Set());
    setImportMessage({
      type: failed ? "error" : "success",
      text: `Deleted ${deleted} trip(s).${failed ? ` ${failed} failed.` : ""}`,
    });
    setBulkDeleting(false);
    fetchData();
  };

  const filteredTrips = trips.filter(t => {
    const q = tripSearch.toLowerCase();
    const matchSearch = !q ||
      t.trip_id?.toLowerCase().includes(q) ||
      t.jeep_code?.toLowerCase().includes(q) ||
      t.recorder_id?.toLowerCase().includes(q);
    const matchStatus = tripStatus === "all" || t.status === tripStatus;
    const matchDir    = tripDir    === "all" || t.direction === tripDir;
    return matchSearch && matchStatus && matchDir;
  });
  const totalPages   = Math.max(1, Math.ceil(filteredTrips.length / PAGE_SIZE));
  const paginated    = filteredTrips.slice((tripPage - 1) * PAGE_SIZE, tripPage * PAGE_SIZE);
  const allPageSelected = paginated.length > 0 && paginated.every(t => selected.has(t.trip_id));

  const toggleSelect = (id) => setSelected(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  const togglePage = () => {
    if (allPageSelected) {
      setSelected(prev => { const s = new Set(prev); paginated.forEach(t => s.delete(t.trip_id)); return s; });
    } else {
      setSelected(prev => { const s = new Set(prev); paginated.forEach(t => s.add(t.trip_id)); return s; });
    }
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    setImporting(true); setImportMessage(null);
    try {
      const res = await importTripCSV(file);
      setImportMessage({ type: "success", text: `Imported "${res.data.imported}" — ${res.data.logs_imported} logs added.` });
      setDropFile(null);
      fetchData();
    } catch (err) {
      setImportMessage({ type: "error", text: err.response?.data?.detail || "Import failed." });
    } finally { setImporting(false); }
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
    s === "ACTIVE" ? "#00c853" : s === "COMPLETED" ? "#1565c0" : "#888";

  const COLOR = { "Morning Peak": "#ef6c00", "Midday": "#1565c0", "Afternoon Peak": "#c62828", "Evening": "#6a1b9a", "Off-Peak": "#555" };

  const TABS = [
    { key: "overview",   label: "Overview"   },
    { key: "trips",      label: "Trips"      },
    { key: "conductors", label: "Conductors" },
    { key: "aggregate",  label: "Aggregate"  },
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
              {tab === "aggregate"  && "Aggregate Dashboard"}
            </h1>
            <button className="admin-refresh" onClick={fetchData}>↺ Refresh</button>
          </div>

          {loading && <div className="admin-loading">Loading…</div>}
          {tab === "trips" && dragOver && !importing && (
            <div className="admin-drag-overlay">Drop CSV file to import</div>
          )}

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
            <PublishStopZonesPanel />
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
          {!loading && tab === "trips" && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f && f.name.endsWith(".csv")) { setDropFile(f); handleImportFile(f); }
              }}
              style={{ display:"contents" }}
            ><>
            <input id="csv-input-hidden" type="file" accept=".csv"
              style={{ display:"none" }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setDropFile(f); handleImportFile(f); }
                e.target.value = "";
              }}
              disabled={importing}
            />
            {importMessage && (
              <div className={`admin-msg ${importMessage.type}`} style={{ marginBottom:12 }}>{importMessage.text}</div>
            )}

            <div className="admin-card" style={{ padding:0, overflow:"hidden" }}>
              <div className="trips-filter-bar">
                <input
                  className="trips-search"
                  placeholder="🔍 Search trip ID, jeep code…"
                  value={tripSearch}
                  onChange={e => { setTripSearch(e.target.value); setTripPage(1); setSelected(new Set()); }}
                />
                <select className="trips-filter-select" value={tripStatus}
                  onChange={e => { setTripStatus(e.target.value); setTripPage(1); setSelected(new Set()); }}>
                  <option value="all">All statuses</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ACTIVE">Active</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
                <select className="trips-filter-select" value={tripDir}
                  onChange={e => { setTripDir(e.target.value); setTripPage(1); setSelected(new Set()); }}>
                  <option value="all">All directions</option>
                  <option value="MALANDAY-RECTO">Malanday → Recto</option>
                  <option value="RECTO-MALANDAY">Recto → Malanday</option>
                </select>
                <span className="trips-count">
                  {filteredTrips.length} trip{filteredTrips.length !== 1 ? "s" : ""}
                  {(tripSearch || tripStatus !== "all" || tripDir !== "all") ? ` of ${trips.length}` : ""}
                </span>
              </div>

              {selected.size > 0 && (
                <div className="trips-bulk-bar">
                  <span className="trips-bulk-label">{selected.size} selected</span>
                  <button className="trips-bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
                  <button className="trips-bulk-delete" onClick={handleBulkDelete} disabled={bulkDeleting}>
                    {bulkDeleting ? "Deleting…" : `🗑 Delete ${selected.size}`}
                  </button>
                </div>
              )}

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width:36 }}>
                        <input type="checkbox" checked={allPageSelected} onChange={togglePage}
                          style={{ cursor:"pointer", accentColor:"#1565c0" }} />
                      </th>
                      <th>Trip ID</th>
                      <th>Jeep</th>
                      <th>Direction</th>
                      <th>Status</th>
                      <th>Logs</th>
                      <th>Start</th>
                      <th style={{ width:200 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign:"center", color:"#8e9ab0", padding:"32px 0" }}>
                        No trips match your filters.
                      </td></tr>
                    )}
                    {paginated.map(t => (
                      <tr key={t.trip_id} className={selected.has(t.trip_id) ? "trips-row-selected" : ""}>
                        <td>
                          <input type="checkbox" checked={selected.has(t.trip_id)}
                            onChange={() => toggleSelect(t.trip_id)}
                            style={{ cursor:"pointer", accentColor:"#1565c0" }} />
                        </td>
                        <td className="admin-mono" style={{ fontSize:12 }}>{t.trip_id.slice(-12)}</td>
                        <td>{t.jeep_code}</td>
                        <td style={{ fontSize:12 }}>{t.direction?.replace("-","→") || "—"}</td>
                        <td>
                          <span className="admin-status-badge"
                            style={{ background: statusColor(t.status)+"22", color: statusColor(t.status) }}>
                            {t.status}
                          </span>
                        </td>
                        <td className="admin-mono">{t.log_count ?? "—"}</td>
                        <td className="admin-mono" style={{ color:"#8e9ab0", fontSize:12 }}>{t.start_time?.slice(0,16)}</td>
                        <td>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            {/* ✅ FIX 2 — Map button opens TripMap with map-matching + full legend */}
                            <button
                              className="trips-action-btn"
                              style={{ background:"#1565c020", color:"#1565c0", border:"1px solid #1565c040" }}
                              onClick={() => setMapTripId(t.trip_id)}
                              title="View map with matched path, clusters & legend"
                            >
                              🗺 Map
                            </button>
                            <button
                              className="trips-action-btn"
                              style={exportDoneId === t.trip_id
                                ? { background:"#2e7d3220", color:"#2e7d32", border:"1px solid #2e7d3240" }
                                : { background:"#0277bd20", color:"#0277bd", border:"1px solid #0277bd40" }}
                              onClick={() => handleExport(t.trip_id, t.jeep_code)}
                              disabled={exportingId === t.trip_id}
                            >
                              {exportingId === t.trip_id ? "…" : exportDoneId === t.trip_id ? "✓ Done" : "⬇ CSV"}
                            </button>
                            <button
                              className="trips-action-btn"
                              style={{ background:"#c6282820", color:"#c62828", border:"1px solid #c6282840" }}
                              onClick={() => handleDelete(t.trip_id)}
                              disabled={deletingId === t.trip_id}
                            >
                              {deletingId === t.trip_id ? "…" : "🗑"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="trips-pagination">
                  <button className="trips-page-btn" onClick={() => setTripPage(1)} disabled={tripPage === 1}>«</button>
                  <button className="trips-page-btn" onClick={() => setTripPage(p => Math.max(1, p-1))} disabled={tripPage === 1}>‹</button>
                  <span className="trips-page-info">Page {tripPage} of {totalPages}</span>
                  <button className="trips-page-btn" onClick={() => setTripPage(p => Math.min(totalPages, p+1))} disabled={tripPage === totalPages}>›</button>
                  <button className="trips-page-btn" onClick={() => setTripPage(totalPages)} disabled={tripPage === totalPages}>»</button>
                </div>
              )}
            </div>

            {/* Import panel */}
            <div className="admin-card">
              <div className="admin-card-title">Import Trip CSV</div>
              <p style={{ fontSize:13, color:"#8e9ab0", margin:"0 0 14px" }}>
                Drag a CSV file onto the page or click below to import a previously exported trip.
              </p>
              <label style={{
                display:"inline-block", background:"#1565c0", color:"#fff",
                borderRadius:10, padding:"10px 22px", fontSize:14, fontWeight:700,
                cursor: importing ? "not-allowed" : "pointer",
                opacity: importing ? 0.6 : 1,
              }}>
                {importing ? "Importing…" : dropFile ? `📄 ${dropFile.name}` : "📂 Choose CSV"}
                <input type="file" accept=".csv" style={{ display:"none" }} onChange={handleImport} disabled={importing} />
              </label>
            </div>
            </></div>
          )}

          {/* ── CONDUCTORS ───────────────────────────────────── */}
          {!loading && tab === "conductors" && (<>
            <div className="admin-card">
              <div className="admin-card-title">Conductors ({conductors.length})</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th>Name</th><th>Employee ID</th><th>Jeep</th><th>Created</th>
                  </tr></thead>
                  <tbody>
                    {conductors.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign:"center", color:"#8e9ab0", padding:"24px 0" }}>
                        No conductors yet.
                      </td></tr>
                    )}
                    {conductors.map(c => (
                      <tr key={c.user_id}>
                        <td>{c.display_name}</td>
                        <td className="admin-mono">{c.employee_id}</td>
                        <td>{c.jeep_code || "—"}</td>
                        <td className="admin-mono" style={{ color:"#8e9ab0", fontSize:12 }}>{c.created_at?.slice(0,10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-card">
              <div className="admin-card-title">Create Conductor Account</div>
              {createMsg && (
                <div className={`admin-msg ${createMsg.type}`} style={{ marginBottom:12 }}>{createMsg.text}</div>
              )}
              <div className="admin-form-grid">
                {[
                  { label:"Display Name", value:newName,  setter:setNewName,  placeholder:"e.g. Juan dela Cruz" },
                  { label:"Employee ID",  value:newEmpId, setter:setNewEmpId, placeholder:"e.g. EMP-001" },
                  { label:"PIN (6 digits)", value:newPin, setter:setNewPin,   placeholder:"6-digit PIN", type:"password" },
                  { label:"Jeep Code",    value:newJeep,  setter:setNewJeep,  placeholder:"e.g. MR-001 (optional)" },
                ].map(({ label, value, setter, placeholder, type }) => (
                  <div key={label} className="admin-form-field">
                    <label className="admin-form-label">{label}</label>
                    <input
                      className="admin-form-input"
                      type={type || "text"}
                      value={value}
                      onChange={e => setter(e.target.value)}
                      placeholder={placeholder}
                    />
                  </div>
                ))}
              </div>
              <button
                className="admin-form-submit"
                onClick={async () => {
                  if (!newName || !newEmpId || newPin.length !== 6) {
                    setCreateMsg({ type:"error", text:"All fields required. PIN must be 6 digits." });
                    return;
                  }
                  setCreating(true);
                  try {
                    await createUser({ role:"CONDUCTOR", display_name:newName, employee_id:newEmpId, pin:newPin, jeep_code:newJeep||undefined });
                    setCreateMsg({ type:"success", text:`Conductor "${newName}" (${newEmpId}) created.` });
                    setNewName(""); setNewEmpId(""); setNewPin(""); setNewJeep("");
                    fetchData();
                  } catch (err) {
                    setCreateMsg({ type:"error", text: err.response?.data?.detail || "Failed to create account." });
                  } finally { setCreating(false); }
                }}
                disabled={creating}
              >
                {creating ? "Creating…" : "➕ Create Conductor"}
              </button>
            </div>
          </>)}

          {/* ── AGGREGATE ────────────────────────────────────── */}
          {tab === "aggregate" && (
            <div>
              {aggLoading && (
                <div style={{ textAlign:"center", padding:"48px 0", color:"#8e9ab0" }}>
                  <div className="admin-loading" />
                  <p>Computing aggregate data across all trips…</p>
                </div>
              )}
              {aggregate && !aggLoading && (<>
                {/* KPI strip */}
                <div className="admin-metrics">
                  {[
                    { label: "Trips Analyzed",     value: aggregate.total_trips,                  color: "#1565c0" },
                    { label: "Total GPS Logs",      value: aggregate.total_logs.toLocaleString(),  color: "#42a5f5" },
                    { label: "Avg Load Factor",     value: `${aggregate.avg_load_factor_pct}%`,    color: aggregate.avg_load_factor_pct > 100 ? "#c62828" : "#2e7d32" },
                    { label: "Peak Critical Period",value: aggregate.peak_critical_period || "—",  color: "#ef6c00" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="admin-metric-card">
                      <div className="admin-metric-accent" style={{ background: color }} />
                      <div className="admin-metric-label">{label}</div>
                      <div className="admin-metric-value" style={{ color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* ✅ FIX 3 — Legend explanation panel for cluster map */}
                <div style={{
                  background:"rgba(21,101,192,0.07)", border:"1px solid rgba(21,101,192,0.20)",
                  borderRadius:14, padding:"14px 18px", margin:"0 0 16px",
                  fontSize:13, color:"#444", lineHeight:1.6,
                }}>
                  <strong style={{ color:"#1565c0" }}>🗺 Map Legend — same as Public Map</strong>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"18px", marginTop:10 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:11, color:"#888", marginBottom:4 }}>CLUSTER TYPE</div>
                      {[["TRUE_STOP","#1565c0"],["CREEPING_QUEUE","#ef6c00"],["MOVING","#c62828"]].map(([lbl,col])=>(
                        <div key={lbl} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <span style={{ width:12, height:12, borderRadius:"50%", background:col, display:"inline-block" }}/>
                          <span>{lbl.replace("_"," ")}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:11, color:"#888", marginBottom:4 }}>DEMAND TIER</div>
                      {[["Normal","#2e7d32"],["Moderate","#f9a825"],["High","#ef6c00"],["Critical","#c62828"]].map(([lbl,col])=>(
                        <div key={lbl} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <span style={{ width:12, height:12, borderRadius:"50%", background:col, display:"inline-block" }}/>
                          <span>{lbl}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:11, color:"#888", marginBottom:4 }}>GPS QUALITY</div>
                      {[["GOOD","#2e7d32"],["ACCEPTABLE","#f9a825"],["POOR","#c62828"]].map(([lbl,col])=>(
                        <div key={lbl} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <span style={{ width:12, height:12, borderRadius:"50%", background:col, display:"inline-block" }}/>
                          <span>{lbl}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:11, color:"#888", marginBottom:4 }}>PATH</div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                        <span style={{ width:28, height:4, background:"#1565c0", borderRadius:2, display:"inline-block" }}/>
                        <span>Corridor</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                        <span style={{ width:28, height:0, borderTop:"3px dashed #ff6f00", display:"inline-block", verticalAlign:"middle" }}/>
                        <span>Trip Path</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div className="agg-grid">
                  {/* Time distribution */}
                  {aggregate.time_distribution && (
                    <div className="admin-card agg-card">
                      <div className="admin-card-title">Trips by Time Period</div>
                      <div className="agg-bar-chart">
                        {(() => {
                          const d = aggregate.time_distribution;
                          const max = Math.max(...Object.values(d), 1);
                          return Object.entries(d).map(([period, count]) => (
                            <div key={period} className="agg-bar-row">
                              <span className="agg-bar-label">{period}</span>
                              <div className="agg-bar-track">
                                <div className="agg-bar-fill" style={{ width:`${(count/max)*100}%`, background: COLOR[period] || "#42a5f5" }}/>
                              </div>
                              <span className="agg-bar-val">{count}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Demand distribution */}
                  {aggregate.demand_distribution && (
                    <div className="admin-card agg-card">
                      <div className="admin-card-title">Demand Distribution</div>
                      <div className="agg-bar-chart">
                        {(() => {
                          const d = aggregate.demand_distribution;
                          const max = Math.max(...Object.values(d), 1);
                          const DCOL = { Normal:"#2e7d32", Moderate:"#f9a825", High:"#ef6c00", Critical:"#c62828" };
                          return Object.entries(d).map(([tier, count]) => (
                            <div key={tier} className="agg-bar-row">
                              <span className="agg-bar-label">{tier}</span>
                              <div className="agg-bar-track">
                                <div className="agg-bar-fill" style={{ width:`${(count/max)*100}%`, background: DCOL[tier] || "#42a5f5" }}/>
                              </div>
                              <span className="agg-bar-val">{count}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Critical by period */}
                {aggregate.critical_by_period && (
                  <div className="admin-card">
                    <div className="admin-card-title">Critical Clusters by Period</div>
                    <div className="agg-critical-grid">
                      {Object.entries(aggregate.critical_by_period).map(([period, count]) => (
                        <div key={period} className="agg-critical-cell"
                          style={{ borderColor: period === aggregate.peak_critical_period ? "#c62828" : "transparent",
                                   background: period === aggregate.peak_critical_period ? "rgba(198,40,40,0.07)" : "rgba(255,255,255,0.03)" }}>
                          <div className="agg-critical-val"
                            style={{ color: period === aggregate.peak_critical_period ? "#c62828" : COLOR[period] || "#42a5f5" }}>
                            {count}
                          </div>
                          <div className="agg-critical-period">{period}</div>
                          {period === aggregate.peak_critical_period && (
                            <div style={{ fontSize:10, color:"#c62828", fontWeight:700, marginTop:2 }}>⚠ PEAK</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ✅ FIX 3 — Trip summaries with 🗺 Map button → opens TripMap
                    (same map-matching algorithm + cluster circles + full legend as public map) */}
                <div className="admin-card">
                  <div className="admin-card-title">
                    Trip Summaries
                    <span className="agg-chart-subtitle">{aggregate.trip_summaries.length} completed trips</span>
                  </div>
                  <p style={{ fontSize:12, color:"#8e9ab0", margin:"0 0 10px", padding:"0 0 0 0" }}>
                    Click <strong>🗺 Map</strong> on any trip to inspect its map-matched path, DBSCAN clusters, heatmap, and full legend — identical to the public passenger map.
                  </p>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr>
                        <th>Trip ID</th>
                        <th>Period</th>
                        <th>Clusters</th>
                        <th>Peak Occ</th>
                        <th>Load Factor</th>
                        <th>Logs</th>
                        <th>Map</th>
                      </tr></thead>
                      <tbody>
                        {aggregate.trip_summaries.length === 0 && (
                          <tr><td colSpan={7} style={{ textAlign:"center", color:"#8e9ab0", padding:"24px 0" }}>
                            No completed trips to analyze.
                          </td></tr>
                        )}
                        {aggregate.trip_summaries.map(t => {
                          const lf = typeof t.avg_load_factor_pct === "number" ? t.avg_load_factor_pct : null;
                          const lfColor = lf == null ? "#8e9ab0" : lf > 120 ? "#c62828" : lf > 80 ? "#ef6c00" : "#2e7d32";
                          return (
                            <tr key={t.trip_id}>
                              <td className="admin-mono" style={{ fontSize:11 }}>{t.trip_id.slice(-12)}</td>
                              <td>
                                <span style={{ fontSize:12, fontWeight:600, color: COLOR[t.time_period] || "#42a5f5" }}>
                                  {t.time_period || "—"}
                                </span>
                              </td>
                              <td className="admin-mono">{t.cluster_count ?? "—"}</td>
                              <td className="admin-mono">{t.peak_occupancy ?? "—"}</td>
                              <td>
                                {lf != null
                                  ? <span style={{ fontWeight:700, color:lfColor }}>{lf.toFixed(0)}%</span>
                                  : <span style={{ color:"#8e9ab0" }}>—</span>}
                              </td>
                              <td className="admin-mono">{t.log_count ?? "—"}</td>
                              <td>
                                {/* ✅ FIX 3 — Map button per trip in aggregate view */}
                                <button
                                  onClick={() => setMapTripId(t.trip_id)}
                                  title="Open map with map-matched path, clusters & legend"
                                  style={{
                                    background:"#1565c015", color:"#1565c0",
                                    border:"1px solid #1565c030", borderRadius:8,
                                    padding:"5px 10px", fontSize:12, fontWeight:700,
                                    cursor:"pointer", fontFamily:"inherit",
                                  }}
                                >
                                  🗺 Map
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>)}
            </div>
          )}

        </main>
      </div>

      {/*
        ✅ FIX 1 — TripMap rendered via React portal directly on document.body.
        This escapes admin-main's overflow:hidden + CSS stacking context so:
          • The legend bar at the bottom is never clipped
          • The overlay fills the full viewport (not just admin-main's scroll area)
          • z-index works correctly (no stacking context interference)
        Same pattern used by the public map modal.
      */}
      {mapTripId && createPortal(
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />,
        document.body
      )}
    </>
  );
}