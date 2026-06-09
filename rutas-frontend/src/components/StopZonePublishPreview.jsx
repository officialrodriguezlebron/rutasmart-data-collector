/**
 * StopZonePublishPreview — full-screen comparison modal
 *
 * Shows side-by-side mini Leaflet maps of currently-published stop zones
 * (LIVE) vs. newly-detected clusters (PENDING) so an admin can review
 * both corridors before committing a publish.
 *
 * Review gate: each direction requires 3 seconds of visible review before
 * its publish button activates. "Publish Both" requires both reviewed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CircleMarker, MapContainer, TileLayer, Tooltip, useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  getPublishedStops,
  getStopZonePreview,
  publishStopZones,
} from "../services/api";
import "./StopZonePublishPreview.css";

// ── Constants ─────────────────────────────────────────────────────────────
const TILE_DARK   = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR_DARK   = '&copy; <a href="https://carto.com/">CARTO</a>';
const MAP_CENTER  = [14.66, 120.975];
const MATCH_M     = 60;   // metres — threshold for "same stop"

const DEMAND_COLORS = {
  Normal:   "#30d158",
  Moderate: "#ffd60a",
  High:     "#ff9f0a",
  Critical: "#ff453a",
};

// ── Helpers ───────────────────────────────────────────────────────────────
function haversineM(a, b) {
  const R = 6_371_000, rad = d => d * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  return 2 * R * Math.asin(Math.sqrt(
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(rad(a[0])) * Math.cos(rad(b[0]))
  ));
}

// Normalise lat/lon field name variations from backend responses
const sLat = s => s.centroid_lat ?? s.latitude ?? s.lat ?? 0;
const sLon = s => s.centroid_lon ?? s.longitude ?? s.lon ?? 0;

function computeDiff(published, pending) {
  const matchedPub = new Set();
  const added = [], unchanged = [];

  for (const p of pending) {
    let minD = Infinity, bestIdx = -1;
    published.forEach((pub, i) => {
      const d = haversineM([sLat(p), sLon(p)], [sLat(pub), sLon(pub)]);
      if (d < minD) { minD = d; bestIdx = i; }
    });
    if (minD <= MATCH_M && bestIdx >= 0) {
      matchedPub.add(bestIdx);
      unchanged.push({ pending: p, published: published[bestIdx] });
    } else {
      added.push(p);
    }
  }
  return { added, unchanged, removed: published.filter((_, i) => !matchedPub.has(i)) };
}

// ── Map sync child component ──────────────────────────────────────────────
function MapSyncer({ selfRef, otherRef, isSyncing }) {
  const map = useMap();

  useEffect(() => { selfRef.current = map; }, [map, selfRef]);

  useEffect(() => {
    const onMoveEnd = () => {
      if (isSyncing.current) return;
      const other = otherRef.current;
      if (!other) return;
      isSyncing.current = true;
      other.setView(map.getCenter(), map.getZoom(), { animate: false });
      setTimeout(() => { isSyncing.current = false; }, 80);
    };
    map.on("moveend", onMoveEnd);
    return () => map.off("moveend", onMoveEnd);
  }, [map, otherRef, isSyncing]);

  return null;
}

// ── Mini map column ───────────────────────────────────────────────────────
function MiniMap({ stops, color, selfRef, otherRef, isSyncing }) {
  return (
    <div style={{
      flex: 1, borderRadius: 10, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.09)",
      minHeight: 240,
    }}>
      <MapContainer
        center={MAP_CENTER} zoom={13}
        zoomControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer attribution={ATTR_DARK} url={TILE_DARK} />
        <MapSyncer selfRef={selfRef} otherRef={otherRef} isSyncing={isSyncing} />
        {stops.map((s, i) => {
          const la = sLat(s), lo = sLon(s);
          if (!la || !lo) return null;
          const tc = DEMAND_COLORS[s.demand_tier] || color;
          return (
            <CircleMarker key={i} center={[la, lo]} radius={7}
              pathOptions={{ color: "#fff", fillColor: tc, fillOpacity: 0.88, weight: 1.5 }}
            >
              <Tooltip direction="top">
                {s.name && <><strong>{s.name}</strong><br /></>}
                {s.demand_tier && (
                  <span style={{ color: tc, fontWeight: 700 }}>{s.demand_tier}</span>
                )}
                {s.point_count != null && <> · {s.point_count} pts</>}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ── Review badge (timer / reviewed / not-yet) ─────────────────────────────
function ReviewBadge({ reviewed, isActive, countdown }) {
  if (reviewed) {
    return (
      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#30d158" }}>
        ✓ Reviewed
      </span>
    );
  }
  if (isActive) {
    return (
      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#ffd60a" }}>
        {countdown}s
      </span>
    );
  }
  return (
    <span style={{ marginLeft: 8, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
      Not reviewed
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  Main component
// ══════════════════════════════════════════════════════════════════════════
export default function StopZonePublishPreview({
  routeId = "MR-001",
  onClose,
  onSuccess,
}) {
  const [direction, setDirection] = useState("MALANDAY-RECTO");

  const [data, setData] = useState({
    "MALANDAY-RECTO": { published: [], pending: [], loading: true, error: null },
    "RECTO-MALANDAY": { published: [], pending: [], loading: true, error: null },
  });

  const [forwardReviewed, setForwardReviewed] = useState(false);
  const [returnReviewed,  setReturnReviewed]  = useState(false);
  const [countdown, setCountdown] = useState(3);

  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState(null);  // { msg, ok }

  const leftRef   = useRef(null);
  const rightRef  = useRef(null);
  const isSyncing = useRef(false);
  const timerRef  = useRef(null);

  // ── Load both directions in parallel ────────────────────────────────────
  useEffect(() => {
    ["MALANDAY-RECTO", "RECTO-MALANDAY"].forEach(dir => {
      Promise.all([
        getPublishedStops(routeId, dir).catch(() => ({ data: {} })),
        getStopZonePreview(routeId, dir).catch(() => ({ data: {} })),
      ]).then(([pubRes, pendRes]) => {
        const pubData  = pubRes.data  || {};
        const pendData = pendRes.data || {};
        setData(prev => ({
          ...prev,
          [dir]: {
            published: pubData.stop_zones ?? pubData.stops ?? [],
            pending:   pendData.clusters  ?? pendData.stops ?? [],
            loading:   false,
            error:     null,
          },
        }));
      }).catch(e => {
        setData(prev => ({
          ...prev,
          [dir]: {
            ...prev[dir],
            loading: false,
            error:   e.message || "Failed to load data",
          },
        }));
      });
    });
  }, [routeId]);

  // ── 3-second review timer per direction ──────────────────────────────────
  useEffect(() => {
    const alreadyDone = direction === "MALANDAY-RECTO" ? forwardReviewed : returnReviewed;
    if (alreadyDone) return;

    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(3);
    let c = 3;

    timerRef.current = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(timerRef.current);
        if (direction === "MALANDAY-RECTO") setForwardReviewed(true);
        else setReturnReviewed(true);
      }
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Publish handler ──────────────────────────────────────────────────────
  const handlePublish = useCallback(async (dirs) => {
    setPublishing(true);
    try {
      await Promise.all(dirs.map(d => publishStopZones(routeId, d)));
      const labels = dirs
        .map(d => d === "MALANDAY-RECTO" ? "Forward" : "Return")
        .join(" & ");
      setToast({ msg: `✅ Published stop zones for ${labels}`, ok: true });
      setTimeout(() => { onSuccess?.(); onClose(); }, 2200);
    } catch (e) {
      setToast({
        msg: `❌ ${e.response?.data?.detail || e.message || "Publish failed"}`,
        ok: false,
      });
      setTimeout(() => setToast(null), 4500);
    } finally {
      setPublishing(false);
    }
  }, [routeId, onClose, onSuccess]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const cur  = data[direction];
  const diff = computeDiff(cur.published, cur.pending);
  const removalPct = cur.published.length > 0
    ? diff.removed.length / cur.published.length : 0;
  const bigDrop = removalPct > 0.20 && cur.published.length > 0;

  const handleBackdrop = e => { if (e.target === e.currentTarget) onClose(); };

  return createPortal(
    <div className="szpp-overlay" onClick={handleBackdrop}>
      <div className="szpp-modal">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="szpp-header">
          <div>
            <h2 className="szpp-title">Stop Zone Publishing Preview</h2>
            <p className="szpp-subtitle">
              Compare newly-detected clusters with what is currently live
              before pushing to the passenger map.
            </p>
          </div>
          <button className="szpp-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* ── Direction toggle ─────────────────────────────────────────── */}
        <div className="szpp-dir-row">
          {[
            { val: "MALANDAY-RECTO", label: "Forward" },
            { val: "RECTO-MALANDAY", label: "Return"  },
          ].map(({ val, label }) => {
            const isActive  = direction === val;
            const reviewed  = val === "MALANDAY-RECTO" ? forwardReviewed : returnReviewed;
            return (
              <button
                key={val}
                className={`szpp-dir-btn ${isActive ? "active" : ""}`}
                onClick={() => setDirection(val)}
              >
                {label}
                <ReviewBadge
                  reviewed={reviewed}
                  isActive={isActive && !reviewed}
                  countdown={countdown}
                />
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.30)" }}>
            Review each direction for 3 s to unlock publish
          </span>
        </div>

        {/* ── Two-column map view ──────────────────────────────────────── */}
        {cur.loading ? (
          <div className="szpp-loading">
            <div className="szpp-spinner" />
            <span>Loading stop data…</span>
          </div>
        ) : cur.error ? (
          <div className="szpp-error">⚠️ {cur.error}</div>
        ) : (
          <div className="szpp-columns">

            {/* Left: Currently Published (LIVE) */}
            <div className="szpp-col">
              <div className="szpp-col-head">
                <span className="szpp-badge szpp-badge-live">LIVE</span>
                <span className="szpp-col-title">Currently Published</span>
                <span className="szpp-col-count">{cur.published.length} stops</span>
              </div>
              <MiniMap
                stops={cur.published}
                color="#30d158"
                selfRef={leftRef}
                otherRef={rightRef}
                isSyncing={isSyncing}
              />
              <div className="szpp-col-footer">
                {diff.removed.length > 0 && (
                  <span style={{ color: "#ff453a" }}>
                    −{diff.removed.length} will be removed
                  </span>
                )}
                {diff.unchanged.length > 0 && (
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>
                    {diff.unchanged.length} unchanged
                  </span>
                )}
              </div>
            </div>

            {/* Centre: diff summary */}
            <div className="szpp-diff-col">
              <div className="szpp-diff-item szpp-diff-added">
                <span className="szpp-diff-num">+{diff.added.length}</span>
                <span>added</span>
              </div>
              <div className="szpp-diff-item szpp-diff-removed">
                <span className="szpp-diff-num">−{diff.removed.length}</span>
                <span>removed</span>
              </div>
              <div className="szpp-diff-item szpp-diff-same">
                <span className="szpp-diff-num">{diff.unchanged.length}</span>
                <span>same</span>
              </div>
            </div>

            {/* Right: Newly Detected (PENDING) */}
            <div className="szpp-col">
              <div className="szpp-col-head">
                <span className="szpp-badge szpp-badge-pending">PENDING</span>
                <span className="szpp-col-title">Newly Detected</span>
                <span className="szpp-col-count">{cur.pending.length} clusters</span>
              </div>
              <MiniMap
                stops={cur.pending}
                color="#ffd60a"
                selfRef={rightRef}
                otherRef={leftRef}
                isSyncing={isSyncing}
              />
              <div className="szpp-col-footer">
                {diff.added.length > 0 && (
                  <span style={{ color: "#30d158" }}>
                    +{diff.added.length} new clusters
                  </span>
                )}
                {cur.pending.length === 0 && (
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>
                    No clusters detected yet
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Warning banners ─────────────────────────────────────────── */}
        {bigDrop && (
          <div className="szpp-banner szpp-banner-warn">
            ⚠️{" "}
            <strong>
              Large reduction: {diff.removed.length} of {cur.published.length} published stops
              will be removed ({(removalPct * 100).toFixed(0)}%).
            </strong>{" "}
            Verify the new DBSCAN data is correct before publishing.
          </div>
        )}
        {!cur.loading && cur.pending.length === 0 && !cur.error && (
          <div className="szpp-banner szpp-banner-info">
            ℹ️ No clusters detected for{" "}
            <strong>
              {direction === "MALANDAY-RECTO"
                ? "Malanday → Recto"
                : "Recto → Malanday"}
            </strong>
            . Ensure completed trips with GOOD GPS logs exist for this corridor.
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="szpp-footer">
          <button
            className="szpp-btn szpp-btn-cancel"
            onClick={onClose}
            disabled={publishing}
          >
            Cancel
          </button>

          <div style={{ flex: 1 }} />

          <button
            className="szpp-btn szpp-btn-dir"
            disabled={!forwardReviewed || publishing}
            onClick={() => handlePublish(["MALANDAY-RECTO"])}
            title={!forwardReviewed
              ? "Switch to Forward and wait 3 s to review"
              : "Publish Malanday → Recto stop zones"}
          >
            📤 Publish Forward
          </button>

          <button
            className="szpp-btn szpp-btn-dir"
            disabled={!returnReviewed || publishing}
            onClick={() => handlePublish(["RECTO-MALANDAY"])}
            title={!returnReviewed
              ? "Switch to Return and wait 3 s to review"
              : "Publish Recto → Malanday stop zones"}
          >
            📤 Publish Return
          </button>

          <button
            className="szpp-btn szpp-btn-both"
            disabled={!forwardReviewed || !returnReviewed || publishing}
            onClick={() => handlePublish(["MALANDAY-RECTO", "RECTO-MALANDAY"])}
          >
            {publishing ? "Publishing…" : "📤 Publish Both"}
          </button>
        </div>

      </div>

      {/* ── Toast notification ───────────────────────────────────────────── */}
      {toast && (
        <div className={`szpp-toast ${toast.ok ? "szpp-toast-ok" : "szpp-toast-err"}`}>
          {toast.msg}
        </div>
      )}
    </div>,
    document.body
  );
}
