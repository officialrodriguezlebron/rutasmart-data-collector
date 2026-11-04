import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { getAdminTrips, exportTrip } from "../../services/api";
import { dirLabel, phtDateStr, phtTimeStr } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, EmptyState, ErrorState, LoadingState,
} from "../../components/admin";
import "../AdminDashboard.css";

/**
 * Export Data — per-trip CSV download.
 *
 * This is the export path the manuscript documents in section 3.2.1: the
 * administrator exports the backend-processed record for a trip through
 * GET /trip/export/{trip_id}, which includes the GPS quality flag and the
 * over-capacity flag on every row.
 *
 * There is no corridor-wide CSV endpoint, so this page does not offer one.
 * Exporting every trip in one file would need new backend work and is
 * recorded as a gap rather than faked by stitching responses together in
 * the browser.
 */
export default function AdminExport() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [direction, setDirection] = useState("ALL");

  // Bumping this re-runs the fetch. The effect only ever calls setState from
  // an async callback, which keeps it out of the render path.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    // Safe here: this runs from a click, not from an effect body.
    setError(null);
    setLoading(true);
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminTrips()
      .then((r) => { if (!cancelled) setTrips(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setError("Could not reach the backend to load the trip list."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const rows = useMemo(() => {
    const completed = trips.filter((t) => t.status === "COMPLETED");
    return direction === "ALL"
      ? completed
      : completed.filter((t) => t.direction === direction);
  }, [trips, direction]);

  const download = (tripId) => {
    setBusy(tripId);
    exportTrip(tripId)
      .then((r) => {
        const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tripId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(() => window.alert("Export failed. The trip may no longer be available."))
      .finally(() => setBusy(null));
  };

  return (
    <div>
      <AdminPageHeader
        title="Export Data"
        subtitle={
          "Download the backend-processed record for a completed trip as CSV. Each row " +
          "carries its GPS quality flag and over-capacity flag, so the exported file " +
          "matches what the analytics were computed from."
        }
        actions={<Link className="rs-btn" to="/admin/overview">Corridor Overview</Link>}
      />

      <div className="rs-controls">
        <div className="rs-field">
          <label className="rs-field-label" htmlFor="ex-dir">Direction</label>
          <select
            id="ex-dir"
            className="rs-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="ALL">Both directions</option>
            <option value="MALANDAY-RECTO">Malanday to Recto</option>
            <option value="RECTO-MALANDAY">Recto to Malanday</option>
          </select>
        </div>
        <div className="rs-field">
          <span className="rs-field-label">Available</span>
          <span style={{ fontSize: 12.5, color: "var(--rs-text-2)", paddingBottom: 7 }}>
            {loading ? "Loading…" : `${rows.length} completed trip${rows.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <button
          type="button"
          className="rs-btn"
          onClick={reload}
          disabled={loading}
          style={{ marginLeft: "auto" }}
        >
          Refresh
        </button>
      </div>

      {error && <ErrorState title="Trip list unavailable" body={error} onRetry={reload} />}
      {loading && !error && <LoadingState label="Loading completed trips" />}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nothing to export yet"
          body={
            "Only completed trips can be exported. Once a conductor finishes a recording, " +
            "it will appear here."
          }
          action={<Link className="rs-btn" to="/admin/trips">Open Trips</Link>}
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <SectionHeader
            title="Completed trips"
            note="One CSV per trip, via GET /trip/export/{trip_id}"
          />
          <div className="rs-panel rs-panel--flush">
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Date (PHT)</th>
                    <th scope="col">Start</th>
                    <th scope="col">Direction</th>
                    <th scope="col">Jeep</th>
                    <th scope="col" className="rs-num">Capacity</th>
                    <th scope="col">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.trip_id}>
                      <td style={{ fontSize: 11, color: "var(--rs-text-3)" }}>{t.trip_id}</td>
                      <td>{phtDateStr(t.start_time)}</td>
                      <td>{phtTimeStr(t.start_time)}</td>
                      <td>{dirLabel(t.direction)}</td>
                      <td>{t.jeep_code || "—"}</td>
                      <td className="rs-num">{t.official_capacity ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="rs-btn rs-btn--primary"
                          style={{ padding: "4px 10px", fontSize: 11.5 }}
                          onClick={() => download(t.trip_id)}
                          disabled={busy === t.trip_id}
                        >
                          {busy === t.trip_id ? "Exporting…" : "CSV"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <dl className="rs-deflist" style={{ marginTop: 16, maxWidth: "80ch" }}>
            <div>
              <b>Corridor-wide export.</b> Not available in the current API. There is no
              endpoint that returns every trip in one file, so this page exports per trip
              only. A combined export would require new backend work.
            </div>
            <div>
              <b>Analytical exports.</b> Cluster, demand, load factor and evaluation
              tables are produced by the Analytics Engine rather than this page.
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
