import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import "./PublicDashboard.css";
import StopZoneMap from "./StopZoneMap";
import LiveRouteMap from "./LiveRouteMap";
import {
  DIR_LABEL, statusFor, isStale, hasPosition, timeAgo,
} from "./publicStatus";

const API     = import.meta.env.VITE_API_URL;
const POLL_MS = 5000;

function OccBar({ pct, color }) {
  return (
    <div className="pd-occbar">
      <div className="pd-occbar-fill"
        style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

/**
 * One vehicle, as a compact row beside the map.
 *
 * The cards this replaces showed "{gps_quality} GPS", which told a
 * passenger nothing they could act on and leaked an internal accuracy
 * flag. A rider wants the code, the direction, how full it is and how
 * fresh that is. trip_id stays out of the markup entirely; it is only a
 * React key.
 */
function JeepRow({ j }) {
  const st = statusFor(j);
  const stale = isStale(j);
  const located = hasPosition(j);
  const over = j.occupancy > j.capacity;
  return (
    <li className={`pd-row${stale ? " is-stale" : ""}`} style={{ "--status": st.color }}>
      <div className="pd-row-head">
        <span className="pd-row-code">{j.jeep_code}</span>
        <span className="pd-row-status" style={{ color: st.color }}>{st.label}</span>
      </div>
      <div className="pd-row-dir">{DIR_LABEL[j.direction] || j.direction}</div>
      <OccBar pct={j.occupancy_pct} color={st.color} />
      <div className="pd-row-counts">
        <strong>{j.occupancy} / {j.capacity}</strong> passengers
        <span className="pd-row-pct">{Math.round(j.occupancy_pct)}% full</span>
        {over && <span className="pd-row-over">{j.occupancy - j.capacity} over</span>}
      </div>
      <div className="pd-row-meta">
        <span>Updated {timeAgo(j.last_updated)}</span>
        {!located && <span className="pd-row-flag">Waiting for location</span>}
        {located && stale && <span className="pd-row-flag">Last update may be stale</span>}
      </div>
    </li>
  );
}

export default function PublicDashboard() {
  const { routeId = "MR-001" } = useParams();
  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [dirFilter, setDirFilter] = useState("all");
  const [mapDir,    setMapDir]    = useState("MALANDAY-RECTO");

  const [updating, setUpdating] = useState(false);
  /** Guards against a slow poll overlapping the next tick. */
  const inFlight = useRef(false);
  /** Set on unmount so a late response cannot touch state. */
  const deadRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (inFlight.current) return;          // previous poll still running
    inFlight.current = true;
    setUpdating(true);
    try {
      const res = await fetch(`${API}/public/route/${routeId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      if (deadRef.current) return;
      setData(json);
      setError(null);
      setLastPoll(new Date());
    } catch (e) {
      if (!deadRef.current) setError(e.message);
    } finally {
      inFlight.current = false;
      if (!deadRef.current) setUpdating(false);
    }
  }, [routeId]);

  useEffect(() => {
    deadRef.current = false;
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => {
      deadRef.current = true;
      clearInterval(t);
    };
  }, [fetchData]);

  /**
   * Re-render once a second so "Updated 12 seconds ago" and the stale
   * threshold stay honest between five-second polls. Cheap: it only moves
   * a clock the derived values read.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const jeepneys  = useMemo(() => data?.jeepneys || [], [data]);
  const filtered  = useMemo(
    () => (dirFilter === "all" ? jeepneys : jeepneys.filter(j => j.direction === dirFilter)),
    [jeepneys, dirFilter],
  );
  const mapped    = useMemo(() => filtered.filter(hasPosition), [filtered]);
  const awaiting  = filtered.length - mapped.length;
  const total     = jeepneys.length;
  const countMR   = jeepneys.filter(j => j.direction === "MALANDAY-RECTO").length;
  const countRM   = jeepneys.filter(j => j.direction === "RECTO-MALANDAY").length;
  const available = jeepneys.filter(j => statusFor(j).key === "available").length;
  const filling   = jeepneys.filter(j => ["near", "full"].includes(statusFor(j).key)).length;
  const overcrowd = jeepneys.filter(j => statusFor(j).key === "over").length;
  const staleCount = jeepneys.filter(j => isStale(j, nowMs)).length;

  /**
   * One honest line about the feed. "LIVE" used to be a static badge that
   * said LIVE whether or not anything was arriving.
   */
  const feed = error ? { key: "error", label: "Connection problem" }
    : !data ? { key: "loading", label: "Loading" }
      : updating ? { key: "updating", label: "Updating" }
        : total === 0 ? { key: "idle", label: "No active jeepneys" }
          : { key: "live", label: "Live" };

  return (
    <div className="pd-page">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="pd-header">
        <div className="pd-header-top">
          <div>
            <h1 className="pd-title">RutaSmart</h1>
            <p className="pd-subtitle">Malanday — Recto · Live Jeepney Status</p>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
            <div className={`pd-live-dot pd-feed-${feed.key}`} role="status" aria-live="polite">
              <span className="pd-live-ring"/>
              {feed.label}
            </div>
            <a href="/" style={{ fontSize:11, color:"rgba(255,255,255,0.50)", textDecoration:"none", fontWeight:600 }}>
              ⌂ Home
            </a>
          </div>
        </div>

        {/* Stats strip — three states: counters / offline message / nothing (loading) */}
        {data && total > 0 ? (
          <div className="pd-summary">
            {[
              { val:total,            label:"ACTIVE JEEPNEYS",    color:"#42a5f5" },
              { val:available+filling,label:"AVAILABLE / FILLING",color:"#30d158" },
              { val:overcrowd,        label:"FULL / OVERCROWDED", color:"#ff453a" },
            ].map(({ val, label, color }) => (
              <div key={label} className="pd-summary-item">
                <span className="pd-summary-value" style={{ color }}>{val}</span>
                <span className="pd-summary-label">{label}</span>
              </div>
            ))}
          </div>
        ) : data && total === 0 ? (
          <div style={{ textAlign:"center", padding:"10px 0",
            fontSize:12, color:"rgba(255,255,255,0.40)", fontWeight:600, letterSpacing:"0.3px" }}>
            Live tracking offline — check back when conductors are active
          </div>
        ) : null}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="pd-content">

        {/* ── Direction filter — drives BOTH the map and the list ────── */}
        <div className="pd-dir-filter" style={{ padding: 0 }}>
          {[
            { key: "all",            label: "All directions",   count: total   },
            { key: "MALANDAY-RECTO", label: "Malanday to Recto", count: countMR },
            { key: "RECTO-MALANDAY", label: "Recto to Malanday", count: countRM },
          ].map(({ key, label, count }) => (
            <button key={key} onClick={() => setDirFilter(key)}
              className={`pd-dir-btn ${dirFilter === key ? "active" : ""}`}>
              {label}
              <span className="pd-dir-count">{count}</span>
            </button>
          ))}
        </div>

        {/* ── The map comes first ─────────────────────────────────────
            A passenger wants to see where the jeepneys are before
            reading about them. The list below carries the same facts in
            text for anyone who cannot use a map. */}
        <LiveRouteMap jeepneys={mapped} direction={dirFilter} />

        {error && (
          <div className="pd-error">
            Could not reach the server — retrying every {POLL_MS / 1000} seconds.
            <br /><small style={{ opacity: 0.7 }}>{error}</small>
          </div>
        )}

        {!data && !error && (
          <div className="pd-loading">
            <div className="pd-spinner" />
            <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.50)" }}>
              Loading live jeepney positions…
            </p>
          </div>
        )}

        {staleCount > 0 && (
          <div className="pd-stale-note">
            {staleCount} jeepney{staleCount > 1 ? "s have" : " has"} not reported in over a
            minute. The last known position is still shown, marked as possibly stale.
          </div>
        )}

        {data && total === 0 && (
          <div className="pd-empty">
            <span className="pd-empty-icon">🚌</span>
            <h3>No active jeepneys right now</h3>
            <p>No conductor is currently recording a trip on this route.<br />
              Jeepneys appear here within seconds of a trip starting.</p>
          </div>
        )}

        {data && total > 0 && (
          <>
            {awaiting > 0 && (
              <p className="pd-awaiting">
                {awaiting} jeepney{awaiting > 1 ? "s are" : " is"} waiting for a location fix and
                {awaiting > 1 ? " are" : " is"} listed below without a map marker.
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="pd-empty" style={{ padding: "32px 20px" }}>
                <span className="pd-empty-icon" style={{ fontSize: 36 }}>🚌</span>
                <h3>No jeepneys in this direction</h3>
                <p>Switch to "All directions" to see every active jeepney.</p>
              </div>
            ) : (
              <ul className="pd-rows">
                {filtered.map(j => <JeepRow key={j.trip_id} j={j} />)}
              </ul>
            )}

            <p className="pd-hint">
              Positions and passenger counts update every {POLL_MS / 1000} seconds from
              conductor devices.
            </p>
          </>
        )}

        {/* ── Where you can board — the published stop zones ──────────── */}
        <div className="pd-stops">
          <h2 className="pd-stops-title">Where you can board</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { key: "MALANDAY-RECTO", label: "Going to Recto" },
              { key: "RECTO-MALANDAY", label: "Going to Malanday" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setMapDir(key)} className={
                `pd-dir-btn ${mapDir === key ? "active" : ""}`}>{label}</button>
            ))}
          </div>
          <StopZoneMap routeId={routeId} direction={mapDir} />
        </div>

      </div>

      {/* ── Footer — minimal, no jeepney legend ─────────────────── */}
      <div className="pd-footer">
        <p className="pd-footer-note">
          Updates every 5 seconds · Data from conductor PWA · <strong>RutaSmart 2026</strong>
          {lastPoll && <> · {lastPoll.toLocaleTimeString()}</>}
        </p>
      </div>

    </div>
  );
}
