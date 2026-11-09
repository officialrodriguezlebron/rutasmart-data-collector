import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getAdminTrips, getAggregateDashboard, deleteTrip, exportTrip, importTripCSV } from "../../services/api";
import { statusColor, periodColorCard, phtDateStr, phtTimeStr, dirLabel } from "../../utils/adminFormatters";
import TripMap from "../TripMap";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataProvenanceNotice, DataStatusBadge,
  useCorridorAnalytics, DEF,
} from "../../components/admin";
import "../AdminDashboard.css";

/**
 * Trips.
 *
 * The per-trip rows keep reading /admin/aggregate. That is the right source
 * here: a trip list is trip-level by nature, and the columns below are
 * explicitly labelled as trip-level so they are not mistaken for the
 * per-record research figures.
 *
 * The corridor strip at the top is different. Those are headline figures,
 * so they come from /analytics/merged/run-all, which computes them per GPS
 * log record across the completed trips.
 *
 * Two corrections to the trip rows:
 *   - the expanded panel read s.avg_load_factor_pct, a field that does not
 *     exist in the /admin/aggregate response (it is avg_lf_pct), so Load
 *     Factor always rendered as a dash.
 *   - the quality column is GOOD-only. /admin/aggregate hardcodes
 *     acceptable_count to 0 and reports everything that is not GOOD as
 *     POOR, so it cannot show the manuscript's three-way split. The column
 *     is now labelled "GOOD share" rather than "Signal Quality", and the
 *     three-way figure is shown in the corridor strip where it is correct.
 */

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

  // Corridor headline figures, per GPS log record. Separate from the
  // trip-level rows below.
  const [dragging, setDragging] = useState(false);
  const corridor = useCorridorAnalytics({ direction: "ALL", range: "ALL" });

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

  /**
   * Whole-page CSV drop.
   *
   * The visible "Import Trip CSV" card is gone; the capability is not. A
   * depth counter is used because dragenter/dragleave also fire for every
   * child element the pointer crosses, so a boolean flickers.
   */
  const dragDepth = useRef(0);

  const importFile = async (file) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setImportMsg({ type: "error", text: "Only .csv files can be imported." });
      return;
    }
    setImporting(true); setImportMsg(null);
    try {
      const res = await importTripCSV(file);
      setImportMsg({ type: "success", text: `Imported "${res.data.imported}" — ${res.data.logs_imported} logs added.` });
      load();
    } catch (err) {
      setImportMsg({ type: "error", text: err.response?.data?.detail || "Import failed." });
    } finally { setImporting(false); }
  };

  // Attached to the page root. preventDefault on dragover/drop is what stops
  // the browser from navigating away to the dropped file.
  const onDragEnter = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
  };
  const onDragLeave = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    importFile(e.dataTransfer?.files?.[0]);
  };

  const handleImportFile = async (e) => {
    await importFile(e.target.files?.[0]);
    e.target.value = "";
  };

  /**
   * Colour for a MEAN LOAD FACTOR. Keyed to capacity status, which is what
   * the bar now shows. It previously used goodColor(), a GPS-accuracy
   * scale, on a bar whose width was also GPS accuracy — so a trip with
   * patchy GPS looked like a crowding problem.
   */
  const loadColor = (pct) => {
    if (pct == null) return "#8e9ab0";
    if (pct > 100) return "#ff453a";   // above seated capacity
    if (pct >= 90) return "#ffd60a";   // near capacity
    return "#30d158";                  // within seated capacity
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

  return (
    <>
      <div
        className={`trips-page${dragging ? " is-dragging" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <AdminPageHeader
          title="Trips"
          subtitle={
            "Every completed trip on the corridor. Row values are trip-level records; " +
            "the corridor figures below are computed per recorded observation."
          }
          badges={
            <>
              <DataStatusBadge tone="info" label="Route MR-001" />
              <DataStatusBadge
                tone={corridor.activeCount > 0 ? "ok" : "default"}
                label={corridor.activeCount > 0
                  ? `${corridor.activeCount} trip${corridor.activeCount === 1 ? "" : "s"} recording now`
                  : "No trip recording now"} />
            </>
          }
          actions={
            <button className="rs-btn" onClick={() => { load(); corridor.reload(); }} disabled={loading}>
              Refresh
            </button>
          }
        />

        {loading ? (
          <div className="admin-loading">Loading trips…</div>
        ) : (
          <>
            {/* Corridor context, per GPS log record. */}
            {corridor.data && (
              <>
                <DataProvenanceNotice
                  trips={corridor.sourceTripCount ?? corridor.sentTrips.length}
                  logs={corridor.totalLogs}
                  days={corridor.collectionDays}
                />
                <div className="rs-metrics" style={{ marginBottom: 20 }}>
                  <MetricCard
                    label="Completed trips"
                    value={(corridor.sourceTripCount ?? 0).toLocaleString()}
                    sub="Included in the corridor figures"
                    accent="var(--rs-fill-info)"
                    definition={DEF.tripsAnalyzed}
                  />
                  <MetricCard
                    label="GPS log records"
                    value={(corridor.totalLogs ?? 0).toLocaleString()}
                    sub="One position and occupancy sample each"
                    definition={DEF.gpsLogs}
                  />
                  <MetricCard
                    label="Met quality threshold"
                    value={corridor.thresholdPct == null ? null : `${corridor.thresholdPct.toFixed(2)}%`}
                    sub="Good plus Acceptable accuracy"
                    accent="var(--rs-fill-normal)"
                    definition={DEF.qualityThreshold}
                    unavailableNote="The analytics response carried no quality summary."
                  />
                  <MetricCard
                    label="Over-capacity share"
                    value={corridor.overCapacityPct == null ? null : `${corridor.overCapacityPct.toFixed(2)}%`}
                    sub="Records above seated capacity"
                    accent="var(--rs-fill-high)"
                    definition={DEF.overCapacity}
                    unavailableNote="The analytics response carried no demand distribution."
                  />
                </div>
                <SectionHeader
                  title="All trips"
                  note="Trip-level records. GOOD share is GOOD accuracy only; the three-way split is in the corridor figures above."
                />
              </>
            )}

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

              {/* What the columns are, and what the bar is not. Stated once
                  above the list rather than repeated per row. */}
              <div className="trips-legend">
                <div className="trips-colhead" aria-hidden="true">
                  <span>Status</span>
                  <span>Start period</span>
                  <span>Mean passenger load</span>
                  <span className="trips-colhead-num">Observations</span>
                  <span className="trips-colhead-num">Mean load</span>
                  <span />
                </div>
                <p className="trips-legend-note">
                  Bars show mean passenger occupancy compared with the official
                  {" "}{aggregate?.trip_summaries?.[0]?.capacity ?? 26}-seat capacity. 100% means all
                  seats are filled; values above 100% mean the recorded occupancy exceeded seated
                  capacity. Colors indicate capacity status, not GPS quality — GPS figures are in
                  each trip&rsquo;s details.
                </p>
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
                      const lf   = s?.avg_lf_pct;            // what the bar shows
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
                            {/* The period is the operating period of the
                                trip's START hour in PHT (backend: _period of
                                start_time + 8h). It is not a highest-load
                                period, so it is labelled "Start period". */}
                            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={per ? `Start period: this trip began during ${per} (Philippine Standard Time).` : undefined}>
                              {per || dirLabel(t.direction)}
                            </span>
                            {/* Mean load factor, with a 100% capacity mark. */}
                            <div className="trips-load-track" title={lf != null
                              ? `Mean passenger load ${lf.toFixed(1)}% of the ${s?.capacity ?? 26}-seat capacity`
                              : undefined}>
                              {lf != null && (
                                <div className="trips-load-fill"
                                  style={{ width: `${Math.min(lf, 130) / 130 * 100}%`,
                                           background: loadColor(lf) }} />
                              )}
                              <span className="trips-load-ref" aria-hidden="true" />
                            </div>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", textAlign: "right", fontFamily: "var(--mono)" }}
                              title="Recorded observations in this trip">
                              {(s?.log_count ?? t.log_count)?.toLocaleString() || "—"}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: loadColor(lf) }}
                              title={lf != null
                                ? `Mean passenger load: recorded occupancy divided by the ${s?.capacity ?? 26}-seat capacity. Not a GPS-quality figure.`
                                : undefined}>
                              {lf != null ? `${lf.toFixed(1)}%` : "—"}
                              <span className="rs-sr"> mean passenger load, trip level</span>
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
                                  ["Jeep code",  t.jeep_code || t.recorder_id || "—"],
                                  ["Direction",  dirLabel(t.direction)],
                                  ["Started (PHT)", phtTimeStr(t.start_time)],
                                  ["Ended (PHT)", t.end_time ? phtTimeStr(t.end_time) : "—"],
                                  ["Start period", per || "—"],
                                  ...(s ? [
                                    ["Observations", s.log_count?.toLocaleString() || "—"],
                                    ["Mean passenger load",
                                     s.avg_lf_pct != null ? `${s.avg_lf_pct.toFixed(1)}%` : "—"],
                                    ["Peak occupancy",
                                     s.max_occupancy != null
                                       ? `${s.max_occupancy} of ${s.capacity ?? 26} seats`
                                       : "—"],
                                    // /admin/aggregate returns acceptable_count = 0 for every
                                    // trip and folds ACCEPTABLE into poor_count, so the
                                    // three-way split is not available per trip here. Only
                                    // what the endpoint actually measures is labelled.
                                    ["GPS GOOD share",
                                     s.good_pct != null ? `${s.good_pct.toFixed(1)}%` : "—"],
                                    ["GPS GOOD observations", s.good_count?.toLocaleString() || "—"],
                                    ["Not GOOD (> 20 m)", s.poor_count?.toLocaleString() || "—"],
                                  ] : []),
                                ].map(([lbl, val]) => (
                                  <div key={lbl}>
                                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 2 }}>{lbl}</div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.88)", fontFamily: lbl === "Trip ID" ? "var(--mono)" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lbl === "Trip ID" ? t.trip_id : undefined}>{val}</div>
                                  </div>
                                ))}
                              </div>
                              <div style={{ display: "flex", gap: 7 }}>
                                <button onClick={() => setMapTripId(t.trip_id)} className="trips-action-btn" style={{ background: "rgba(2,136,209,0.10)", color: "#0288d1", border: "1px solid rgba(2,136,209,0.25)" }}>Map</button>
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
          </>
        )}
      </div>

      {/* A hidden, keyboard-reachable input keeps the import usable without
          a drag: the visible card is gone, the capability is not. */}
      <label className="rs-sr-focusable">
        Import trip CSV
        <input type="file" accept=".csv" onChange={handleImportFile} disabled={importing} />
      </label>

      {mapTripId && createPortal(
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />,
        document.body
      )}
    </>
  );
}
