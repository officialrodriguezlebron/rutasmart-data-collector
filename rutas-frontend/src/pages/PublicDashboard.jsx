import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import "./PublicDashboard.css";
import StopZoneMap from "./StopZoneMap";

const API = import.meta.env.VITE_API_URL;
const POLL_MS = 5000;

const TIER_CONFIG = {
  AVAILABLE: { label: "Available",   emoji: "🟢", bg: "#e8f5e9", border: "#2e7d32", text: "#1b5e20", bar: "#2e7d32" },
  MODERATE:  { label: "Filling Up",  emoji: "🟡", bg: "#fffde7", border: "#f9a825", text: "#e65100", bar: "#f9a825" },
  FULL:      { label: "Almost Full", emoji: "🟠", bg: "#fff3e0", border: "#ef6c00", text: "#bf360c", bar: "#ef6c00" },
  OVERCAP:   { label: "OVERCROWDED", emoji: "🔴", bg: "#ffebee", border: "#c62828", text: "#b71c1c", bar: "#c62828" },
};

const DIRECTION_LABEL = {
  "MALANDAY-RECTO": "Malanday → Recto",
  "RECTO-MALANDAY": "Recto → Malanday",
};

function timeAgo(isoStr) {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr + (isoStr.endsWith("Z") ? "" : "Z"))) / 1000);
  if (diff < 5)    return "just now";
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function OccupancyBar({ pct, color }) {
  return (
    <div style={{ background: "#e0e0e0", borderRadius: 99, height: 8, overflow: "hidden", margin: "6px 0" }}>
      <div style={{
        width: `${Math.min(100, pct)}%`, height: "100%",
        background: color, borderRadius: 99,
        transition: "width 0.5s ease",
      }} />
    </div>
  );
}

function JeepCard({ j }) {
  const cfg = TIER_CONFIG[j.tier] || TIER_CONFIG.AVAILABLE;
  return (
    <div className="pd-jeep-card" style={{ borderLeft: `5px solid ${cfg.border}`, background: cfg.bg }}>
      <div className="pd-jeep-header">
        <div className="pd-jeep-code">{j.jeep_code}</div>
        <div className="pd-tier-badge" style={{ background: cfg.border, color: "#fff" }}>
          {cfg.emoji} {cfg.label}
        </div>
      </div>
      <div className="pd-jeep-direction">
        {DIRECTION_LABEL[j.direction] || j.direction}
      </div>
      <OccupancyBar pct={j.occupancy_pct} color={cfg.bar} />
      <div className="pd-jeep-counts">
        <span style={{ color: cfg.text, fontWeight: 700, fontSize: 22 }}>
          {j.occupancy}
        </span>
        <span style={{ color: "#888", fontSize: 14 }}>
          {" "}/ {j.capacity} passengers
          {j.occupancy > j.capacity && (
            <span style={{ color: "#c62828", fontWeight: 700 }}>
              {" "}(+{j.occupancy - j.capacity} over)
            </span>
          )}
        </span>
      </div>
      <div className="pd-jeep-meta">
        <span>📍 {j.gps_quality} GPS</span>
        <span>🕐 {timeAgo(j.last_updated)}</span>
      </div>
    </div>
  );
}

export default function PublicDashboard() {
  const { routeId = "MR-001" } = useParams();
  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [dirFilter, setDirFilter] = useState("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/public/route/${routeId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastPoll(new Date());
    } catch (e) {
      setError(e.message);
    }
  }, [routeId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const jeepneys = data?.jeepneys || [];
  const filtered  = dirFilter === "all" ? jeepneys : jeepneys.filter(j => j.direction === dirFilter);
  const total     = jeepneys.length;
  const countMR   = jeepneys.filter(j => j.direction === "MALANDAY-RECTO").length;
  const countRM   = jeepneys.filter(j => j.direction === "RECTO-MALANDAY").length;

  const available  = jeepneys.filter(j => j.tier === "AVAILABLE").length;
  const filling    = jeepneys.filter(j => j.tier === "MODERATE" || j.tier === "FULL").length;
  const overcrowd  = jeepneys.filter(j => j.tier === "OVERCAP").length;

  const staleCount = jeepneys.filter(j => {
    if (!j.last_updated) return false;
    const diff = (Date.now() - new Date(j.last_updated + (j.last_updated.endsWith("Z") ? "" : "Z"))) / 1000;
    return diff > 7200;
  }).length;

  return (
    <div className="pd-page">
      <div className="pd-content">

        {/* Header */}
        <div className="pd-header">
          <a href="/" className="pd-home-btn">⌂ Home</a>
          <div className="pd-title-block">
            <h1 className="pd-title">RutaSmart</h1>
            <p className="pd-subtitle">Malanday — Recto · Live Jeepney Status</p>
          </div>
          <div className="pd-live-badge">● LIVE</div>
        </div>

        {/* Stale warning */}
        {staleCount > 0 && (
          <div className="pd-stale-banner">
            ⚠ {staleCount} jeepney{staleCount > 1 ? "s" : ""} hidden — no update in over 2 hours
          </div>
        )}

        {/* Stats strip */}
        {data && (
          <div className="pd-stats">
            <div className="pd-stat">
              <div className="pd-stat-val" style={{ color: "#42a5f5" }}>{total}</div>
              <div className="pd-stat-label">ACTIVE JEEPNEYS</div>
            </div>
            <div className="pd-stat">
              <div className="pd-stat-val" style={{ color: "#2e7d32" }}>{available + filling}</div>
              <div className="pd-stat-label">AVAILABLE / FILLING</div>
            </div>
            <div className="pd-stat">
              <div className="pd-stat-val" style={{ color: "#c62828" }}>{overcrowd}</div>
              <div className="pd-stat-label">FULL / OVERCROWDED</div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="pd-error">
            ⚠️ Could not reach server — retrying…<br />
            <small>{error}</small>
          </div>
        )}

        {/* Loading state */}
        {!data && !error && (
          <div className="pd-loading">
            <div className="pd-spinner" />
            <p>Loading live data…</p>
          </div>
        )}

        {/* Empty state */}
        {data && jeepneys.length === 0 && (
          <div className="pd-empty">
            <div className="pd-empty-icon">🚌</div>
            <h3>No active jeepneys right now</h3>
            <p>
              No conductor is currently recording a trip on this route.<br />
              Data appears here when conductors use the RutaSmart app.
            </p>
          </div>
        )}

        {/* Jeepney cards */}
        {data && jeepneys.length > 0 && (
          <>
            {/* Direction filter */}
            <div className="pd-dir-filter">
              {[
                { key: "all",            label: "All",                count: total   },
                { key: "MALANDAY-RECTO", label: "Malanday → Recto",   count: countMR },
                { key: "RECTO-MALANDAY", label: "Recto → Malanday",   count: countRM },
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setDirFilter(key)}
                  className={`pd-dir-btn ${dirFilter === key ? "active" : ""}`}
                >
                  {label}
                  <span className="pd-dir-count">{count}</span>
                </button>
              ))}
            </div>

            <p className="pd-hint">Data updates every 5 seconds from conductor devices.</p>

            {filtered.length === 0 ? (
              <div className="pd-empty">
                <div className="pd-empty-icon">🚌</div>
                <h3>No jeepneys in this direction right now</h3>
                <p>Try switching to "All" or check back in a moment.</p>
              </div>
            ) : (
              <div className="pd-cards">
                {filtered.map(j => (
                  <JeepCard key={j.trip_id} j={j} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Stop Zone Map */}
        <StopZoneMap routeId={routeId} />

        {/* Footer */}
        <div className="pd-footer">
          <div className="pd-legend">
            {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
              <span key={key} className="pd-legend-item">
                {cfg.emoji} {cfg.label}
              </span>
            ))}
          </div>
          <p className="pd-footer-note">
            Last checked: {lastPoll ? lastPoll.toLocaleTimeString() : "—"} ·
            Refreshes every 5 seconds ·
            Data from conductor PWA · <strong>RutaSmart 2026</strong>
          </p>
        </div>

      </div>
    </div>
  );
}
