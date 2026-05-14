import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import "./PublicDashboard.css";

const API      = import.meta.env.VITE_API_URL || "http://localhost:8000";
const POLL_MS  = 5000;
const ROUTE_ID = "MR-001";

const TIER = {
  AVAILABLE: {
    label: "Available",
    sub:   "Seats open — hop in!",
    emoji: "🟢",
    color: "#00c853",
    bg:    "#e8f5e9",
    dark:  "#1b5e20",
    glow:  "rgba(0,200,83,0.25)",
  },
  MODERATE: {
    label: "Filling Up",
    sub:   "Getting crowded",
    emoji: "🟡",
    color: "#ffd600",
    bg:    "#fffde7",
    dark:  "#f57f17",
    glow:  "rgba(255,214,0,0.25)",
  },
  FULL: {
    label: "Almost Full",
    sub:   "Limited space left",
    emoji: "🟠",
    color: "#ff6d00",
    bg:    "#fff3e0",
    dark:  "#bf360c",
    glow:  "rgba(255,109,0,0.25)",
  },
  OVERCAP: {
    label: "Overcrowded",
    sub:   "Wait for next jeep",
    emoji: "🔴",
    color: "#f44336",
    bg:    "#ffebee",
    dark:  "#b71c1c",
    glow:  "rgba(244,67,54,0.3)",
  },
};

const DIR = {
  "MALANDAY-RECTO": { from: "Malanday", to: "Recto LRT",  arrow: "→" },
  "RECTO-MALANDAY": { from: "Recto LRT", to: "Malanday", arrow: "→" },
};

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z")) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

function OccBar({ pct, color }) {
  return (
    <div className="pd2-bar-track">
      <div className="pd2-bar-fill"
        style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function JeepCard({ j, idx }) {
  const t   = TIER[j.tier] || TIER.AVAILABLE;
  const dir = DIR[j.direction];
  return (
    <div className="pd2-card"
      style={{
        "--card-color": t.color,
        "--card-glow":  t.glow,
        animationDelay: `${idx * 0.07}s`,
      }}>

      {/* Left accent bar */}
      <div className="pd2-card-accent" style={{ background: t.color }} />

      <div className="pd2-card-body">

        {/* Top row */}
        <div className="pd2-card-top">
          <div className="pd2-jeep-code">{j.jeep_code}</div>
          <div className="pd2-tier-pill"
            style={{ background: t.bg, color: t.dark }}>
            {t.emoji} {t.label}
          </div>
        </div>

        {/* Direction */}
        {dir && (
          <div className="pd2-direction">
            <span className="pd2-dir-from">{dir.from}</span>
            <span className="pd2-dir-arrow">{dir.arrow}</span>
            <span className="pd2-dir-to">{dir.to}</span>
          </div>
        )}

        {/* Occupancy bar */}
        <OccBar pct={j.occupancy_pct} color={t.color} />

        {/* Count row */}
        <div className="pd2-count-row">
          <div className="pd2-count-left">
            <span className="pd2-count-num" style={{ color: t.dark }}>
              {j.occupancy}
            </span>
            <span className="pd2-count-cap">/{j.capacity}</span>
            <span className="pd2-count-label"> passengers</span>
            {j.occupancy > j.capacity && (
              <span className="pd2-overcap-flag">
                +{j.occupancy - j.capacity} over
              </span>
            )}
          </div>
          <div className="pd2-pct" style={{ color: t.dark }}>
            {j.occupancy_pct.toFixed(0)}%
          </div>
        </div>

        {/* Sub-label */}
        <div className="pd2-sub" style={{ color: t.dark }}>{t.sub}</div>

        {/* Meta */}
        <div className="pd2-meta">
          <span>📡 {j.gps_quality}</span>
          <span>🕐 {timeAgo(j.last_updated)}</span>
        </div>

      </div>
    </div>
  );
}

function PulsingDot() {
  return (
    <span className="pd2-dot-wrap">
      <span className="pd2-dot-ring" />
      <span className="pd2-dot-core" />
    </span>
  );
}

export default function PublicDashboard() {
  const { routeId = ROUTE_ID } = useParams();
  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [tick,      setTick]      = useState(0);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/public/route/${routeId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());
      setError(null);
      setLastPoll(new Date());
    } catch (e) {
      setError(e.message);
    }
  }, [routeId]);

  // Poll every 5 seconds
  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // Countdown tick every second
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % (POLL_MS / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const jeepneys  = data?.jeepneys || [];
  const available = jeepneys.filter(j => j.tier === "AVAILABLE").length;
  const moderate  = jeepneys.filter(j => j.tier === "MODERATE").length;
  const full      = jeepneys.filter(j => j.tier === "FULL" || j.tier === "OVERCAP").length;
  const secToNext = POLL_MS / 1000 - (tick % (POLL_MS / 1000));

  return (
    <div className="pd2-page">

      {/* ── HERO HEADER ─────────────────────────────────────────────── */}
      <header className="pd2-header">
        <div className="pd2-header-bg" />

        <div className="pd2-header-content">
          <div className="pd2-brand">
            <span className="pd2-brand-name">RutaSmart</span>
            <span className="pd2-brand-tag">Passenger View</span>
          </div>

          <div className="pd2-live-badge">
            <PulsingDot />
            <span>LIVE</span>
          </div>
        </div>

        <div className="pd2-route-label">
          <div className="pd2-route-chip">
            <span className="pd2-route-id">{routeId}</span>
          </div>
          <div className="pd2-route-name">
            Malanday — Recto Corridor
          </div>
          <div className="pd2-route-sub">
            MacArthur Highway · Rizal Avenue · 22km
          </div>
        </div>

        {/* Summary pills */}
        <div className="pd2-summary">
          {[
            { v: data?.active_count ?? "—", l: "Active",    c: "#90caf9" },
            { v: available,                  l: "Available", c: "#a5d6a7" },
            { v: moderate,                   l: "Moderate",  c: "#fff59d" },
            { v: full,                       l: "Full",      c: "#ef9a9a" },
          ].map(({ v, l, c }) => (
            <div key={l} className="pd2-pill" style={{ "--pill-color": c }}>
              <span className="pd2-pill-val">{v}</span>
              <span className="pd2-pill-lbl">{l}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── CONTENT ─────────────────────────────────────────────────── */}
      <main className="pd2-main">

        {/* Refresh indicator */}
        <div className="pd2-refresh-bar">
          <span>
            {lastPoll ? `Updated ${timeAgo(lastPoll.toISOString())}` : "Loading…"}
          </span>
          <span className="pd2-countdown">
            Next refresh in {secToNext}s
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="pd2-error">
            <span>⚠️</span>
            <div>
              <strong>Connection issue</strong>
              <p>Retrying automatically… ({error})</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {!data && !error && (
          <div className="pd2-loading">
            <div className="pd2-spinner" />
            <p>Connecting to live data…</p>
          </div>
        )}

        {/* Empty state */}
        {data && jeepneys.length === 0 && (
          <div className="pd2-empty">
            <div className="pd2-empty-icon">🚌</div>
            <h3>No Active Jeepneys</h3>
            <p>
              No jeepney is currently being tracked on this route.
              Live status appears here when conductors are using
              the RutaSmart app during their shift.
            </p>
            <div className="pd2-empty-hint">
              Try again during morning or afternoon peak hours
              (6–9 AM · 4–7 PM)
            </div>
          </div>
        )}

        {/* Jeepney cards */}
        {jeepneys.length > 0 && (
          <>
            <p className="pd2-hint">
              Showing {jeepneys.length} active jeepne{jeepneys.length === 1 ? "y" : "ys"} ·
              Sorted by occupancy
            </p>
            <div className="pd2-cards">
              {jeepneys.map((j, i) => (
                <JeepCard key={j.trip_id} j={j} idx={i} />
              ))}
            </div>
          </>
        )}

      </main>

      {/* ── LEGEND ──────────────────────────────────────────────────── */}
      <div className="pd2-legend-section">
        <div className="pd2-legend-title">Occupancy Guide</div>
        <div className="pd2-legend-grid">
          {Object.entries(TIER).map(([key, t]) => (
            <div key={key} className="pd2-legend-item"
              style={{ background: t.bg, borderColor: t.color }}>
              <span className="pd2-legend-emoji">{t.emoji}</span>
              <div>
                <div className="pd2-legend-label" style={{ color: t.dark }}>
                  {t.label}
                </div>
                <div className="pd2-legend-sub">{t.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="pd2-footer">
        <p>Data collected by jeepney conductors via RutaSmart PWA</p>
        <p>Refreshes every 5 seconds · No login required</p>
        <p className="pd2-footer-brand">
          RutaSmart · Devion · FEU Institute of Technology · 2026
        </p>
      </footer>

    </div>
  );
}
