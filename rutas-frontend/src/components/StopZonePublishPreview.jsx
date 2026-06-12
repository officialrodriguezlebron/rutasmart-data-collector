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

// Ground truth stops — 70 field-verified stops (mirrors cluster_evaluation.py::GROUND_TRUTH_STOPS)
const GT_STOPS = [
  [14.7187,120.957,"MacArthur / Woodlands Drive"],[14.7183,120.957,"MacArthur / Del Pilar, Malanday"],
  [14.718,120.957,"Malanday Terminal"],[14.7173,120.957,"Mercury Drug Malanday"],
  [14.7155,120.958,"Marisyl School"],[14.7122,120.959,"MacArthur Hwy, Dalandanan"],
  [14.7093,120.96,"MacArthur / Santiago Road"],[14.7085,120.96,"Ign Pharmacy"],
  [14.7041,120.961,"Dalandanan Fire Sub-Station"],[14.7036,120.962,"Dalandanan Health Centre"],
  [14.7022,120.962,"Santos Encarnacion Elem"],[14.7013,120.962,"Iglesia ni Cristo"],
  [14.6988,120.963,"Galdrine Industrial Corp"],[14.697,120.964,"MacArthur / San Miguel"],
  [14.6956,120.964,"Parish Church San Isidro"],[14.6929,120.964,"Jollibee Malinta"],
  [14.6925,120.965,"Malinta Elementary School"],[14.6928,120.966,"MacArthur / Maysan Road"],
  [14.6928,120.969,"Flying V Gas"],[14.6922,120.971,"South Supermarket"],
  [14.6911,120.973,"Bureau of Telecom Training Institute"],[14.6899,120.974,"Karuhatan Public Market"],
  [14.6886,120.975,"Macro LPG"],[14.6877,120.975,"MacArthur / San Francisco"],
  [14.6862,120.976,"SM Center Valenzuela"],[14.6852,120.977,"MacArthur / Cayetano"],
  [14.6837,120.978,"Novo Dep. Store"],[14.6815,120.979,"Bread of Life"],
  [14.6779,120.98,"OLFU / Fatima University"],[14.6749,120.981,"Bearsea Auto Supply"],
  [14.6732,120.982,"Calalang General Hospital"],[14.67,120.982,"CDC Manufacturing"],
  [14.6677,120.982,"MacArthur / Del Monte"],[14.665,120.984,"Malabon / Victoneta Ave"],
  [14.663,120.984,"Potrero Heights Elem School"],[14.6617,120.984,"MacArthur / Lanzones"],
  [14.6601,120.984,"Floresco North Mortuary"],[14.6576,120.984,"Bonifacio Market"],
  [14.6571,120.984,"Araneta Square Mall"],[14.6564,120.984,"Monumento"],
  [14.6556,120.984,"Ever Gotesco Grand Central"],[14.6538,120.984,"McDonalds Rizal Ave"],
  [14.6516,120.984,"Rizal Ave / Asistio"],[14.6488,120.984,"Rizal Ave / 8th Ave West"],
  [14.6462,120.984,"Asia Trust Bank"],[14.6445,120.984,"CR3 / M.H. Del Pilar"],
  [14.6412,120.984,"Banco De Oro Rizal Ave"],[14.64,120.984,"Baliwag Transit Bus Station"],
  [14.6374,120.983,"Rizal Ave / Road 1"],[14.6362,120.982,"LRT R. Papa Station"],
  [14.6334,120.981,"P. Sevilla / 2nd Ave West"],[14.632,120.981,"Rizal Ave / Jose Abad Santos"],
  [14.6304,120.98,"Jose Abad Santos / Morong"],[14.629,120.979,"Jose Abad Santos / Corregidor"],
  [14.6275,120.979,"Jose Abad Santos Ave"],[14.6257,120.979,"Jose Abad Santos / T. Bugallon"],
  [14.6256,120.98,"T. Bugallon Street"],[14.6243,120.981,"T. Bugallon / Cavite"],
  [14.623,120.982,"T. Mapua / New Antipolo"],[14.6219,120.982,"T. Mapua / Laguna"],
  [14.6206,120.982,"Tomas Mapua / Batangas"],[14.6147,120.985,"Felix Huertas Manila"],
  [14.613,120.984,"Quiricada / Felix Huertas"],[14.6115,120.984,"Felix Huertas 2"],
  [14.6092,120.984,"Felix Huertas 3"],[14.6076,120.984,"Sulu Manila"],
  [14.6073,120.986,"Quezon Blvd / P. Paredes"],[14.6048,120.985,"España Blvd / Quezon Blvd"],
  [14.6031,120.985,"Claro M. Recto Ave / Quezon Blvd"],[14.6037,120.983,"Recto LRT"],
];

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

        {/* Ground truth stops — gray outline, always rendered for alignment reference */}
        {GT_STOPS.map(([la, lo, name], i) => (
          <CircleMarker key={`gt-${i}`} center={[la, lo]} radius={4}
            pathOptions={{ color: "#8e8e93", fillColor: "#8e8e93", fillOpacity: 0.55, weight: 1 }}
          >
            <Tooltip direction="top" sticky>
              <span style={{ fontSize: 11 }}>{name}</span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Published / pending cluster stops — demand-colored, on top */}
        {stops.map((s, i) => {
          const la = sLat(s), lo = sLon(s);
          if (!la || !lo) return null;
          const tc = DEMAND_COLORS[s.demand_tier] || color;
          return (
            <CircleMarker key={`s-${i}`} center={[la, lo]} radius={7}
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

        {/* ── Point-type legend ───────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          padding: "5px 12px", background: "rgba(0,0,0,0.25)",
          borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11,
          color: "rgba(255,255,255,0.50)",
        }}>
          {[
            { color: "#8e8e93", label: "Ground Truth (70 stops)", fill: true },
            { color: "#ffd60a", label: "DBSCAN Cluster (pending)", fill: true },
            { color: "#30d158", label: "Published (by demand)", fill: true },
          ].map(({ color, label, fill }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                background: fill ? color : "transparent",
                border: `1.5px solid ${color}`,
                display: "inline-block",
              }} />
              {label}
            </span>
          ))}
          <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.25)" }}>
            Raw GPS not shown
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
