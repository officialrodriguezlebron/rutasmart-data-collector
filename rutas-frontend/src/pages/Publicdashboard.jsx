import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./PublicDashboard.css";

const API     = import.meta.env.VITE_API_URL || "http://localhost:8000";
const POLL_MS = 5000;

// Route config — extend here when new routes are added
const ROUTE_CONFIG = {
  "MR-001": {
    name:    "Malanday – Recto",
    desc:    "MacArthur Highway · Rizal Avenue · 22km",
    stops:   70,
    from:    "Malanday Terminal",
    to:      "Recto LRT",
  },
};

const DEFAULT_ROUTE = "MR-001";

const TIER = {
  AVAILABLE: { label: "Available",   sub: "Seats open!",          emoji: "🟢", color: "#00c853", bg: "#e8f5e9", dark: "#1b5e20" },
  MODERATE:  { label: "Filling Up",  sub: "Getting crowded",      emoji: "🟡", color: "#ffd600", bg: "#fffde7", dark: "#f57f17" },
  FULL:      { label: "Almost Full", sub: "Very limited space",   emoji: "🟠", color: "#ff6d00", bg: "#fff3e0", dark: "#bf360c" },
  OVERCAP:   { label: "Overcrowded", sub: "Wait for next jeepney",emoji: "🔴", color: "#f44336", bg: "#ffebee", dark: "#b71c1c" },
};

const DIR_LABEL = {
  "MALANDAY-RECTO": "Malanday → Recto",
  "RECTO-MALANDAY": "Recto → Malanday",
};

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z")) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function OccupancyBar({ pct, color }) {
  return (
    <div className="pd-bar-track">
      <div className="pd-bar-fill"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

function LiveDot() {
  return (
    <span className="pd-live-wrap">
      <span className="pd-live-ring" />
      <span className="pd-live-core" />
    </span>
  );
}

function JeepCard({ j, idx }) {
  const t   = TIER[j.tier] || TIER.AVAILABLE;
  const dir = DIR_LABEL[j.direction] || j.direction;
  const isOld = j.last_updated &&
    // eslint-disable-next-line react-hooks/purity
    ((Date.now() - new Date(j.last_updated.endsWith("Z") ? j.last_updated : j.last_updated + "Z")) > 30000);

  return (
    <div className="pd-card" style={{ animationDelay: `${idx * 0.06}s` }}>
      <div className="pd-card-stripe" style={{ background: t.color }} />
      <div className="pd-card-inner">

        {/* Top */}
        <div className="pd-card-top">
          <span className="pd-jeep-code">{j.jeep_code}</span>
          <span className="pd-tier-pill" style={{ background: t.bg, color: t.dark }}>
            {t.emoji} {t.label}
          </span>
        </div>

        {/* Direction */}
        <div className="pd-direction">{dir}</div>

        {/* Bar */}
        <OccupancyBar pct={j.occupancy_pct} color={t.color} />

        {/* Count */}
        <div className="pd-count-row">
          <div>
            <span className="pd-count-big" style={{ color: t.dark }}>
              {j.occupancy}
            </span>
            <span className="pd-count-small">/{j.capacity} passengers</span>
            {j.occupancy > j.capacity && (
              <span className="pd-over-badge">+{j.occupancy - j.capacity} over</span>
            )}
          </div>
          <span className="pd-pct" style={{ color: t.dark }}>
            {j.occupancy_pct.toFixed(0)}%
          </span>
        </div>

        {/* Sub message */}
        <div className="pd-sub" style={{ color: t.dark }}>{t.sub}</div>

        {/* Meta */}
        <div className="pd-meta">
          <span>📡 {j.gps_quality}</span>
          <span style={{ color: isOld ? "#e65100" : undefined }}>
            🕐 {timeAgo(j.last_updated)}
            {isOld && " ⚠️"}
          </span>
        </div>

      </div>
    </div>
  );
}

export default function PublicDashboard() {
  const { routeId }   = useParams();
  const navigate      = useNavigate();
  const activeRoute   = routeId || DEFAULT_ROUTE;
  const routeInfo     = ROUTE_CONFIG[activeRoute];

  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [countdown, setCountdown] = useState(POLL_MS / 1000);
  const timerRef  = useRef(null);
  const countRef  = useRef(null);

  // If unknown route, redirect to default
  useEffect(() => {
    if (routeId && !ROUTE_CONFIG[routeId]) {
      navigate(`/route/${DEFAULT_ROUTE}`, { replace: true });
    }
  }, [routeId, navigate]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/public/route/${activeRoute}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastPoll(new Date());
      setCountdown(POLL_MS / 1000);
    } catch (e) {
      setError(e.message);
    }
  }, [activeRoute]);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // Countdown tick
  useEffect(() => {
    countRef.current = setInterval(() => {
      setCountdown(c => c <= 1 ? POLL_MS / 1000 : c - 1);
    }, 1000);
    return () => clearInterval(countRef.current);
  }, []);

  const jeepneys  = data?.jeepneys || [];
  const available = jeepneys.filter(j => j.tier === "AVAILABLE").length;
  const moderate  = jeepneys.filter(j => j.tier === "MODERATE").length;
  const crowded   = jeepneys.filter(j => j.tier === "FULL" || j.tier === "OVERCAP").length;

  return (
    <div className="pd-page">

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="pd-header">
        <div className="pd-header-glow" />

        <div className="pd-topbar">
          <div>
            <div className="pd-brand">RutaSmart</div>
            <div className="pd-brand-sub">Passenger Dashboard</div>
          </div>
          <div className="pd-live-badge">
            <LiveDot />
            LIVE
          </div>
        </div>

        <div className="pd-route-info">
          <div className="pd-route-chip">
            <span>{activeRoute}</span>
          </div>
          <div className="pd-route-name">
            {routeInfo?.name || activeRoute}
          </div>
          {routeInfo && (
            <div className="pd-route-desc">{routeInfo.desc}</div>
          )}
          {routeInfo && (
            <div className="pd-route-endpoints">
              <span>📍 {routeInfo.from}</span>
              <span className="pd-route-arrow">→</span>
              <span>🏁 {routeInfo.to}</span>
            </div>
          )}
        </div>

        {/* Summary row */}
        <div className="pd-summary">
          {[
            { v: data?.active_count ?? "—", l: "Active",    c: "#90caf9" },
            { v: available,                  l: "Available", c: "#a5d6a7" },
            { v: moderate,                   l: "Moderate",  c: "#fff59d" },
            { v: crowded,                    l: "Crowded",   c: "#ef9a9a" },
          ].map(({ v, l, c }) => (
            <div key={l} className="pd-pill">
              <div className="pd-pill-top" style={{ borderTopColor: c }}></div>
              <div className="pd-pill-val" style={{ color: c }}>{v}</div>
              <div className="pd-pill-lbl">{l}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── MAIN ────────────────────────────────────────────── */}
      <main className="pd-main">

        {/* Refresh bar */}
        <div className="pd-refresh">
          <span>{lastPoll ? `Updated ${timeAgo(lastPoll.toISOString())}` : "Connecting…"}</span>
          <span className="pd-countdown">↻ {countdown}s</span>
        </div>

        {/* Error */}
        {error && (
          <div className="pd-error">
            <span>⚠️</span>
            <div>
              <strong>Connection issue — retrying…</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {!data && !error && (
          <div className="pd-loading">
            <div className="pd-spinner" />
            <p>Connecting to live data…</p>
          </div>
        )}

        {/* Empty */}
        {data && jeepneys.length === 0 && (
          <div className="pd-empty">
            <div className="pd-empty-icon">🚌</div>
            <h3>No Active Jeepneys</h3>
            <p>
              No jeepney is being tracked on this route right now.
              Live data appears here during conductor shifts.
            </p>
            <div className="pd-empty-tip">
              Peak hours: 6–9 AM · 4–7 PM
            </div>
          </div>
        )}

        {/* Cards */}
        {jeepneys.length > 0 && (
          <>
            <p className="pd-cards-label">
              {jeepneys.length} jeepne{jeepneys.length === 1 ? "y" : "ys"} active · sorted by occupancy
            </p>
            <div className="pd-cards">
              {jeepneys.map((j, i) => (
                <JeepCard key={j.trip_id} j={j} idx={i} />
              ))}
            </div>
          </>
        )}

      </main>

      {/* ── LEGEND ──────────────────────────────────────────── */}
      <section className="pd-legend">
        <div className="pd-legend-title">Occupancy Guide</div>
        <div className="pd-legend-grid">
          {Object.entries(TIER).map(([key, t]) => (
            <div key={key} className="pd-legend-item"
              style={{ background: t.bg, border: `1.5px solid ${t.color}` }}>
              <span>{t.emoji}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: t.dark }}>{t.label}</div>
                <div style={{ fontSize: 10, color: "#888" }}>{t.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="pd-footer">
        <p>Data collected by conductors via RutaSmart PWA</p>
        <p>Updates every 5 seconds · No login required</p>
        <p><strong>RutaSmart · Devion · FEU-IT · 2026</strong></p>
      </footer>

    </div>
  );
}
