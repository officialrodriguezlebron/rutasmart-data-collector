import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import TripMap from "../TripMap";
import { dirLabel, phtDateStr, phtTimeStr } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataStatusBadge, DataProvenanceNotice,
  EmptyState, ErrorState, LoadingState, SkeletonMetrics,
  DataQualitySummary,
  LoadFactorByPeriod, DemandDistribution, TimeDistribution,
  useCorridorAnalytics, DEF, capacityStatus,
} from "../../components/admin";
import "../AdminDashboard.css";

/**
 * Demand and Load Factor.
 *
 * Every figure here is computed per GPS log record by
 * /analytics/merged/run-all, matching manuscript sections 3.10.3 to 3.10.5.
 *
 * What changed from the previous Corridor Analysis page
 * -----------------------------------------------------
 * It read /admin/aggregate, which bins whole trips, and then:
 *
 *   - the demand donut collapsed the manuscript's FOUR tiers into three,
 *     merging Critical into High and relabelling Normal and Moderate as
 *     "Low Demand" and "Medium Demand". The four-tier classification is a
 *     stated contribution of the study, so it is restored here.
 *   - "Trips by Time Period" counted trips, not GPS log records, so a
 *     40-minute trip and a 3-hour trip counted the same.
 *   - per-period load factor was averaged from per-trip means grouped by
 *     each trip's start hour, which cannot reproduce the manuscript's
 *     per-period figures.
 *   - "Signal Quality" reported GOOD only, with ACCEPTABLE folded into POOR.
 *
 * The per-trip table below is still trip-level, which is the right
 * granularity for a trip list, and is labelled as such.
 */

const DIRECTIONS = [
  { value: "ALL", label: "Both directions" },
  { value: "MALANDAY-RECTO", label: "Malanday to Recto" },
  { value: "RECTO-MALANDAY", label: "Recto to Malanday" },
];

const RANGES = [
  { value: "ALL", label: "All completed trips" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export default function AdminCorridors() {
  const [direction, setDirection] = useState("ALL");
  const [range, setRange] = useState("ALL");
  const [mapTripId, setMapTripId] = useState(null);

  const a = useCorridorAnalytics({ direction, range });

  const badges = (
    <>
      <DataStatusBadge tone="info" label="Route MR-001"
        title="The corridor is fixed to MR-001 in software." />
      <DataStatusBadge
        tone={a.activeCount > 0 ? "ok" : "default"}
        label={a.activeCount > 0
          ? `${a.activeCount} trip${a.activeCount === 1 ? "" : "s"} recording now`
          : "No trip recording now"}
        title="Active trips are excluded; analytics run after a trip completes." />
      {a.fetchedAt && (
        <DataStatusBadge tone="default"
          label={`Computed ${a.fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
          title="When this page last recomputed its figures." />
      )}
    </>
  );

  return (
    <>
      <AdminPageHeader
        title="Demand and Load Factor"
        subtitle="When does passenger load exceed seated capacity?"
        badges={badges}
        actions={
          <>
            <Link className="rs-btn" to="/admin/overview">Overview</Link>
            <Link className="rs-btn rs-btn--primary" to="/analytics?tab=demand">Analytics Engine</Link>
          </>
        }
      />

      <div className="rs-controls">
        <div className="rs-field">
          <label className="rs-field-label" htmlFor="dlf-dir">Direction</label>
          <select id="dlf-dir" className="rs-select" value={direction}
            onChange={(e) => setDirection(e.target.value)}>
            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div className="rs-field">
          <label className="rs-field-label" htmlFor="dlf-range">Data period</label>
          <select id="dlf-range" className="rs-select" value={range}
            onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="rs-field">
          <span className="rs-field-label">Selection</span>
          <span style={{ fontSize: 12.5, color: "var(--rs-text-2)", paddingBottom: 7 }}>
            {a.tripsLoading
              ? "Loading trips…"
              : `${a.sentTrips.length} of ${a.completed.length} completed trip${a.completed.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <button type="button" className="rs-btn" onClick={a.reload}
          disabled={a.loading || a.tripsLoading} style={{ marginLeft: "auto" }}>
          {a.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {a.data && (
        <DataProvenanceNotice
          trips={a.sourceTripCount ?? a.sentTrips.length}
          logs={a.totalLogs}
          days={a.collectionDays}
        />
      )}

      {a.tripsErr && <ErrorState title="Trip list unavailable" body={a.tripsErr} onRetry={a.reload} />}
      {a.error && <ErrorState title="Analytics unavailable" body={a.error} onRetry={a.reload} />}

      {!a.tripsErr && !a.tripsLoading && a.completed.length === 0 && (
        <EmptyState
          title="No completed trips yet"
          body="Demand and load factor are computed after a trip is completed."
          action={<Link className="rs-btn" to="/admin/trips">Open Trips</Link>}
        />
      )}

      {!a.tripsErr && a.completed.length > 0 && a.sentTrips.length === 0 && (
        <EmptyState
          title="No trips match these filters"
          body="Widen the data period or choose both directions."
          action={
            <button type="button" className="rs-btn"
              onClick={() => { setDirection("ALL"); setRange("ALL"); }}>
              Clear filters
            </button>
          }
        />
      )}

      {a.loading && !a.data && <SkeletonMetrics count={4} />}

      {a.data && (
        <>
          <div className="rs-metrics">
            <MetricCard
              label="Trips analysed"
              value={(a.sourceTripCount ?? a.sentTrips.length).toLocaleString()}
              sub={a.collectionDays ? `Across ${a.collectionDays} collection day${a.collectionDays === 1 ? "" : "s"} (PHT)` : "Completed trips only"}
              accent="var(--rs-fill-info)"
              definition={DEF.tripsAnalyzed}
            />
            {/* Load-factor cards use the capacity-status scale only:
                green below 90%, amber 90-100%, red above 100%. */}
            <MetricCard
              label="Mean load factor"
              value={a.overall?.avg_lf == null ? null : `${a.overall.avg_lf.toFixed(2)}%`}
              sub={`Across ${(a.totalLogs ?? 0).toLocaleString()} recorded observations`}
              accent={capacityStatus(a.overall?.avg_lf).fill}
              definition={DEF.loadFactor}
              unavailableNote="The analytics response carried no load factor."
            />
            <MetricCard
              label="Peak load factor"
              value={a.peak == null ? null : `${a.peak.pct.toFixed(2)}%`}
              sub={a.peak ? `${a.peak.name} · ${capacityStatus(a.peak.pct).label.toLowerCase()}` : undefined}
              accent={capacityStatus(a.peak?.pct).fill}
              definition={DEF.peakLoadFactor}
              unavailableNote="No period in this selection carried observations."
            />
            <MetricCard
              label="Above-capacity share"
              value={a.overCapacityPct == null ? null : `${a.overCapacityPct.toFixed(2)}%`}
              sub={`Observations above the ${a.capacity ?? 26}-seat capacity`}
              accent="var(--rs-fill-moderate)"
              definition={DEF.overCapacity}
              unavailableNote="The analytics response carried no demand distribution."
            />
          </div>

          {/* ── Status statement ────────────────────────────────────────
              One sentence naming the period that peaks and whether it is
              over the seats. Derived, never hard-coded. */}
          {a.peak && (
            <p className={`rs-status-line rs-status-line--${capacityStatus(a.peak.pct).key}`}
               role="status">
              <strong>{a.peak.name}</strong>{" "}
              {a.peak.pct > 100
                ? "is above seated capacity"
                : a.peak.pct >= 90
                  ? "is approaching seated capacity"
                  : "stays within seated capacity"}
              {" — "}
              <strong>{a.peak.pct.toFixed(2)}%</strong>.
            </p>
          )}

          <SectionHeader
            title="Capacity by operating period"
            note="Mean passenger load against seated capacity, per recorded observation (PHT)."
          />
          <div className="rs-panel">
            <LoadFactorByPeriod byPeriod={a.byPeriod} capacity={a.capacity} />
          </div>

          <SectionHeader
            title="Passenger demand levels"
            note="Share of GPS observations by passenger count"
          />
          <div className="rs-panel">
            <DemandDistribution distribution={a.demandDist} totalLogs={a.totalLogs} />
          </div>

          {/* ── Everything that supports the figures, out of the way ─────
              GPS quality, the collection schedule, the trip list and the
              method notes are all evidence for the two sections above
              rather than answers to the page's question. */}
          <details className="rs-details">
            <summary>More data details</summary>
            <div className="rs-details-body">
              <SectionHeader
                title="GPS quality"
                note="Positional accuracy of the observations. Not a demand measure."
              />
              <div className="rs-panel">
                <DataQualitySummary quality={a.quality} dbscan={a.dbscan} palette="neutral" />
              </div>

              <SectionHeader
                title="Records by operating period"
                note="When the data was collected — not how busy the corridor was."
              />
              <div className="rs-panel">
                <TimeDistribution distribution={a.timeDist} />
              </div>

              <SectionHeader title="Method definitions" />
              <div className="rs-panel">
                <dl className="rs-deflist">
                  <div><b>Load factor.</b> {DEF.loadFactor}</div>
                  <div><b>Demand levels.</b> {DEF.overCapacity}</div>
                  <div><b>GPS quality.</b> {DEF.qualityThreshold}</div>
                </dl>
              </div>

              {/* Per-trip table: trip-level by nature, and labelled so. */}
              <SectionHeader
                title="Supporting trips"
            note={`${a.sentTrips.length} trip${a.sentTrips.length === 1 ? "" : "s"}. Values below are trip-level records, not the per-record figures above.`}
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
                    <th scope="col">Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {a.sentTrips.map((t) => (
                    <tr key={t.trip_id}>
                      <td style={{ fontSize: 11, color: "var(--rs-text-3)" }}>{t.trip_id}</td>
                      <td>{phtDateStr(t.start_time)}</td>
                      <td>{phtTimeStr(t.start_time)}</td>
                      <td>{dirLabel(t.direction)}</td>
                      <td>{t.jeep_code || "—"}</td>
                      <td className="rs-num">{t.official_capacity ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" className="rs-btn"
                            style={{ padding: "4px 9px", fontSize: 11.5 }}
                            onClick={() => setMapTripId(t.trip_id)}>
                            Map
                          </button>
                          <Link className="rs-btn" style={{ padding: "4px 9px", fontSize: 11.5 }}
                            to={`/analytics?trip=${encodeURIComponent(t.trip_id)}`}>
                            Details
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

              <p className="rs-details-foot">
                Descriptive only: these are recorded figures for the selected window, not
                forecasts or operational recommendations.
              </p>
            </div>
          </details>
        </>
      )}

      {a.loading && a.data && (
        <div style={{ marginTop: 16 }}>
          <LoadingState label="Recomputing for the new selection" />
        </div>
      )}

      {mapTripId && createPortal(
        <TripMap tripId={mapTripId} onClose={() => setMapTripId(null)} />,
        document.body,
      )}
    </>
  );
}
