import { useState } from "react";
import { Link } from "react-router-dom";
import StopZonePublishPreview from "../../components/StopZonePublishPreview";
import { dirLabel, phtDateStr, phtTimeStr, DEMAND_COLOR, PERIOD_COLOR } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataStatusBadge, DataProvenanceNotice,
  EmptyState, ErrorState, SkeletonMetrics,
  DemandTierLegend, DataQualitySummary,
  useCorridorAnalytics, DEF, clusterActivityLabel,
} from "../../components/admin";
import "../AdminDashboard.css";

/**
 * Stop Zones.
 *
 * Previously this page listed trips and their GOOD-only signal quality, and
 * described the system as one that "recommends stop zones for transport
 * planners". It never showed the detected clusters themselves, which is the
 * evidence a stop zone is published from.
 *
 * It now shows the DBSCAN clusters returned by /analytics/merged/run-all,
 * with the point count, mean and peak occupancy, load factor, demand tier
 * and busiest period behind each one, plus the velocity post-classification
 * (TRUE_STOP, CREEPING_QUEUE, MOVING) that separates genuine stops from
 * congestion.
 *
 * Wording is descriptive. The study does not optimise routes or prescribe
 * stop changes (delimitations 2 and 11), so clusters are reported by
 * recorded activity and the reader decides what to do about them.
 *
 * Publishing still runs through StopZonePublishPreview, unchanged. An
 * unreachable duplicate handlePublish() that no control called has been
 * removed; it was dead code and two of the file's ESLint errors.
 */

const DIRECTIONS = [
  { value: "ALL", label: "Both directions" },
  { value: "MALANDAY-RECTO", label: "Malanday to Recto" },
  { value: "RECTO-MALANDAY", label: "Recto to Malanday" },
];

export default function AdminStopZones() {
  const [direction, setDirection] = useState("ALL");
  const [showPreview, setShowPreview] = useState(false);
  const [published, setPublished] = useState(null);

  const a = useCorridorAnalytics({ direction, range: "ALL" });

  const trueStops = a.rankedClusters.filter((c) => c.cluster_type === "TRUE_STOP").length;
  const queues = a.rankedClusters.filter((c) => c.cluster_type === "CREEPING_QUEUE").length;

  return (
    <div>
      <AdminPageHeader
        title="Stop Zones"
        subtitle={
          "Boarding and alighting clusters detected from recorded GPS data, with the " +
          "evidence behind each one. Publishing makes the selected zones visible on the " +
          "public passenger map."
        }
        badges={
          <>
            <DataStatusBadge tone="info" label="Route MR-001" />
            {a.dbscan && (
              <DataStatusBadge
                tone="default"
                label={`eps ${a.dbscan.eps_m} m · minPts ${a.dbscan.min_samples}`}
                title="DBSCAN parameters used for this detection run." />
            )}
          </>
        }
        actions={
          <>
            <Link className="rs-btn" to="/admin/map">Live Map</Link>
            <button
              type="button"
              className="rs-btn rs-btn--primary"
              onClick={() => setShowPreview(true)}
              disabled={a.tripsLoading || a.completed.length === 0}
            >
              Review and publish
            </button>
          </>
        }
      />

      <div className="rs-controls">
        <div className="rs-field">
          <label className="rs-field-label" htmlFor="sz-dir">Direction</label>
          <select id="sz-dir" className="rs-select" value={direction}
            onChange={(e) => setDirection(e.target.value)}>
            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div className="rs-field">
          <span className="rs-field-label">Selection</span>
          <span style={{ fontSize: 12.5, color: "var(--rs-text-2)", paddingBottom: 7 }}>
            {a.tripsLoading
              ? "Loading trips…"
              : `${a.sentTrips.length} completed trip${a.sentTrips.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <button type="button" className="rs-btn" onClick={a.reload}
          disabled={a.loading || a.tripsLoading} style={{ marginLeft: "auto" }}>
          {a.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {published && (
        <div className="rs-provenance" role="status"
          style={{ borderLeftColor: "var(--rs-fill-normal)", background: "rgba(48,209,88,0.07)", borderColor: "rgba(48,209,88,0.34)" }}>
          <div className="rs-provenance-body">{published}</div>
        </div>
      )}

      {a.data && (
        <DataProvenanceNotice
          trips={a.sourceTripCount ?? a.sentTrips.length}
          logs={a.totalLogs}
          days={a.collectionDays}
        />
      )}

      {a.tripsErr && <ErrorState title="Trip list unavailable" body={a.tripsErr} onRetry={a.reload} />}
      {a.error && <ErrorState title="Cluster detection unavailable" body={a.error} onRetry={a.reload} />}

      {!a.tripsErr && !a.tripsLoading && a.completed.length === 0 && (
        <EmptyState
          title="No completed trips yet"
          body="Stop detection runs over completed trips. Once a recording finishes, detected clusters appear here."
          action={<Link className="rs-btn" to="/admin/trips">Open Trips</Link>}
        />
      )}

      {a.loading && !a.data && <SkeletonMetrics count={4} />}

      {a.data && (
        <>
          <div className="rs-metrics">
            <MetricCard
              label="Clusters detected"
              value={a.rankedClusters.length.toLocaleString()}
              sub={`From ${(a.dbscan?.dbscan_input ?? 0).toLocaleString()} clustered records`}
              accent="var(--rs-fill-info)"
              definition={DEF.clusterActivity}
            />
            <MetricCard
              label="Classified true stop"
              value={trueStops.toLocaleString()}
              sub={queues > 0 ? `${queues} classified as creeping queue` : "By intra-cluster velocity"}
              accent="var(--rs-fill-normal)"
              definition={
                "After clustering, each cluster is post-classified by the velocity of its " +
                "readings as TRUE_STOP, CREEPING_QUEUE or MOVING. This separates genuine " +
                "passenger stops from vehicles held in traffic."
              }
            />
            <MetricCard
              label="Records clustered"
              value={(a.dbscan?.dbscan_input ?? 0).toLocaleString()}
              sub={`${(a.dbscan?.moving_excluded ?? 0).toLocaleString()} gated out as moving`}
              definition={
                "GPS log records that reached the clustering stage. Poor-accuracy records " +
                "are excluded from spatial input, and readings taken while the vehicle was " +
                "moving are gated out before clustering."
              }
            />
            <MetricCard
              label="Met quality threshold"
              value={a.thresholdPct == null ? null : `${a.thresholdPct.toFixed(2)}%`}
              sub="Good plus Acceptable accuracy"
              accent="var(--rs-fill-normal)"
              definition={DEF.qualityThreshold}
              unavailableNote="The analytics response carried no quality summary."
            />
          </div>

          <SectionHeader
            title="Detected clusters"
            note={
              a.rankedClusters.length
                ? "Ranked by recorded activity in this dataset. Rank is not a service recommendation."
                : undefined
            }
          />

          {a.rankedClusters.length === 0 ? (
            <EmptyState
              title="No clusters met the detection threshold"
              body={
                "DBSCAN found no cluster with at least minPts records in this selection. " +
                "This happens when too few records remain after Poor-accuracy records and " +
                "moving readings are excluded from spatial input. Data requires further inspection."
              }
            />
          ) : (
            <div className="rs-panel rs-panel--flush">
              <div className="rs-tablewrap">
                <table className="rs-table">
                  <thead>
                    <tr>
                      <th scope="col" className="rs-rank">#</th>
                      <th scope="col">Cluster</th>
                      <th scope="col" className="rs-num">Records</th>
                      <th scope="col" className="rs-num">Mean occ.</th>
                      <th scope="col" className="rs-num">Peak occ.</th>
                      <th scope="col" className="rs-num">Load factor</th>
                      <th scope="col">Tier</th>
                      <th scope="col">Busiest period</th>
                      <th scope="col">Classification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.rankedClusters.map((c, i) => (
                      <tr key={c.cluster_id}>
                        <td className="rs-rank">{i + 1}</td>
                        <td>
                          <span style={{ color: "var(--rs-text)" }}>Cluster {c.cluster_id}</span>
                          <br />
                          <span style={{ fontSize: 10.5, color: "var(--rs-text-3)" }}>
                            {c.centroid_lat.toFixed(5)}, {c.centroid_lon.toFixed(5)}
                          </span>
                        </td>
                        <td className="rs-num">{c.point_count.toLocaleString()}</td>
                        <td className="rs-num">{c.avg_occupancy.toFixed(1)}</td>
                        <td className="rs-num">{c.max_occupancy}</td>
                        <td className="rs-num"
                          style={c.load_factor_pct > 100 ? { color: "var(--rs-on-critical)" } : undefined}>
                          {c.load_factor_pct.toFixed(1)}%
                        </td>
                        <td>
                          <span className="rs-pill" style={{
                            background: `${DEMAND_COLOR[c.demand_tier] || "#8e9ab0"}26`,
                            color: DEMAND_COLOR[c.demand_tier] || "#8e9ab0",
                          }}>{c.demand_tier}</span>
                        </td>
                        <td style={{ color: PERIOD_COLOR[c.peak_period] || "var(--rs-text-2)" }}>
                          {c.peak_period}
                        </td>
                        <td>
                          <span style={{ fontSize: 11, color: "var(--rs-text-2)" }}>
                            {c.cluster_type === "TRUE_STOP" ? "True stop"
                              : c.cluster_type === "CREEPING_QUEUE" ? "Creeping queue"
                                : "Moving"}
                          </span>
                          <br />
                          <span style={{ fontSize: 10.5, color: "var(--rs-text-3)" }}>
                            {clusterActivityLabel(c.demand_tier)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--rs-border)" }}>
                <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--rs-text-3)" }}>
                  <b style={{ color: "var(--rs-text-2)" }}>Next steps for review.</b>{" "}
                  Compare these centroids against ground-truth stops on the Evaluation
                  page, and review the supporting trips for any cluster whose coverage
                  across collection days looks thin.
                </div>
              </div>
            </div>
          )}

          <SectionHeader title="Demand tiers in these clusters" />
          <div className="rs-panel">
            <DemandTierLegend capacity={a.capacity} />
          </div>

          <SectionHeader
            title="Data quality behind detection"
            note="Three-way GPS accuracy classification"
          />
          <div className="rs-panel">
            <DataQualitySummary quality={a.quality} dbscan={a.dbscan} />
          </div>

          <SectionHeader
            title="Supporting trips"
            note={`${a.sentTrips.length} trip${a.sentTrips.length === 1 ? "" : "s"}. Trip-level records.`}
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
            Cluster detection is descriptive. It reports where recorded activity
            concentrated on this corridor over the selected window. It does not
            recommend formalising, consolidating or relocating any stop.
          </p>
        </>
      )}

      {showPreview && (
        <StopZonePublishPreview
          routeId="MR-001"
          onClose={() => setShowPreview(false)}
          onSuccess={() => setPublished("Stop zones published. The public passenger map now reflects the current detection.")}
        />
      )}
    </div>
  );
}
