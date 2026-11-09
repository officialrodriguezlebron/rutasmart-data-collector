import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";

import {
  getAdminTrips, runMergedAll, getStopZoneRecommendations, MERGED_TRIP_LIMIT,
} from "../../services/api";
import { phtDateStr, phtTimeStr } from "../../utils/adminFormatters";
import {
  AdminPageHeader, SectionHeader, MetricCard,
  DataStatusBadge,
  EmptyState, UnavailableState, ErrorState,
  SkeletonMetrics,
  DEF, PERIOD_ORDER, PERIOD_DEFS, OFFICIAL_DATASET,
} from "../../components/admin";
import "../AdminDashboard.css";
import "./AdminOverview.css";

/**
 * Corridor Overview — the inspector's operational briefing.
 *
 * The page answers one question: what is happening on the Malanday to Recto
 * corridor, and what should an inspector review first? It is ordered as
 * question, status, evidence, review prompts, supporting charts, method, so
 * a reader who stops after the first screen still has the finding.
 *
 * Scope
 * -----
 * This page interprets. It does not hold the full evidence tables: demand
 * tier mix lives on Demand and Capacity, hotspot detail on Demand Hotspots,
 * per-trip quality on Trips, and method detail on Research. Each is linked
 * from here rather than duplicated, so a figure has one home.
 *
 * Data source
 * -----------
 * GET /analytics/merged/run-all, which computes every analytical figure PER
 * RECORDED OBSERVATION across the selected trips and then aggregates. That
 * is the method described in manuscript sections 3.10.3 to 3.10.5.
 *
 * /admin/aggregate is deliberately NOT used for headline figures: it bins
 * whole trips (one period from the trip's start hour, one tier from the
 * trip's maximum occupancy, a load factor that is an unweighted mean of
 * per-trip means), so its distributions are trip counts and cannot be read
 * against the manuscript's tables. /admin/trips supplies the trip list and
 * the filters only.
 *
 * Boundaries
 * ----------
 * The system is diagnostic (Rec. 6.3.3: it "describes and diagnoses route
 * behavior but does not predict it"). Everything on this page is either a
 * measurement or a prompt to go and look at something. Nothing here tells
 * the reader to dispatch a vehicle, move a stop, designate a terminal or
 * change a fare, and the review prompts are worded so they cannot be read
 * as instructions to do so.
 */

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

/** Both corridor directions, for the reviewed-zone count. */
const ZONE_DIRECTIONS = ["MALANDAY-RECTO", "RECTO-MALANDAY"];

/** Where each review prompt sends the reader. All pages already exist. */
const PERIOD_PAGE = "/admin/demand";
const HOTSPOT_PAGE = "/admin/map";
const TIME_PAGE = "/analytics?tab=time";
const EVIDENCE_PAGE = "/admin/research";

/**
 * Horizontal load bar with a reference line at 100% of seated capacity.
 *
 * The scale is fixed at 110 or the observed maximum, whichever is larger,
 * so the 100% line sits in the same place for every period and bars stay
 * comparable between them.
 */
function LoadBar({ name, pct, logCount, max }) {
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
          title="100% — all seats filled"
          aria-hidden="true"
        />
      </div>
      <span className="rs-bar-val" style={over ? { color: "var(--rs-on-critical)" } : undefined}>
        {/* Two decimals: the manuscript reports load factor to 2dp
            (Afternoon Peak 107.19%) and the backend serialises it so. */}
        {pct.toFixed(2)}%
        <span className="rs-sr">
          {over ? ", above seated capacity" : ""}, from {logCount.toLocaleString()} recorded observations
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

  /** Reviewed passenger zones, counted per direction. */
  const [zoneCounts, setZoneCounts] = useState(null);

  // Bumping this re-runs the fetches. The clock is pinned in state rather
  // than read during render, so the relative date filter stays pure.
  const [reloadToken, setReloadToken] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const reload = useCallback(() => {
    // Safe here: this runs from a click, not from an effect body.
    setTripsErr(null);
    setTripsLoading(true);
    setError(null);
    setLoadedFor(null);
    setNowMs(Date.now());
    setReloadToken((n) => n + 1);
  }, []);

  // ── Trip list: filters and freshness derive from it ─────────────────────
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

  // ── Reviewed passenger zones, both directions ───────────────────────────
  // Counted separately from the detection run on purpose: these are a
  // reviewed list, and the page's job is to keep the two apart.
  useEffect(() => {
    let cancelled = false;
    Promise.all(ZONE_DIRECTIONS.map((d) =>
      getStopZoneRecommendations(ROUTE_ID, d)
        .then((r) => [d, (r.data?.zones ?? []).length])
        .catch(() => [d, null])))
      .then((pairs) => { if (!cancelled) setZoneCounts(Object.fromEntries(pairs)); });
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
            ? "No recorded observations were found for the selected trips."
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
  const demandDist = fresh?.demand?.distribution ?? null;
  const byPeriod = fresh?.load_factor?.by_period ?? null;
  const capacity = fresh?.load_factor?.official_capacity ?? null;
  const hotspotCount = fresh?.dbscan?.clusters?.length ?? null;
  const observations = fresh?.total_logs ?? null;
  const tripCount = fresh?.source_trips?.length ?? sentTrips.length;

  const collectionDays = useMemo(() => {
    const days = new Set(sentTrips.map((t) => phtDateStr(t.start_time)).filter((d) => d !== "—"));
    return days.size || null;
  }, [sentTrips]);

  /** Highest per-period mean load factor, with the period that produced it. */
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

  /**
   * Above seated capacity: Moderate + High + Critical.
   *
   * Deliberately not the same as the Critical tier. Every reading above the
   * 26-seat capacity counts, which is why the card says "more than 26
   * passengers" rather than naming a tier.
   */
  const aboveCapacityPct = useMemo(() => {
    if (!demandDist) return null;
    const over = ["Moderate", "High", "Critical"]
      .reduce((s, t) => s + (demandDist[t]?.pct ?? 0), 0);
    return Math.round(over * 100) / 100;
  }, [demandDist]);

  /** High + Critical: the readings furthest past capacity (32 or more). */
  const highCriticalPct = useMemo(() => {
    if (!demandDist) return null;
    const v = (demandDist.High?.pct ?? 0) + (demandDist.Critical?.pct ?? 0);
    return Math.round(v * 100) / 100;
  }, [demandDist]);

  /** Good + Acceptable positional accuracy. */
  const reliabilityPct = useMemo(() => {
    if (!quality || !quality.total_logs) return null;
    return ((quality.good_count + quality.acceptable_count) / quality.total_logs) * 100;
  }, [quality]);

  const maxPeriodLf = useMemo(() => {
    if (!byPeriod) return 110;
    return Math.max(110, ...PERIOD_ORDER.map((n) => byPeriod[n]?.avg_lf ?? 0));
  }, [byPeriod]);

  /** Reviewed zones for the current direction filter, or both. */
  const reviewedZones = useMemo(() => {
    if (!zoneCounts) return null;
    const vals = direction === "ALL"
      ? ZONE_DIRECTIONS.map((d) => zoneCounts[d])
      : [zoneCounts[direction]];
    if (vals.some((v) => v == null)) return null;
    return vals.reduce((a, b) => a + b, 0);
  }, [zoneCounts, direction]);

  /**
   * Corridor status. Derived, never hard-coded: if a different period peaks
   * in the selection on screen, the band names that period instead.
   */
  const status = useMemo(() => {
    if (!peak) return null;
    if (peak.pct > 100) {
      return {
        tone: "attention",
        word: "Needs attention",
        rest: `${peak.name} crowding`,
        body: `Average load reached ${peak.pct.toFixed(2)}% of seated capacity during the ${peak.name}.`,
      };
    }
    if (peak.pct >= 90) {
      return {
        tone: "watch",
        word: "Monitor",
        rest: `${peak.name} approaching capacity`,
        body: `Average load reached ${peak.pct.toFixed(2)}% of seated capacity during the ${peak.name}, close to all seats being filled.`,
      };
    }
    return {
      tone: "ok",
      word: "Within capacity",
      rest: "no period above seated capacity",
      body: `The busiest period, ${peak.name}, averaged ${peak.pct.toFixed(2)}% of seated capacity.`,
    };
  }, [peak]);

  /** Clock range of whichever period peaked, e.g. "4:00-6:59 PM". */
  const peakRange = useMemo(() => {
    if (!peak) return null;
    const d = PERIOD_DEFS.find((x) => x.name === peak.name);
    if (!d) return null;
    // PERIOD_DEFS carries 24-hour text; the card reads better in 12-hour.
    const to12 = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      const ap = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
    };
    const [a, b] = d.range.split(" to ");
    return `${to12(a)}–${to12(b)}`.replace(" AM–", "–").replace(" PM–", "–");
  }, [peak]);

  /** "20 trips · 35,326 observations · 13 collection days" */
  const scopeCounts = useMemo(() => [
    `${tripCount.toLocaleString()} trip${tripCount === 1 ? "" : "s"}`,
    `${(observations ?? 0).toLocaleString()} observations`,
    collectionDays == null
      ? null
      : `${collectionDays} collection day${collectionDays === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · "), [tripCount, observations, collectionDays]);

  const newestTrip = sentTrips[0] ?? null;

  const matchesOfficial =
    tripCount === OFFICIAL_DATASET.trips && observations === OFFICIAL_DATASET.logs;

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
        subtitle="What is happening on Malanday–Recto?"
        badges={badges}
        actions={
          <>
            <Link className="rs-btn" to="/admin/trips">Trips</Link>
            <Link className="rs-btn rs-btn--primary" to={HOTSPOT_PAGE}>Demand Hotspots</Link>
          </>
        }
      />

      {/* ── Filters (behaviour unchanged) ─────────────────────────────────── */}
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

      {tripsErr && (
        <ErrorState title="Trip list unavailable" body={tripsErr} onRetry={reload} />
      )}

      {!tripsErr && !tripsLoading && completed.length === 0 && (
        <EmptyState
          title="No completed trips yet"
          body={
            "Figures are computed after a trip is completed. Once a conductor finishes a " +
            "recording, corridor status, demand and timing will appear here."
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

      {loading && !fresh && <SkeletonMetrics count={4} />}

      {fresh && (
        <>
          {/* ── Corridor status ──────────────────────────────────────────── */}
          {status && (
            <section className={`ov-status ov-status--${status.tone}`} role="status" aria-live="polite">
              <div className="ov-status-text">
                <h2 className="ov-status-title">
                  <span className="ov-status-word">{status.word}:</span> {status.rest}
                </h2>
                <p className="ov-status-body">{status.body}</p>
              </div>
              <Link className="rs-btn rs-btn--primary" to={PERIOD_PAGE}>
                Review {peak.name} →
              </Link>
            </section>
          )}

          {/* ── Selection scope ──────────────────────────────────────────
              Sits directly above the figures it governs. A filtered view
              produces legitimately different numbers, and the reader has to
              be able to see why without hunting for a filter control. */}
          <div className={`ov-scope${matchesOfficial ? "" : " ov-scope--filtered"}`} role="note">
            <span className="ov-scope-label">
              {matchesOfficial ? "Official study dataset" : "Filtered view"}
            </span>
            <span className="ov-scope-sep" aria-hidden="true">·</span>
            {matchesOfficial ? (
              <span className="ov-scope-counts">{scopeCounts}</span>
            ) : (
              <>
                <span>values below reflect the current direction, date, or trip selection</span>
                <span className="ov-scope-counts">{scopeCounts}</span>
              </>
            )}
          </div>

          {/* ── Four priority figures ────────────────────────────────────── */}
          <div className="rs-metrics ov-metrics">
            {/* Red is reserved for a load factor actually above 100%. Within
                capacity is green, because that is the reassuring reading. */}
            <MetricCard
              label="Peak load factor"
              value={peak ? `${peak.pct.toFixed(2)}%` : null}
              sub={peak
                ? `Highest average passenger load compared with seated capacity in the current selection — ${peak.name}${peakRange ? ` · ${peakRange}` : ""}`
                : undefined}
              accent={peak && peak.pct > 100
                ? "var(--rs-fill-critical)" : "var(--rs-fill-normal)"}
              definition={DEF.peakLoadFactor}
              unavailableNote="No period in this selection carried observations."
            />
            {/* Amber, not red: this counts every reading above the seats,
                most of which are the Moderate tier. */}
            <MetricCard
              label="Above seated capacity"
              value={aboveCapacityPct == null ? null : `${aboveCapacityPct.toFixed(2)}%`}
              sub={`Observations above the official ${capacity ?? 26}-seat capacity`}
              accent="var(--rs-fill-moderate)"
              definition={DEF.aboveSeatedCapacity}
              unavailableNote="The analytics response carried no demand distribution."
            />
            {/* Amber, not red: a combined category. Colouring it Critical red
                would imply the whole share is the Critical tier, which it is
                not — Critical is reported on its own on Demand and Capacity. */}
            <MetricCard
              label="High + Critical demand"
              value={highCriticalPct == null ? null : `${highCriticalPct.toFixed(2)}%`}
              sub={`Observations with ${(capacity ?? 26) + 6}+ passengers`}
              accent="var(--rs-fill-high)"
              definition={DEF.highCritical}
              unavailableNote="The analytics response carried no demand distribution."
            />
            <MetricCard
              label="Data reliability"
              value={reliabilityPct == null ? null : `${reliabilityPct.toFixed(2)}%`}
              sub={`Observations classified as Good or Acceptable GPS quality${matchesOfficial ? "" : " · current selection"}`}
              accent="var(--rs-fill-normal)"
              definition={DEF.dataReliability}
              unavailableNote="The analytics response carried no quality summary."
            />
          </div>

          {/* Related pages, as a compact row. The sidebar already carries
              these; this is a shortcut, not a task list. */}
          <nav className="ov-links" aria-label="Related pages">
            <Link className="rs-btn" to={PERIOD_PAGE}>Demand and Capacity</Link>
            <Link className="rs-btn" to={HOTSPOT_PAGE}>Demand Hotspots</Link>
            <Link className="rs-btn" to={TIME_PAGE}>Time Periods</Link>
          </nav>


          {/* ── 6. Load by operating period ──────────────────────────────── */}
          <SectionHeader
            title="Load by operating period"
            note={byPeriod
              ? `Seated capacity ${capacity ?? "—"}. The line marks 100% — all seats filled. Above it, more passengers than seats.`
              : undefined}
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
                            No observations
                          </span>
                        </div>
                      );
                    }
                    return (
                      <LoadBar
                        key={name}
                        name={name}
                        pct={p.avg_lf}
                        logCount={p.log_count}
                        max={maxPeriodLf}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── Where demand is concentrated ─────────────────────────────
              Two counts readers assume should match. Kept to one compact
              row: the marks and the single caption carry the distinction. */}
          <SectionHeader title="Where demand is concentrated" />
          <div className="ov-where">
            <div className="ov-where-tile ov-where-tile--detected">
              <span className="ov-where-mark ov-where-mark--detected" aria-hidden="true" />
              <span className="ov-where-value">{hotspotCount ?? "—"}</span>
              <span className="ov-where-label">Detected hotspots</span>
            </div>

            <div className="ov-where-tile ov-where-tile--reviewed">
              <span className="ov-where-mark ov-where-mark--reviewed" aria-hidden="true" />
              <span className="ov-where-value">{reviewedZones ?? "—"}</span>
              <span className="ov-where-label">Reviewed passenger zones</span>
            </div>

            <Link className="rs-btn ov-where-link" to={HOTSPOT_PAGE}>View on map</Link>
          </div>
          <p className="ov-where-explain">
            Detected hotspots come from observed GPS activity. Reviewed passenger zones are
            separately assessed passenger-service areas. Different datasets.
          </p>

          {/* ── 8. How this was calculated ───────────────────────────────── */}
          <details className="ov-how">
            <summary>How this was calculated</summary>
            <div className="ov-how-body">
              <dl>
                <dt>Load factor</dt>
                <dd>{DEF.loadFactor}</dd>

                <dt>Demand levels</dt>
                <dd>
                  Each recorded observation is placed in a demand level by comparing its
                  passenger count with the official seated capacity
                  {capacity ? ` (${capacity} seats)` : ""}: at or below capacity, up to five
                  above, up to ten above, and more than ten above.
                </dd>

                <dt>Data reliability</dt>
                <dd>{DEF.dataReliability}</dd>

                <dt>Figures shown here</dt>
                <dd>
                  Aggregated from the {tripCount} completed trip{tripCount === 1 ? "" : "s"} in the
                  current selection
                  {observations ? `, covering ${observations.toLocaleString()} recorded observations` : ""}
                  {collectionDays ? ` across ${collectionDays} collection day${collectionDays === 1 ? "" : "s"}` : ""}.
                  Active trips are excluded; figures are computed after a trip completes.
                </dd>
              </dl>
              <p className="ov-how-foot">
                Detection parameters, accuracy scoring against field-verified stops and the full
                per-trip quality tables are on the Research page.{" "}
                <Link to={EVIDENCE_PAGE}>Open Research →</Link>
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
