import { useState, useEffect, useMemo, useCallback } from "react";
import { getAdminTrips, runMergedAll, MERGED_TRIP_LIMIT } from "../../services/api";
import { phtDateStr } from "../../utils/adminFormatters";
import { PERIOD_ORDER } from "./definitions";

/**
 * Corridor analytics, computed per GPS log record.
 *
 * One place where every redesigned admin page gets its manuscript-faithful
 * figures, so the computation is not re-derived (and re-broken) per page.
 *
 * Source
 * ------
 * GET /analytics/merged/run-all, which merges the GPS points of the selected
 * trips and runs the full pipeline over them. Demand tier, operating period
 * and load factor are all assigned PER RECORD, and GPS quality comes back as
 * the full three-way GOOD / ACCEPTABLE / POOR split.
 *
 * Why not /admin/aggregate
 * ------------------------
 * That endpoint bins whole trips: one period taken from the trip's start
 * hour, one tier taken from the trip's maximum occupancy, and a load factor
 * that is an unweighted mean of per-trip means. Its distributions are trip
 * counts rather than record counts, so they cannot be read against the
 * manuscript's tables. It remains the right source for per-trip rows, which
 * are trip-level measurements by nature and are labelled as such.
 *
 * This hook never writes. It issues two GETs and derives the rest.
 *
 * Caching
 * -------
 * /analytics/merged/run-all is rate limited to 5 requests per minute, and it
 * is genuinely expensive: it re-runs DBSCAN over every merged point. Five
 * admin pages now read it, so an inspector walking Overview to Demand to
 * Trips to Stop Zones to Map to Research would fire six calls and start
 * collecting HTTP 429s.
 *
 * Results are therefore cached per trip-id set for CACHE_TTL_MS, and
 * concurrent callers share one in-flight promise. Navigating between pages
 * reuses the computed corridor rather than recomputing it, and Refresh
 * clears the entry so an explicit reload still hits the backend.
 */

const CACHE_TTL_MS = 120000;
const STORE_PREFIX = "rutasmart_corridor_";

/** key -> { at, data } for settled results, within one page load. */
const resultCache = new Map();
/** key -> Promise, so simultaneous mounts issue one request. */
const inFlight = new Map();

/**
 * The in-memory map dies on every full page load, and a browser refresh or a
 * direct URL entry is a full page load. sessionStorage carries the result
 * across those within the same tab, which is what keeps an inspector from
 * collecting 429s simply by reloading an admin page.
 *
 * Every access is wrapped: storage can be unavailable (private mode, blocked
 * site data) or full, and a corridor result is a convenience, never
 * something the page needs in order to render.
 */
function readStore(key) {
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(key, entry) {
  try {
    sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or blocked storage: the in-memory cache still applies.
  }
}

/** Drop every cached corridor result; used by an explicit Refresh. */
export function clearCorridorCache() {
  resultCache.clear();
  inFlight.clear();
  try {
    const doomed = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORE_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

function fetchMerged(ids) {
  const key = ids;

  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(hit.data);
  }

  const stored = readStore(key);
  if (stored && Date.now() - stored.at < CACHE_TTL_MS) {
    resultCache.set(key, stored);
    return Promise.resolve(stored.data);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = runMergedAll(ids.split(","))
    .then((r) => {
      const entry = { at: Date.now(), data: r.data };
      resultCache.set(key, entry);
      writeStore(key, entry);
      return r.data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

export function useCorridorAnalytics({ direction = "ALL", range = "ALL" } = {}) {
  const [trips, setTrips] = useState([]);
  const [tripsErr, setTripsErr] = useState(null);
  const [tripsLoading, setTripsLoading] = useState(true);

  const [data, setData] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const [reloadToken, setReloadToken] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const reload = useCallback(() => {
    // Runs from a click, not from an effect body. An explicit Refresh should
    // really re-fetch, so the cache is dropped first.
    clearCorridorCache();
    setTripsErr(null);
    setTripsLoading(true);
    setError(null);
    setLoadedFor(null);
    setNowMs(Date.now());
    setReloadToken((n) => n + 1);
  }, []);

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

  const selected = useMemo(() => {
    const days = range === "ALL" ? null : Number(range);
    let out = completed;
    if (direction !== "ALL") out = out.filter((t) => t.direction === direction);
    if (days) {
      const cutoff = nowMs - days * 86400000;
      out = out.filter((t) => {
        const ms = Date.parse(t.start_time + (t.start_time?.endsWith("Z") ? "" : "Z"));
        return Number.isFinite(ms) && ms >= cutoff;
      });
    }
    return out;
  }, [completed, direction, range, nowMs]);

  const sentTrips = useMemo(() => selected.slice(0, MERGED_TRIP_LIMIT), [selected]);
  const truncated = selected.length > sentTrips.length;
  const sentIds = useMemo(() => sentTrips.map((t) => t.trip_id).join(","), [sentTrips]);

  useEffect(() => {
    if (!sentIds) return;
    let cancelled = false;
    fetchMerged(sentIds)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setFetchedAt(new Date());
        setLoadedFor(sentIds);
      })
      .catch((e) => {
        if (cancelled) return;
        const status = e?.response?.status;
        setData(null);
        setError(
          status === 404
            ? "No GPS log records were found for the selected trips."
            : status === 403
              ? "This account is not authorised to run corridor analytics."
              : status === 429
                ? "Corridor analytics are rate limited and that limit was just reached. " +
                  "Wait about a minute, then use Refresh."
                : "Analytics could not be computed for this selection.",
        );
        setLoadedFor(sentIds);
      });
    return () => { cancelled = true; };
  }, [sentIds, reloadToken]);

  const loading = Boolean(sentIds) && loadedFor !== sentIds;
  const fresh = loadedFor === sentIds ? data : null;

  // ── Derived, all per GPS log record ─────────────────────────────────────
  const quality = fresh?.gps_quality ?? null;
  const dbscan = fresh?.dbscan ?? null;
  const demandDist = fresh?.demand?.distribution ?? null;
  const timeDist = fresh?.time_dist?.distribution ?? null;
  const byPeriod = fresh?.load_factor?.by_period ?? null;
  const overall = fresh?.load_factor?.overall ?? null;
  const capacity = fresh?.load_factor?.official_capacity ?? null;

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

  /** Moderate + High + Critical, as a share of GPS log records. */
  const overCapacityPct = useMemo(() => {
    if (!demandDist) return null;
    const over = ["Moderate", "High", "Critical"]
      .reduce((s, t) => s + (demandDist[t]?.pct ?? 0), 0);
    return Math.round(over * 100) / 100;
  }, [demandDist]);

  /** GOOD + ACCEPTABLE, the manuscript's quality-threshold figure. */
  const thresholdPct = useMemo(() => {
    if (!quality || !quality.total_logs) return null;
    return ((quality.good_count + quality.acceptable_count) / quality.total_logs) * 100;
  }, [quality]);

  /** Clusters ordered by recorded activity. Descriptive ordering only. */
  const rankedClusters = useMemo(() => {
    if (!dbscan?.clusters) return [];
    return [...dbscan.clusters].sort((a, b) => b.point_count - a.point_count);
  }, [dbscan]);

  return {
    // raw
    trips, completed, activeCount, selected, sentTrips, sentIds, truncated,
    data: fresh, quality, dbscan, demandDist, timeDist, byPeriod, overall, capacity,
    // derived
    collectionDays, peak, overCapacityPct, thresholdPct, rankedClusters,
    totalLogs: fresh?.total_logs ?? null,
    sourceTripCount: fresh?.source_trips?.length ?? null,
    // state
    loading, tripsLoading, error, tripsErr, fetchedAt, reload,
  };
}

export default useCorridorAnalytics;
