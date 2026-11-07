import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import TripMap from "../TripMap";
import { dirLabel, phtDateStr, phtTimeStr } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataStatusBadge, DataProvenanceNotice,
  EmptyState, ErrorState, LoadingState, SkeletonMetrics,
  DemandTierLegend, DataQualitySummary,
  LoadFactorByPeriod, DemandDistribution, TimeDistribution,
  useCorridorAnalytics, DEF,
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
        subtitle={
          "Demand intensity and capacity utilisation on the Malanday to Recto corridor. " +
          "Every figure is computed per GPS log record across the trips you select, then " +
          "aggregated. These describe what was recorded; they are not projections."
        }
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
            <MetricCard
              label="Mean load factor"
              value={a.overall?.avg_lf == null ? null : `${a.overall.avg_lf.toFixed(1)}%`}
              sub={`Across ${(a.totalLogs ?? 0).toLocaleString()} GPS log records`}
              accent={a.overall?.avg_lf > 100 ? "var(--rs-fill-critical)" : "var(--rs-fill-normal)"}
              definition={DEF.loadFactor}
              unavailableNote="The analytics response carried no load factor."
            />
            <MetricCard
              label="Peak load factor"
              value={a.peak == null ? null : `${a.peak.pct.toFixed(1)}%`}
              sub={a.peak ? `${a.peak.name} — ${a.peak.pct > 100 ? "over seated capacity" : "within seated capacity"}` : undefined}
              accent={a.peak && a.peak.pct > 100 ? "var(--rs-fill-critical)" : "var(--rs-fill-moderate)"}
              definition={DEF.peakLoadFactor}
              unavailableNote="No period in this selection carried GPS log records."
            />
            <MetricCard
              label="Over-capacity share"
              value={a.overCapacityPct == null ? null : `${a.overCapacityPct.toFixed(2)}%`}
              sub="Records above seated capacity (Moderate, High, Critical)"
              accent="var(--rs-fill-high)"
              definition={DEF.overCapacity}
              unavailableNote="The analytics response carried no demand distribution."
            />
          </div>

          <SectionHeader
            title="Load factor by operating period"
            note={`Per GPS log record, binned to PHT. The vertical line marks 100% of seated capacity.`}
          />
          <div className="rs-panel">
            <LoadFactorByPeriod byPeriod={a.byPeriod} capacity={a.capacity} />
          </div>

          <div className="rs-grid-2" style={{ marginTop: 12 }}>
            <div>
              <SectionHeader
                title="Demand intensity distribution"
                note={a.totalLogs ? `Four tiers, per GPS log record` : undefined}
              />
              <div className="rs-panel">
                <DemandDistribution distribution={a.demandDist} totalLogs={a.totalLogs} />
                <DemandTierLegend capacity={a.capacity} />
              </div>
            </div>

            <div>
              <SectionHeader
                title="Records by operating period"
                note="Share of GPS log records, not trips"
              />
              <div className="rs-panel">
                <TimeDistribution distribution={a.timeDist} />
              </div>
            </div>
          </div>

          <SectionHeader
            title="Data quality for these figures"
            note="Three-way GPS accuracy classification"
          />
          <div className="rs-panel">
            <DataQualitySummary quality={a.quality} dbscan={a.dbscan} />
          </div>

          {/* ── Per-trip table: trip-level by nature, and labelled so ─────── */}
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

          <p style={{
            margin: "18px 0 8px", fontSize: 11.5, lineHeight: 1.6,
            color: "var(--rs-text-3)", maxWidth: "85ch",
          }}>
            This page is descriptive. It reports demand and capacity utilisation as
            recorded over the selected window and does not forecast demand, optimise
            routes, or recommend operational changes.
          </p>
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
