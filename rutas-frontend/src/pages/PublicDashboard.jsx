import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import "./PublicDashboard.css";
import StopZoneMap from "./StopZoneMap";

const API     = import.meta.env.VITE_API_URL;
const POLL_MS = 5000;

const TIER_CONFIG = {
  AVAILABLE: { label:"Available",   emoji:"🟢", bg:"#e8f5e9", border:"#2e7d32", text:"#1b5e20", bar:"#2e7d32" },
  MODERATE:  { label:"Filling Up",  emoji:"🟡", bg:"#fffde7", border:"#f9a825", text:"#e65100", bar:"#f9a825" },
  FULL:      { label:"Almost Full", emoji:"🟠", bg:"#fff3e0", border:"#ef6c00", text:"#bf360c", bar:"#ef6c00" },
  OVERCAP:   { label:"OVERCROWDED", emoji:"🔴", bg:"#ffebee", border:"#c62828", text:"#b71c1c", bar:"#c62828" },
};

const DIR_LABEL = {
  "MALANDAY-RECTO": "Malanday → Recto",
  "RECTO-MALANDAY": "Recto → Malanday",
};

function timeAgo(isoStr) {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z")) / 1000);
  if (diff < 5)    return "just now";
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function OccBar({ pct, color }) {
  return (
    <div style={{ background:"rgba(0,0,0,0.08)", borderRadius:99, height:7, overflow:"hidden", margin:"6px 0" }}>
      <div style={{ width:`${Math.min(100, pct)}%`, height:"100%", background:color, borderRadius:99, transition:"width .5s ease" }}/>
    </div>
  );
}

function JeepCard({ j }) {
  const cfg = TIER_CONFIG[j.tier] || TIER_CONFIG.AVAILABLE;
  return (
    <div className="pd-jeep-card" style={{ borderLeft:`5px solid ${cfg.border}`, background:cfg.bg }}>
      <div className="pd-jeep-header">
        <div className="pd-jeep-code">{j.jeep_code}</div>
        <div className="pd-tier-badge" style={{ background:cfg.border, color:"#fff" }}>
          {cfg.emoji} {cfg.label}
        </div>
      </div>
      <div className="pd-jeep-direction">{DIR_LABEL[j.direction] || j.direction}</div>
      <div style={{ padding:"0 16px" }}>
        <OccBar pct={j.occupancy_pct} color={cfg.bar} />
      </div>
      <div className="pd-jeep-counts">
        <strong style={{ color:cfg.text }}>{j.occupancy}</strong>
        <span>/ {j.capacity} passengers
          {j.occupancy > j.capacity &&
            <span style={{ color:"#c62828", fontWeight:700 }}> (+{j.occupancy - j.capacity} over)</span>}
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
      setData(await res.json());
      setError(null);
      setLastPoll(new Date());
    } catch (e) { setError(e.message); }
  }, [routeId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  const jeepneys  = data?.jeepneys || [];
  const filtered  = dirFilter === "all" ? jeepneys : jeepneys.filter(j => j.direction === dirFilter);
  const total     = jeepneys.length;
  const countMR   = jeepneys.filter(j => j.direction === "MALANDAY-RECTO").length;
  const countRM   = jeepneys.filter(j => j.direction === "RECTO-MALANDAY").length;
  const available = jeepneys.filter(j => j.tier === "AVAILABLE").length;
  const filling   = jeepneys.filter(j => j.tier === "MODERATE" || j.tier === "FULL").length;
  const overcrowd = jeepneys.filter(j => j.tier === "OVERCAP").length;
  const staleCount = jeepneys.filter(j => {
    if (!j.last_updated) return false;
    return (Date.now() - new Date(j.last_updated.endsWith("Z") ? j.last_updated : j.last_updated + "Z")) / 1000 > 7200;
  }).length;

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
            <div className="pd-live-dot">
              <span className="pd-live-ring"/>
              LIVE
            </div>
            <a href="/" style={{ fontSize:11, color:"rgba(255,255,255,0.50)", textDecoration:"none", fontWeight:600 }}>
              ⌂ Home
            </a>
          </div>
        </div>

        {/* Stats strip */}
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
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="pd-content">

        {/* Stale warning */}
        {staleCount > 0 && (
          <div style={{ background:"rgba(255,159,10,0.12)", border:"1px solid rgba(255,159,10,0.30)",
            borderRadius:12, padding:"10px 14px", fontSize:12, color:"#ffd60a", fontWeight:600 }}>
            ⚠ {staleCount} jeepney{staleCount > 1 ? "s" : ""} hidden — no update in over 2 hours
          </div>
        )}

        {/* Where to Board button — always visible near top */}
        <StopZoneMap routeId={routeId} preferredDirection={dirFilter !== "all" ? dirFilter : null} />

        {/* Error */}
        {error && (
          <div className="pd-error">
            ⚠️ Could not reach server — retrying…
            <br/><small style={{ opacity:0.7 }}>{error}</small>
          </div>
        )}

        {/* Loading */}
        {!data && !error && (
          <div className="pd-loading">
            <div className="pd-spinner"/>
            <p style={{ margin:0, fontSize:13, color:"rgba(255,255,255,0.50)" }}>Loading live data…</p>
          </div>
        )}

        {/* Empty */}
        {data && jeepneys.length === 0 && (
          <div className="pd-empty">
            <span className="pd-empty-icon">🚌</span>
            <h3>No active jeepneys right now</h3>
            <p>No conductor is currently recording a trip on this route.<br/>
              Data appears here when conductors use the RutaSmart app.</p>
          </div>
        )}

        {/* Jeepney cards */}
        {data && jeepneys.length > 0 && (<>
          <div className="pd-dir-filter" style={{ padding:0 }}>
            {[
              { key:"all",            label:"All",               count:total   },
              { key:"MALANDAY-RECTO", label:"Malanday → Recto",  count:countMR },
              { key:"RECTO-MALANDAY", label:"Recto → Malanday",  count:countRM },
            ].map(({ key, label, count }) => (
              <button key={key} onClick={() => setDirFilter(key)}
                className={`pd-dir-btn ${dirFilter === key ? "active" : ""}`}>
                {label}
                <span className="pd-dir-count">{count}</span>
              </button>
            ))}
          </div>

          <p className="pd-hint">Data updates every 5 seconds from conductor devices.</p>

          {filtered.length === 0 ? (
            <div className="pd-empty" style={{ padding:"32px 20px" }}>
              <span className="pd-empty-icon" style={{ fontSize:36 }}>🚌</span>
              <h3>No jeepneys in this direction</h3>
              <p>Try switching to "All".</p>
            </div>
          ) : (
            <div className="pd-cards">
              {filtered.map(j => <JeepCard key={j.trip_id} j={j} />)}
            </div>
          )}
        </>)}

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
