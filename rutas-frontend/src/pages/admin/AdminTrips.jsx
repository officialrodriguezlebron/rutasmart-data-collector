import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getAdminTrips, getAggregateDashboard, deleteTrip, exportTrip, importTripCSV } from "../../services/api";
import { goodColor, periodColorCard, phtDateStr, phtTimeStr, dirLabel } from "../../utils/adminFormatters";
import TripMap from "../TripMap";
import "../AdminDashboard.css";

const Icon = ({ name, size = 18 }) => {
  const icons = {
    clock:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
    chevron: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />,
  };
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0 }}>
      {icons[name]}
    </svg>
  );
};

export default function AdminTrips() {
  const [trips,     setTrips]     = useState([]);
  const [aggregate, setAggregate] = useState(null);
  const [loading,   setLoading]   = useState(true);

  const [deletingId,   setDeletingId]   = useState(null);
  const [exportingId,  setExportingId]  = useState(null);
  const [exportDoneId, setExportDoneId] = useState(null);
  const [mapTripId,    setMapTripId]    = useState(null);
  const [importing,    setImporting]    = useState(false);
  const [importMsg,    setImportMsg]    = useState(null);

  const [expanded, setExpanded] = useState(null);
  const [search,   setSearch]   = useState("");
  const [statusF,  setStatusF]  = useState("all");
  const [dirF,     setDirF]     = useState("all");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 12;

  const load = () => {
    setLoading(true);
    Promise.all([getAdminTrips(), getAggregateDashboard()])
      .then(([t, a]) => { setTrips(t.data); setAggregate(a.data); })
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (tripId) => {
    if (!window.confirm(`Delete trip ${tripId}?\n\nPermanently removes all GPS logs.`)) return;
    setDeletingId(tripId);
    try {
      const res = await deleteTrip(tripId);
      setImportMsg({ type: "success", text: `Deleted — ${res.data.logs_removed} logs removed.` });
      load();
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
      load();
    } catch (err) {
      setImportMsg({ type: "error", text: err.response?.data?.detail || "Import failed." });
    } finally { setImporting(false); e.target.value = ""; }
  };

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

  const statusColor = (s) => s === "ACTIVE" ? "#30d158" : s === "COMPLETED" ? "#42a5f5" : "#8e9ab0";

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <div className="admin-topbar">
          <h1>Trips</h1>
          <button className="admin-refresh" onClick={load} disabled={loading}>↺ Refresh</button>
        </div>

        {loading ? (
          <div className="admin-loading">Loading trips…</div>
        ) : (
          <>
            {importMsg && (
              <div className={`admin-msg ${importMsg.type}`} style={{ marginBottom: 14 }}>{importMsg.text}</div>
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
                                <button onClick={() => setMapTripId(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>🗺 Map</button>
                                <button onClick={() => handleExport(t.trip_id, t.jeep_code)} disabled={exportingId === t.trip_id} className="trips-action-btn"
                                  style={{ background: exportDoneId === t.trip_id ? "rgba(48,209,88,0.10)" : "rgba(66,165,245,0.10)", color: exportDoneId === t.trip_id ? "#1a6630" : "#42a5f5", border: `1px solid ${exportDoneId === t.trip_id ? "rgba(48,209,88,0.30)" : "rgba(66,165,245,0.30)"}` }}>
                                  {exportingId === t.trip_id ? "…" : exportDoneId === t.trip_id ? "✓ Done" : "⬇ CSV"}
                                </button>
                                <button onClick={() => handleDelete(t.trip_id)} disabled={deletingId === t.trip_id} className="trips-action-btn" style={{ background: "rgba(255,69,58,0.10)", color: "#c62828", border: "1px solid rgba(255,69,58,0.25)" }}>
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
                <input type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportFile} disabled={importing} />
              </label>
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
