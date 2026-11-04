import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { getAdminTrips, runMergedAll, exportTrip, MERGED_TRIP_LIMIT } from "../../services/api";
import { TILE_URL, TILE_ATTRIBUTION, TILE_MAX_ZOOM } from "../../config/basemap";
import { CORRIDOR, RETURN_CORRIDOR } from "../../data/corridor";
import { dirLabel, phtDateStr, phtTimeStr, DEMAND_COLOR, PERIOD_COLOR } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataStatusBadge, DataProvenanceNotice,
  EmptyState, UnavailableState, ErrorState,
  LoadingState, SkeletonMetrics,
  DemandTierLegend, DataQualitySummary,
  DEF, PERIOD_ORDER, TIER_ORDER,
} from "../../components/admin";
import "../AdminDashboard.css";

/**
 * Corridor Overview — the inspector and planner landing page.
 *
 * What this page answers, in order:
 *   1. What is the current demand situation?        demand tier distribution
 *   2. When does demand exceed capacity?            load factor by period
 *   3. Where are the priority stop clusters?        ranked clusters + map
 *   4. How reliable is the data?                    three-way GPS quality
 *   5. What should be inspected next?               trip evidence table
 *
 * Data source
 * -----------
 * Everything analytical comes from GET /analytics/merged/run-all, which
 * computes each figure PER GPS LOG RECORD across the selected trips. That is
 * the method the manuscript describes in sections 3.10.3 to 3.10.5.
 *
 * This page deliberately does NOT read /admin/aggregate for its headline
 * figures. That endpoint bins whole trips: one operating period taken from
 * the trip's start hour, one demand tier taken from the trip's maximum
 * occupancy, and a load factor that is an unweighted mean of per-trip means.
 * Its distributions are therefore trip counts, not record counts, and cannot
 * be read against the manuscript's tables. /admin/trips is still used, but
 * only for the trip list, the filters and the evidence table, where
 * trip-level values are what is wanted and are labelled as such.
 *
 * Boundaries
 * ----------
 * Descriptive only. Nothing here forecasts, optimises, ranks by projected
 * benefit, or recommends an operational action. Cluster rank means recorded
 * activity in the selected data and says so on screen.
 */

// Leaflet's default marker icon is never used here; CircleMarker only.
delete L.Icon.Default.prototype._getIconUrl;

const ROUTE_ID = "MR-001";

const DIRECTIONS = [
  { value: "ALL", label: "Both directions" },
  { value: "MALANDAY-RECTO", label: "Malanday to Recto" },
  { value: "RECTO-MALANDAY", label: "Recto to Malanday" },
];

const RANGES = [
  { value: "ALL", label: "All completed trips", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
];

/** PHT calendar day for a trip, matching phtDateStr. */
function phtDayKey(utcStr) {
  return phtDateStr(utcStr);
}

/** Fits the map to the clusters once they load. */
function BoundsFitter({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.centroid_lat, p.centroid_lon])), {
      padding: [36, 36],
    });
  }, [points, map]);
  return null;
}

/** Horizontal bar with a reference line at 100% of seated capacity. */
function LoadFactorBar({ name, pct, logCount, max }) {
  const over = pct > 100;
  const scale = Math.max(max, 110);
  return (
    <div className="rs-bar-row">
      <span className="rs-bar-name">{name}</span>
      <div className="rs-bar-track">
        <div
          className="rs-bar-fill"
          style={{
            width: `${Math.min((pct / scale) * 100, 100)}%`,
            background: over ? "var(--rs-fill-critical)" : "var(--rs-fill-info)",
          }}
        />
        <span
          className="rs-bar-ref"
          style={{ left: `${(100 / scale) * 100}%` }}
          title="100% of seated capacity"
          aria-hidden="true"
        />
      </div>
      <span className="rs-bar-val" style={over ? { color: "var(--rs-on-critical)" } : undefined}>
        {pct.toFixed(1)}%
        <span className="rs-sr">
          {over ? ", over seated capacity" : ""}, from {logCount} GPS log records
        </span>
      </span>
    </div>
  );
}

export default function AdminOverview() {
  const [trips, setTrips] = useState([]);
  const [tripsErr, setTripsErr] = useState(null);
  const [tripsLoading, setTripsLoading] = useState(true);

  const [direction, setDirection] = useState("ALL");
  const [range, setRange] = useState("ALL");

  const [data, setData] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [exporting, setExporting] = useState(null);

  // Bumping this re-runs both fetches. Reading the clock is also pinned here
  // rather than inside a memo, so the relative date filter stays a pure
  // function of state instead of calling Date.now() during render.
  const [reloadToken, setReloadToken] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const reload = useCallback(() => {
    // Safe here: this runs from a click, not from an effect body.
    setTripsErr(null);
    setTripsLoading(true);
    setError(null);
    setLoadedFor(null);   // so the derived loading flag shows progress again
    setNowMs(Date.now());
    setReloadToken((n) => n + 1);
  }, []);

  // ── Trip list: filters, evidence table and freshness all derive from it ──
  useEffect(() => {
    let cancelled = false;
    getAdminTrips()
      .then((r) => { if (!cancelled) setTrips(Array.isArray(r.data) ? r.data : []); })
      .catch((e) => {
        if (cancelled) return;
        setTripsErr(e?.response?.status === 403
          ? "This account is not authorised to read the trip list."
          : "Could not reach the backend to load the trip list.");
      })
      .finally(() => { if (!cancelled) setTripsLoading(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const completed = useMemo(
    () => trips.filter((t) => t.status === "COMPLETED"),
    [trips],
  );

  const activeCount = useMemo(
    () => trips.filter((t) => t.status === "ACTIVE").length,
    [trips],
  );

  /** Completed trips matching the current filters, newest first. */
  const selected = useMemo(() => {
    const cfg = RANGES.find((r) => r.value === range);
    let out = completed;

    if (direction !== "ALL") out = out.filter((t) => t.direction === direction);

    if (cfg?.days) {
      const cutoff = nowMs - cfg.days * 86400000;
      out = out.filter((t) => {
        const ms = Date.parse(t.start_time + (t.start_time?.endsWith("Z") ? "" : "Z"));
        return Number.isFinite(ms) && ms >= cutoff;
      });
    }
    return out;
  }, [completed, direction, range, nowMs]);

  /** The merged call is capped server-side, so send the newest N. */
  const sentTrips = useMemo(() => selected.slice(0, MERGED_TRIP_LIMIT), [selected]);
  const truncated = selected.length > sentTrips.length;

  // ── Analytics: the manuscript-faithful per-record aggregation ────────────
  // The trip id list is the dependency, so changing a filter recomputes.
  // `loadedFor` records which selection the current result belongs to, which
  // lets the loading flag be derived rather than set from inside the effect.
  const sentIds = useMemo(() => sentTrips.map((t) => t.trip_id).join(","), [sentTrips]);

  useEffect(() => {
    if (!sentIds) return;
    let cancelled = false;
    runMergedAll(sentIds.split(","))
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setError(null);
        setFetchedAt(new Date());
        setLoadedFor(sentIds);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(
          e?.response?.status === 404
            ? "No GPS log records were found for the selected trips."
            : e?.response?.status === 403
              ? "This account is not authorised to run corridor analytics."
              : "Analytics could not be computed for this selection.",
        );
        setLoadedFor(sentIds);
      });
    return () => { cancelled = true; };
  }, [sentIds, reloadToken]);

  /** True while the current selection has no result yet. */
  const loading = Boolean(sentIds) && loadedFor !== sentIds;

  /** The result on screen only counts if it belongs to this selection. */
  const fresh = loadedFor === sentIds ? data : null;

  // ── Derived figures ─────────────────────────────────────────────────────
  const quality = fresh?.gps_quality ?? null;
  const dbscan = fresh?.dbscan ?? null;
  const demandDist = fresh?.demand?.distribution ?? null;
  const timeDist = fresh?.time_dist?.distribution ?? null;
  const byPeriod = fresh?.load_factor?.by_period ?? null;
  const capacity = fresh?.load_factor?.official_capacity ?? null;

  const collectionDays = useMemo(() => {
    const days = new Set(sentTrips.map((t) => phtDayKey(t.start_time)).filter((d) => d !== "—"));
    return days.size || null;
  }, [sentTrips]);

  /** Peak load factor: highest per-period mean, with its period. */
  const peak = useMemo(() => {
    if (!byPeriod) return null;
    let best = null;
    for (const name of PERIOD_ORDER) {
      const p = byPeriod[name];
      if (!p || !p.log_count) continue;
      if (!best || p.avg_lf > best.pct) best = { name, pct: p.avg_lf, logCount: p.log_count };
    }
    return best;
  }, [byPeriod]);

  /** Over-capacity share: Moderate + High + Critical, per record. */
  const overCapacityPct = useMemo(() => {
    if (!demandDist) return null;
    const over = ["Moderate", "High", "Critical"]
      .reduce((s, t) => s + (demandDist[t]?.pct ?? 0), 0);
    return Math.round(over * 100) / 100;
  }, [demandDist]);

  const thresholdPct = useMemo(() => {
    if (!quality || !quality.total_logs) return null;
    return ((quality.good_count + quality.acceptable_count) / quality.total_logs) * 100;
  }, [quality]);

  const maxPeriodLf = useMemo(() => {
    if (!byPeriod) return 110;
    return Math.max(110, ...PERIOD_ORDER.map((n) => byPeriod[n]?.avg_lf ?? 0));
  }, [byPeriod]);

  /** Clusters ranked by recorded activity. Descriptive ordering only. */
  const rankedClusters = useMemo(() => {
    if (!dbscan?.clusters) return [];
    return [...dbscan.clusters].sort((a, b) => b.point_count - a.point_count);
  }, [dbscan]);

  const newestTrip = sentTrips[0] ?? null;

  const handleExport = (tripId) => {
    setExporting(tripId);
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
      .finally(() => setExporting(null));
  };

  // ── Header badges: freshness and provenance ─────────────────────────────
  const badges = (
    <>
      <DataStatusBadge
        tone="info"
        label={`Route ${ROUTE_ID}`}
        title="The corridor is fixed to MR-001 in software."
      />
      <DataStatusBadge
        tone={activeCount > 0 ? "ok" : "default"}
        label={activeCount > 0
          ? `${activeCount} trip${activeCount === 1 ? "" : "s"} recording now`
          : "No trip recording now"}
        title="Active trips are excluded from analytics; figures are computed after a trip completes."
      />
      {newestTrip && (
        <DataStatusBadge
          tone="default"
          label={`Latest record ${phtDateStr(newestTrip.start_time)} ${phtTimeStr(newestTrip.start_time)} PHT`}
          title="Start time of the most recent completed trip in this selection."
        />
      )}
      {fetchedAt && (
        <DataStatusBadge
          tone="default"
          label={`Computed ${fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
          title="When this page last recomputed its figures."
        />
      )}
    </>
  );

  return (
    <div>
      <AdminPageHeader
        title="Corridor Overview"
        subtitle={
          "Recorded utilisation of the Malanday to Recto corridor. Every analytical figure " +
          "on this page is computed per GPS log record across the trips you select, then " +
          "aggregated. These are measurements of what was recorded, not projections."
        }
        badges={badges}
        actions={
          <>
            <Link className="rs-btn" to="/admin/trips">Trips</Link>
            <Link className="rs-btn rs-btn--primary" to="/analytics">Analytics Engine</Link>
          </>
        }
      />

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="rs-controls">
        <div className="rs-field">
          <label className="rs-field-label" htmlFor="ov-route">Route</label>
          <select id="ov-route" className="rs-select" value={ROUTE_ID} disabled>
            <option value={ROUTE_ID}>{ROUTE_ID} — Malanday to Recto</option>
          </select>
        </div>

        <div className="rs-field">
          <label className="rs-field-label" htmlFor="ov-dir">Direction</label>
          <select
            id="ov-dir"
            className="rs-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <div className="rs-field">
          <label className="rs-field-label" htmlFor="ov-range">Data period</label>
          <select
            id="ov-range"
            className="rs-select"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="rs-field">
          <span className="rs-field-label">Selection</span>
          <span style={{ fontSize: 12.5, color: "var(--rs-text-2)", paddingBottom: 7 }}>
            {tripsLoading
              ? "Loading trips…"
              : `${sentTrips.length} of ${completed.length} completed trip${completed.length === 1 ? "" : "s"}`}
            {truncated && ` (capped at ${MERGED_TRIP_LIMIT})`}
          </span>
        </div>

        <button
          type="button"
          className="rs-btn"
          onClick={reload}
          disabled={loading || tripsLoading}
          style={{ marginLeft: "auto" }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {truncated && (
        <div className="rs-provenance" role="note" style={{ borderLeftColor: "var(--rs-fill-info)" }}>
          <div className="rs-provenance-body">
            <strong>Selection capped.</strong> {selected.length} trips match these filters, but the
            analytics endpoint accepts {MERGED_TRIP_LIMIT} per call, so the {MERGED_TRIP_LIMIT} most
            recent are included. Narrow the data period or direction to analyse a specific window.
          </div>
        </div>
      )}

      {/* Provenance: never let local sample data read as official results. */}
      {fresh && (
        <DataProvenanceNotice
          trips={fresh.source_trips?.length ?? sentTrips.length}
          logs={fresh.total_logs ?? quality?.total_logs ?? null}
          days={collectionDays}
        />
      )}

      {tripsErr && (
        <ErrorState title="Trip list unavailable" body={tripsErr} onRetry={reload} />
      )}

      {!tripsErr && !tripsLoading && completed.length === 0 && (
        <EmptyState
          title="No completed trips yet"
          body={
            "Analytics are computed after a trip is completed. Once a conductor finishes a " +
            "recording, demand, load factor, timing and stop clusters will appear here."
          }
          action={<Link className="rs-btn" to="/admin/trips">Open Trips</Link>}
        />
      )}

      {!tripsErr && completed.length > 0 && sentTrips.length === 0 && (
        <EmptyState
          title="No trips match these filters"
          body="Widen the data period or choose both directions to include more recorded trips."
          action={
            <button type="button" className="rs-btn" onClick={() => { setDirection("ALL"); setRange("ALL"); }}>
              Clear filters
            </button>
          }
        />
      )}

      {error && (
        <ErrorState title="Analytics unavailable" body={error} onRetry={reload} />
      )}

      {loading && !fresh && <SkeletonMetrics count={5} />}

      {/* ── Key metrics ──────────────────────────────────────────────────── */}
      {fresh && (
        <>
          <div className="rs-metrics">
            <MetricCard
              label="Trips analysed"
              value={(fresh.source_trips?.length ?? sentTrips.length).toLocaleString()}
              sub={collectionDays ? `Across ${collectionDays} collection day${collectionDays === 1 ? "" : "s"} (PHT)` : "Completed trips only"}
              accent="var(--rs-fill-info)"
              definition={DEF.tripsAnalyzed}
            />
            <MetricCard
              label="GPS log records"
              value={(fresh.total_logs ?? 0).toLocaleString()}
              sub="One position and occupancy sample each, about every 3 s"
              definition={DEF.gpsLogs}
            />
            <MetricCard
              label="Met quality threshold"
              value={thresholdPct == null ? null : `${thresholdPct.toFixed(2)}%`}
              sub="Good plus Acceptable accuracy"
              accent="var(--rs-fill-normal)"
              definition={DEF.qualityThreshold}
              unavailableNote="The analytics response carried no quality summary."
            />
            <MetricCard
              label="Peak load factor"
              value={peak == null ? null : `${peak.pct.toFixed(1)}%`}
              sub={peak ? `${peak.name} — ${peak.pct > 100 ? "over seated capacity" : "within seated capacity"}` : undefined}
              accent={peak && peak.pct > 100 ? "var(--rs-fill-critical)" : "var(--rs-fill-moderate)"}
              definition={DEF.peakLoadFactor}
              unavailableNote="No period in this selection carried GPS log records."
            />
            <MetricCard
              label="Over-capacity share"
              value={overCapacityPct == null ? null : `${overCapacityPct.toFixed(2)}%`}
              sub="Records above seated capacity (Moderate, High, Critical)"
              accent="var(--rs-fill-high)"
              definition={DEF.overCapacity}
              unavailableNote="The analytics response carried no demand distribution."
            />
          </div>

          {/* ── When does demand exceed capacity? ──────────────────────────── */}
          <SectionHeader
            title="Load factor by operating period"
            note={
              byPeriod
                ? `Per GPS log record, binned to PHT. Capacity C = ${capacity ?? "—"} seats. The vertical line marks 100%.`
                : undefined
            }
          />
          <div className="rs-panel">
            {!byPeriod ? (
              <UnavailableState reason="The analytics response carried no per-period load factor." />
            ) : (
              <>
                <div className="rs-bars">
                  {PERIOD_ORDER.map((name) => {
                    const p = byPeriod[name];
                    if (!p || !p.log_count) {
                      return (
                        <div className="rs-bar-row" key={name}>
                          <span className="rs-bar-name">{name}</span>
                          <div className="rs-bar-track" />
                          <span className="rs-bar-val" style={{ fontSize: 11, fontWeight: 500, color: "var(--rs-text-3)" }}>
                            No records
                          </span>
                        </div>
                      );
                    }
                    return (
                      <LoadFactorBar
                        key={name}
                        name={name}
                        pct={p.avg_lf}
                        logCount={p.log_count}
                        max={maxPeriodLf}
                      />
                    );
                  })}
                </div>
                <dl className="rs-deflist">
                  <div><b>Load factor.</b> {DEF.loadFactor}</div>
                </dl>
              </>
            )}
          </div>

          {/* ── What is the current demand situation? ──────────────────────── */}
          <div className="rs-grid-2" style={{ marginTop: 12 }}>
            <div>
              <SectionHeader
                title="Demand intensity distribution"
                note={demandDist ? `Share of ${(fresh.total_logs ?? 0).toLocaleString()} GPS log records` : undefined}
              />
              <div className="rs-panel">
                {!demandDist ? (
                  <UnavailableState reason="The analytics response carried no demand distribution." />
                ) : (
                  <>
                    <div className="rs-stack" role="img"
                      aria-label={TIER_ORDER.map((t) => `${t} ${(demandDist[t]?.pct ?? 0).toFixed(1)}%`).join(", ")}>
                      {TIER_ORDER.map((t) => {
                        const pct = demandDist[t]?.pct ?? 0;
                        if (pct <= 0) return null;
                        return (
                          <div
                            key={t}
                            className="rs-stack-seg"
                            style={{ width: `${pct}%`, background: DEMAND_COLOR[t] }}
                            title={`${t}: ${pct.toFixed(1)}% (${(demandDist[t]?.count ?? 0).toLocaleString()} records)`}
                          />
                        );
                      })}
                    </div>
                    <div className="rs-tablewrap" style={{ marginTop: 14 }}>
                      <table className="rs-table">
                        <thead>
                          <tr>
                            <th scope="col">Tier</th>
                            <th scope="col" className="rs-num">Records</th>
                            <th scope="col" className="rs-num">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {TIER_ORDER.map((t) => (
                            <tr key={t}>
                              <td>
                                <span className="rs-pill" style={{
                                  background: `${DEMAND_COLOR[t]}26`,
                                  color: DEMAND_COLOR[t],
                                }}>{t}</span>
                              </td>
                              <td className="rs-num">{(demandDist[t]?.count ?? 0).toLocaleString()}</td>
                              <td className="rs-num">{(demandDist[t]?.pct ?? 0).toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <DemandTierLegend capacity={capacity} />
                  </>
                )}
              </div>
            </div>

            <div>
              <SectionHeader
                title="Records by operating period"
                note="When the data was recorded, not how busy each period is"
              />
              <div className="rs-panel">
                {!timeDist ? (
                  <UnavailableState reason="The analytics response carried no time distribution." />
                ) : (
                  <>
                    <div className="rs-bars">
                      {PERIOD_ORDER.map((name) => {
                        const p = timeDist[name];
                        const pct = p?.pct ?? 0;
                        return (
                          <div className="rs-bar-row" key={name}>
                            <span className="rs-bar-name">{name}</span>
                            <div className="rs-bar-track">
                              <div
                                className="rs-bar-fill"
                                style={{ width: `${pct}%`, background: PERIOD_COLOR[name] }}
                              />
                            </div>
                            <span className="rs-bar-val">{pct.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                    </div>
                    <dl className="rs-deflist">
                      <div>
                        <b>Reading this chart.</b> These shares describe when recording
                        happened across the selected trips. They reflect the collection
                        schedule, so they are not a measure of corridor activity by period.
                        Use load factor above for that.
                      </div>
                    </dl>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Where are the priority stop clusters? ──────────────────────── */}
          <SectionHeader
            title="Stop clusters by recorded activity"
            note={
              dbscan
                ? `${rankedClusters.length} cluster${rankedClusters.length === 1 ? "" : "s"} from ` +
                  `${(dbscan.dbscan_input ?? 0).toLocaleString()} clustered records, eps = ${dbscan.eps_m} m, minPts = ${dbscan.min_samples}`
                : undefined
            }
          />

          {!dbscan ? (
            <UnavailableState reason="The analytics response carried no clustering result." />
          ) : rankedClusters.length === 0 ? (
            <EmptyState
              title="No stop clusters detected"
              body={
                "DBSCAN found no cluster meeting the minimum point threshold in this selection. " +
                "This happens when too few records remain after Poor-accuracy records and moving " +
                "readings are excluded from spatial input."
              }
            />
          ) : (
            <div className="rs-grid-2">
              <div className="rs-panel rs-panel--flush">
                <div className="rs-map">
                  <MapContainer
                    center={[14.7187, 120.957]}
                    zoom={14}
                    scrollWheelZoom={false}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      url={TILE_URL}
                      attribution={TILE_ATTRIBUTION}
                      maxZoom={TILE_MAX_ZOOM}
                    />
                    <Polyline positions={CORRIDOR} pathOptions={{ color: "#42a5f5", weight: 2, opacity: 0.45 }} />
                    <Polyline positions={RETURN_CORRIDOR} pathOptions={{ color: "#bf5af2", weight: 2, opacity: 0.35 }} />
                    {rankedClusters.map((c) => (
                      <CircleMarker
                        key={c.cluster_id}
                        center={[c.centroid_lat, c.centroid_lon]}
                        radius={Math.min(7 + Math.sqrt(c.point_count), 20)}
                        pathOptions={{
                          color: DEMAND_COLOR[c.demand_tier] || "#8e9ab0",
                          fillColor: DEMAND_COLOR[c.demand_tier] || "#8e9ab0",
                          fillOpacity: 0.42,
                          weight: 1.5,
                        }}
                      >
                        <Popup>
                          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                            <b>Cluster {c.cluster_id}</b><br />
                            {c.point_count.toLocaleString()} GPS log records<br />
                            Mean occupancy {c.avg_occupancy.toFixed(1)}, peak {c.max_occupancy}<br />
                            Load factor {c.load_factor_pct.toFixed(1)}%<br />
                            Tier {c.demand_tier} · Busiest period {c.peak_period}<br />
                            Type {c.cluster_type}
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                    <BoundsFitter points={rankedClusters} />
                  </MapContainer>
                </div>
              </div>

              <div className="rs-panel rs-panel--flush">
                <div className="rs-tablewrap" style={{ maxHeight: 380, overflowY: "auto" }}>
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th scope="col" className="rs-rank">#</th>
                        <th scope="col">Cluster</th>
                        <th scope="col" className="rs-num">Records</th>
                        <th scope="col" className="rs-num">Load factor</th>
                        <th scope="col">Tier</th>
                        <th scope="col">Busiest period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedClusters.map((c, i) => (
                        <tr key={c.cluster_id}>
                          <td className="rs-rank">{i + 1}</td>
                          <td>
                            <span style={{ color: "var(--rs-text)" }}>Cluster {c.cluster_id}</span>
                            <br />
                            <span style={{ fontSize: 10.5, color: "var(--rs-text-3)" }}>
                              {c.centroid_lat.toFixed(5)}, {c.centroid_lon.toFixed(5)} · {c.cluster_type}
                            </span>
                          </td>
                          <td className="rs-num">{c.point_count.toLocaleString()}</td>
                          <td className="rs-num">{c.load_factor_pct.toFixed(1)}%</td>
                          <td>
                            <span className="rs-pill" style={{
                              background: `${DEMAND_COLOR[c.demand_tier] || "#8e9ab0"}26`,
                              color: DEMAND_COLOR[c.demand_tier] || "#8e9ab0",
                            }}>{c.demand_tier}</span>
                          </td>
                          <td style={{ color: PERIOD_COLOR[c.peak_period] || "var(--rs-text-2)" }}>
                            {c.peak_period}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: "12px 16px", borderTop: "1px solid var(--rs-border)" }}>
                  <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--rs-text-3)" }}>
                    <b style={{ color: "var(--rs-text-2)" }}>Ranked by recorded activity.</b>{" "}
                    {DEF.clusterActivity}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── How reliable is the data? ──────────────────────────────────── */}
          <SectionHeader
            title="Evidence and data quality"
            note="GPS accuracy classification and what reached the clustering stage"
          />
          <div className="rs-panel">
            <DataQualitySummary quality={quality} dbscan={dbscan} />
          </div>

          {/* ── What should be inspected next? ─────────────────────────────── */}
          <SectionHeader
            title="Trip evidence"
            note={`${sentTrips.length} trip${sentTrips.length === 1 ? "" : "s"} in this selection. Values below are trip-level records, not per-record research figures.`}
            actions={<Link className="rs-btn" to="/admin/export">Export data</Link>}
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
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sentTrips.map((t) => (
                    <tr key={t.trip_id}>
                      <td style={{ fontSize: 11, color: "var(--rs-text-3)" }}>{t.trip_id}</td>
                      <td>{phtDateStr(t.start_time)}</td>
                      <td>{phtTimeStr(t.start_time)}</td>
                      <td>{dirLabel(t.direction)}</td>
                      <td>{t.jeep_code || "—"}</td>
                      <td className="rs-num">{t.official_capacity ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Link
                            className="rs-btn"
                            style={{ padding: "4px 9px", fontSize: 11.5 }}
                            to={`/analytics?trip=${encodeURIComponent(t.trip_id)}`}
                          >
                            View details
                          </Link>
                          <button
                            type="button"
                            className="rs-btn"
                            style={{ padding: "4px 9px", fontSize: 11.5 }}
                            onClick={() => handleExport(t.trip_id)}
                            disabled={exporting === t.trip_id}
                          >
                            {exporting === t.trip_id ? "Exporting…" : "Export CSV"}
                          </button>
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
            This dashboard is descriptive. It reports what was recorded on the corridor
            over the selected window and does not forecast demand, optimise routes, or
            recommend operational changes. Analytics are computed after a trip is
            completed; there is no live analytical view.
          </p>
        </>
      )}

      {loading && fresh && (
        <div style={{ marginTop: 16 }}>
          <LoadingState label="Recomputing for the new selection" />
        </div>
      )}
    </div>
  );
}
