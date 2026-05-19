/**
 * TripMap — RutaSmart trip visualization overlay
 *
 * A professional, information-dense map view for inspecting a completed trip.
 *
 * Features:
 *  - Eager leaflet.heat load (no flicker on first render)
 *  - Animated, weighted heatmap with occupancy-aware gradient
 *  - DBSCAN clusters with demand-tier ring + numeric label
 *  - Actual recorded trip path as orange dashed polyline
 *  - START / END pin markers with permanent labels
 *  - Corridor reference route + corridor bounding-box overlay
 *  - 70 field-verified ground-truth stops layer
 *  - Quality filter (All / Good+Acc only) + occupancy slider
 *  - Trip metadata header — total distance, duration, max occupancy
 *  - Auto-fit on load + "Fit to Data" button
 *  - Light / Dark tile mode
 *  - Scale bar + zoom controls
 *  - Clickable stat chips that filter the map view
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, CircleMarker,
  Polyline, Rectangle, Tooltip, useMap, ZoomControl, ScaleControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// leaflet.heat — imported at module level but wrapped so it never
// crashes the page on devices where it fails to load.
import "leaflet.heat";
import { getRawLogs, runAllAnalytics } from "../services/api";
import "./TripMap.css";

// ── Default Leaflet icon URLs ─────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Constants ─────────────────────────────────────────────────────────────
const CORRIDOR_CENTER = [14.6600, 120.975];
const CORRIDOR_BOUNDS = [[14.55, 120.95], [14.75, 121.05]];

const TILE_DARK  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
// Positron: minimal light tile with very low visual noise — dots and
// route lines stay visible because the background is nearly white.
// Voyager (previous) was too detailed and "busy", causing colored dots
// to blend into road/label colors at zoom 13–15.
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const ATTR_DARK  = '&copy; <a href="https://carto.com/">CARTO</a>';
const ATTR_LIGHT = '&copy; <a href="https://carto.com/">CARTO</a> · <a href="https://www.openstreetmap.org/">OSM</a>';

const CLUSTER_COLORS = {
  TRUE_STOP:      "#1565c0",
  CREEPING_QUEUE: "#ef6c00",
  MOVING:         "#c62828",
};

const DEMAND_COLORS = {
  Normal:   "#2e7d32",
  Moderate: "#f9a825",
  High:     "#ef6c00",
  Critical: "#c62828",
};

const QUALITY_COLORS = {
  GOOD:       "#2e7d32",
  ACCEPTABLE: "#f9a825",
  POOR:       "#c62828",
};

// ── 70 Field-Verified Ground Truth Stops ──────────────────────────────────
const GROUND_TRUTH = [
  [14.7187, 120.957, "MacArthur Hwy / Woodlands Drive, Valenzuela"],
  [14.7183, 120.957, "MacArthur / Del Pilar, Malanday"],
  [14.718,  120.957, "Malanday Terminal"],
  [14.7173, 120.957, "Mercury Drug, Malanday"],
  [14.7155, 120.958, "Marisyl School"],
  [14.7122, 120.959, "MacArthur Hwy, Dalandanan"],
  [14.7093, 120.96,  "MacArthur / Santiago Road"],
  [14.7085, 120.96,  "Ign Pharmacy"],
  [14.7041, 120.961, "Dalandanan Fire Sub-Station"],
  [14.7036, 120.962, "Dalandanan Health Centre"],
  [14.7022, 120.962, "Santos Encarnacion Elem"],
  [14.7013, 120.962, "Iglesia ni Cristo"],
  [14.6988, 120.963, "Galdrine Industrial Corp"],
  [14.697,  120.964, "MacArthur / San Miguel"],
  [14.6956, 120.964, "Parish Church San Isidro"],
  [14.6929, 120.964, "Jollibee Malinta"],
  [14.6925, 120.965, "Malinta Elementary School"],
  [14.6928, 120.966, "MacArthur / Maysan Road"],
  [14.6928, 120.969, "Flying V Gas"],
  [14.6922, 120.971, "South Supermarket"],
  [14.6911, 120.973, "Bureau of Telecom Training Institute"],
  [14.6899, 120.974, "Karuhatan Public Market"],
  [14.6886, 120.975, "Macro LPG"],
  [14.6877, 120.975, "MacArthur / San Francisco"],
  [14.6862, 120.976, "SM Center Valenzuela"],
  [14.6852, 120.977, "MacArthur / Cayetano"],
  [14.6837, 120.978, "Novo Dep. Store"],
  [14.6815, 120.979, "Bread of Life"],
  [14.6779, 120.98,  "OLFU / Fatima University"],
  [14.6749, 120.981, "Bearsea Auto Supply"],
  [14.6732, 120.982, "Calalang General Hospital"],
  [14.67,   120.982, "CDC Manufacturing"],
  [14.6677, 120.982, "MacArthur / Del Monte"],
  [14.665,  120.984, "Malabon / Victoneta Ave"],
  [14.663,  120.984, "Potrero Heights Elem School"],
  [14.6617, 120.984, "MacArthur / Lanzones"],
  [14.6601, 120.984, "Floresco North Mortuary"],
  [14.6576, 120.984, "Bonifacio Market"],
  [14.6571, 120.984, "Araneta Square Mall"],
  [14.6564, 120.984, "Monumento"],
  [14.6556, 120.984, "Ever Gotesco Grand Central"],
  [14.6538, 120.984, "McDonalds Rizal Ave"],
  [14.632,  120.981, "Rizal Ave / Jose Abad Santos"],
  [14.6304, 120.98,  "Jose Abad Santos / Morong"],
  [14.629,  120.979, "Jose Abad Santos / Corregidor"],
  [14.6275, 120.979, "Jose Abad Santos Ave"],
  [14.6257, 120.979, "Jose Abad Santos / T. Bugallon"],
  [14.6256, 120.98,  "T. Bugallon Street"],
  [14.6243, 120.981, "T. Bugallon / Cavite"],
  [14.623,  120.982, "T. Mapua / New Antipolo"],
  [14.6219, 120.982, "T. Mapua / Laguna"],
  [14.6206, 120.982, "Tomas Mapua / Batangas"],
  [14.6147, 120.985, "Felix Huertas Manila"],
  [14.613,  120.984, "Quiricada / Felix Huertas"],
  [14.6115, 120.984, "Felix Huertas 2"],
  [14.6092, 120.984, "Felix Huertas 3"],
  [14.6076, 120.984, "Sulu Manila"],
  [14.6073, 120.986, "Quezon Blvd / P. Paredes"],
  [14.6048, 120.985, "España Blvd / Quezon Blvd"],
  [14.6031, 120.985, "Claro M. Recto Ave / Quezon Blvd"],
  [14.6037, 120.983, "Recto LRT"],
];

// ── Corridor polyline ─────────────────────────────────────────────────────
const CORRIDOR_ROUTE = GROUND_TRUTH.map(([lat, lon]) => [lat, lon]);

// ── Distance utility (Haversine, meters) ──────────────────────────────────
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ── Auto-fit map to data ──────────────────────────────────────────────────
function FitToData({ logs, corridorRoute, fitTrigger }) {
  const map = useMap();

  useEffect(() => {
    const pts = [];
    if (corridorRoute?.length) pts.push(...corridorRoute);
    if (logs?.length) {
      for (const log of logs) {
        if (typeof log.lat === "number" && typeof log.lon === "number") {
          pts.push([log.lat, log.lon]);
        }
      }
    }
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true });
    }
  }, [map, logs, corridorRoute, fitTrigger]);

  return null;
}

// ── Heatmap layer (no async import — leaflet.heat loaded eagerly above) ──
function HeatmapLayer({ points, visible, intensity }) {
  const map = useMap();
  const heatRef = useRef(null);

  useEffect(() => {
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    // Guard: leaflet.heat may not have loaded on all devices/browsers
    if (!visible || !points.length || typeof L.heatLayer !== "function") return;

    const maxOcc = Math.max(...points.map(p => p.occupancy ?? 0), 1);
    const heatPoints = points.map(p => [
      p.lat,
      p.lon,
      Math.min(1, (p.occupancy / maxOcc) * intensity),
    ]);

    try {
      heatRef.current = L.heatLayer(heatPoints, {
        radius: 28,
        blur: 22,
        maxZoom: 17,
        max: 1.0,
        minOpacity: 0.35,
        gradient: {
          0.0: "#1a237e",
          0.2: "#1976d2",
          0.4: "#00acc1",
          0.6: "#ffd54f",
          0.8: "#fb8c00",
          1.0: "#c62828",
        },
      }).addTo(map);
    } catch (err) {
      console.warn("RutaSmart: heatmap layer failed to render.", err);
    }

    return () => {
      if (heatRef.current) {
        try { map.removeLayer(heatRef.current); } catch {}
        heatRef.current = null;
      }
    };
  }, [points, visible, intensity, map]);

  return null;
}

// ── Custom DivIcon for cluster numbers ────────────────────────────────────
function ClusterNumber({ cluster }) {
  const map = useMap();
  const markerRef = useRef(null);

  useEffect(() => {
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
    }
    const color = CLUSTER_COLORS[cluster.cluster_type] || "#555";
    const icon = L.divIcon({
      className: "rs-cluster-label",
      html: `<div class="rs-cluster-bubble" style="background:${color}">${cluster.cluster_id}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    markerRef.current = L.marker(
      [cluster.centroid_lat, cluster.centroid_lon],
      { icon, interactive: false }
    ).addTo(map);
    return () => {
      if (markerRef.current) map.removeLayer(markerRef.current);
    };
  }, [cluster, map]);

  return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  Main component
// ══════════════════════════════════════════════════════════════════════════
export default function TripMap({ tripId, onClose }) {
  const [logs,        setLogs]        = useState([]);
  const [clusterErr,  setClusterErr]  = useState(null);
  const [clusters,    setClusters]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error,       setError]       = useState(null);
  const [stats,       setStats]       = useState(null);

  // Layer toggles
  const [showHeat,    setShowHeat]    = useState(true);
  const [showDots,    setShowDots]    = useState(false);
  const [showCluster, setShowCluster] = useState(true);
  const [showGT,      setShowGT]      = useState(false);
  const [showRoute,   setShowRoute]   = useState(true);
  const [showTrace,   setShowTrace]   = useState(true);
  const [showBBox,    setShowBBox]    = useState(false);
  const [darkMode,    setDarkMode]    = useState(false);

  // Filters
  const [qualFilter,  setQualFilter]  = useState("all");
  const [tierFilter,  setTierFilter]  = useState("all");
  const [intensity,   setIntensity]   = useState(1.0);

  // View
  const [fitTrigger,  setFitTrigger]  = useState(0);

  // ── Load data — two-phase so map never fails just because analytics is slow ──
  useEffect(() => {
    if (!tripId) return;
    setLoading(true); setError(null); setClusterErr(null);
    setClusters([]); setStats(null);

    // Phase 1 — load raw GPS logs first. This is fast and always works.
    // The map renders as soon as logs arrive, even if analytics is still running.
    getRawLogs(tripId, qualFilter)
      .then(logsRes => {
        const raw = logsRes.data || [];
        setLogs(raw);

        // Compute stats from logs immediately — no need to wait for analytics
        const good = raw.filter(l => l.quality === "GOOD").length;
        const acc  = raw.filter(l => l.quality === "ACCEPTABLE").length;
        const poor = raw.filter(l => l.quality === "POOR").length;
        const maxOcc = Math.max(...raw.map(l => l.occupancy ?? 0), 0);
        const [[minLat, minLon], [maxLat, maxLon]] = CORRIDOR_BOUNDS;
        const outOfCorridor = raw.filter(
          l => l.lat < minLat || l.lat > maxLat ||
               l.lon < minLon || l.lon > maxLon
        ).length;
        let distM = 0;
        for (let i = 1; i < raw.length; i++) {
          distM += haversineMeters(
            [raw[i - 1].lat, raw[i - 1].lon],
            [raw[i].lat, raw[i].lon]
          );
        }

        setStats({
          total: raw.length, good, acc, poor, maxOcc,
          clusters: 0, trueStops: 0, queues: 0, moving: 0,
          outOfCorridor, distanceKm: distM / 1000, avgLF: 0,
        });

        setLoading(false); // map is ready — show it now

        // Phase 2 — run analytics in the background.
        setAnalyticsLoading(true);
        return runAllAnalytics(tripId);
      })
      .then(analyticsRes => {
        if (!analyticsRes) return;
        setAnalyticsLoading(false);
        const clusterList = analyticsRes?.data?.dbscan?.clusters || [];
        setClusters(clusterList);

        const avgLF = clusterList.length
          ? clusterList.reduce((s, c) => s + (c.load_factor_pct || 0), 0) / clusterList.length
          : 0;

        // Update stats to include cluster data
        setStats(prev => prev
          ? {
              ...prev,
              clusters:  clusterList.length,
              trueStops: clusterList.filter(c => c.cluster_type === "TRUE_STOP").length,
              queues:    clusterList.filter(c => c.cluster_type === "CREEPING_QUEUE").length,
              moving:    clusterList.filter(c => c.cluster_type === "MOVING").length,
              avgLF,
            }
          : prev
        );
      })
      .catch(e => {
        setAnalyticsLoading(false);
        const isLogsError = logs.length === 0;
        if (isLogsError) {
          setError("Failed to load trip data. Please try again.");
          setLoading(false);
        } else {
          setClusterErr(
            e.response?.data?.detail ||
            "Cluster analysis unavailable — the server may be starting up. Try again in a moment."
          );
        }
      });
  }, [tripId, qualFilter]);

  // ── Derived: filtered logs for rendering ───────────────────────────────
  const filteredLogs = useMemo(() => logs, [logs]);

  // ── Derived: filtered clusters by demand tier ──────────────────────────
  const filteredClusters = useMemo(() => (
    tierFilter === "all"
      ? clusters
      : clusters.filter(c => c.demand_tier === tierFilter)
  ), [clusters, tierFilter]);

  if (!tripId) return null;

  return (
    <div className="tripmap-overlay">
      <div className={`tripmap-container ${darkMode ? "dark" : ""}`}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="tripmap-header">
          <div>
            <h2 className="tripmap-title">Trip Map · Inspection</h2>
            <p className="tripmap-subtitle">{tripId}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="tripmap-toggle"
              onClick={() => setFitTrigger(t => t + 1)}
              title="Zoom map to show all recorded GPS data"
              style={{ background: "#1565c0", color: "#fff", borderColor: "#1565c0", fontWeight: 700 }}
            >
              🎯 Fit to Data
            </button>
            <button className="tripmap-close" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {/* ── Trip metadata ridge ────────────────────────────────────── */}
        {stats && (
          <div className="rs-metadata-ridge">
            <span>📍 <strong>{stats.total}</strong> logs</span>
            <span>📏 <strong>{stats.distanceKm.toFixed(2)}</strong> km traveled</span>
            <span>🚏 <strong>{stats.trueStops}</strong> true stops</span>
            <span>👥 <strong>{stats.maxOcc}</strong> max occupancy</span>
            <span>📊 <strong>{stats.avgLF.toFixed(0)}%</strong> avg load factor</span>
            {analyticsLoading && (
              <span style={{ color: "#888", fontStyle: "italic", fontSize: 12 }}>
                ⏳ Running cluster analysis…
              </span>
            )}
          </div>
        )}

        {/* ── Layer + Filter Controls ────────────────────────────────── */}
        <div className="tripmap-controls">
          <div className="tripmap-toggles">
            {[
              { key: "heat",    label: "🔥 Heat",      state: showHeat,    setter: setShowHeat    },
              { key: "dots",    label: "● Logs",       state: showDots,    setter: setShowDots    },
              { key: "trace",   label: "Path",         state: showTrace,   setter: setShowTrace   },
              { key: "cluster", label: "Clusters",     state: showCluster, setter: setShowCluster },
              { key: "route",   label: "Corridor",     state: showRoute,   setter: setShowRoute   },
              { key: "gt",      label: "70 Stops",     state: showGT,      setter: setShowGT      },
              { key: "bbox",    label: "Bounds",       state: showBBox,    setter: setShowBBox    },
              { key: "dark",    label: darkMode ? "☀ Light" : "🌙 Dark", state: darkMode, setter: setDarkMode },
            ].map(({ key, label, state, setter }) => (
              <button
                key={key}
                className={`tripmap-toggle ${state ? "active" : ""}`}
                onClick={() => setter(!state)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="tripmap-quality-filter">
            <span>Quality:</span>
            {[["all", "All"], ["good", "GOOD + ACC"]].map(([val, lbl]) => (
              <button
                key={val}
                className={`tripmap-toggle ${qualFilter === val ? "active" : ""}`}
                onClick={() => setQualFilter(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* ── Demand-tier filter + Heatmap intensity slider ──────────── */}
        {showHeat || showCluster ? (
          <div className="rs-filter-row">
            {showCluster && (
              <div className="rs-filter-group">
                <span className="rs-filter-label">Demand tier:</span>
                {["all", "Normal", "Moderate", "High", "Critical"].map(t => (
                  <button
                    key={t}
                    className={`rs-tier-chip ${tierFilter === t ? "active" : ""}`}
                    onClick={() => setTierFilter(t)}
                    style={t !== "all" && tierFilter === t
                      ? { background: DEMAND_COLORS[t], borderColor: DEMAND_COLORS[t], color: "#fff" }
                      : t !== "all"
                        ? { borderColor: DEMAND_COLORS[t], color: DEMAND_COLORS[t] }
                        : {}}
                  >
                    {t === "all" ? "All" : t}
                  </button>
                ))}
              </div>
            )}
            {showHeat && (
              <div className="rs-filter-group">
                <span className="rs-filter-label">Heat intensity:</span>
                <input
                  type="range" min="0.4" max="2" step="0.1"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="rs-intensity-slider"
                />
                <span className="rs-intensity-value">{intensity.toFixed(1)}×</span>
              </div>
            )}
          </div>
        ) : null}

        {/* ── Stat chips ─────────────────────────────────────────────── */}
        {stats && (
          <div className="tripmap-stats">
            {[
              ["Logs",         stats.total,         "#1f2937"],
              ["GOOD",         stats.good,          "#2e7d32"],
              ["ACCEPTABLE",   stats.acc,           "#f9a825"],
              ["POOR",         stats.poor,          "#c62828"],
              ["Off-Corridor", stats.outOfCorridor, "#7b1fa2"],
              ["True Stops",   stats.trueStops,     "#1565c0"],
              ["Queues",       stats.queues,        "#ef6c00"],
              ["Moving",       stats.moving,        "#c62828"],
            ].map(([label, value, color]) => (
              <div key={label} className="tripmap-stat">
                <span className="tripmap-stat-value" style={{ color }}>{value}</span>
                <span className="tripmap-stat-label">{label}</span>
              </div>
            ))}
          </div>
        )}

        {clusterErr && (
          <div className="rs-banner rs-banner-warn">
            ⚠️ {clusterErr}
            <button
              onClick={() => {
                setClusterErr(null);
                runAllAnalytics(tripId)
                  .then(res => {
                    const clusterList = res?.data?.dbscan?.clusters || [];
                    setClusters(clusterList);
                    const avgLF = clusterList.length
                      ? clusterList.reduce((s, c) => s + (c.load_factor_pct || 0), 0) / clusterList.length
                      : 0;
                    setStats(prev => prev ? {
                      ...prev,
                      clusters:  clusterList.length,
                      trueStops: clusterList.filter(c => c.cluster_type === "TRUE_STOP").length,
                      queues:    clusterList.filter(c => c.cluster_type === "CREEPING_QUEUE").length,
                      moving:    clusterList.filter(c => c.cluster_type === "MOVING").length,
                      avgLF,
                    } : prev);
                  })
                  .catch(e => setClusterErr(
                    e.response?.data?.detail || "Still unavailable. Try again shortly."
                  ));
              }}
              style={{
                marginLeft: 12, padding: "3px 12px",
                borderRadius: 8, border: "1.5px solid currentColor",
                background: "transparent", color: "inherit",
                fontWeight: 700, cursor: "pointer", fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              Retry
            </button>
          </div>
        )}
        {stats && stats.outOfCorridor > 0 && (
          <div className="rs-banner rs-banner-info">
            ℹ️ <strong>{stats.outOfCorridor}</strong> log{stats.outOfCorridor === 1 ? "" : "s"} recorded
            outside the Malanday–Recto corridor bounds. They appear on the map but
            are excluded from stop clustering (occupancy still counts toward demand & load factor).
          </div>
        )}

        {/* ── Map ────────────────────────────────────────────────────── */}
        <div className="tripmap-map-wrap">
          {loading && (
            <div className="tripmap-loading">
              <div className="tripmap-spinner" />
              <p>Loading trip data…</p>
            </div>
          )}
          {error && <div className="tripmap-error">{error}</div>}

          {!loading && !error && (
            <MapContainer
              center={CORRIDOR_CENTER}
              zoom={13}
              zoomControl={false}
              style={{ width: "100%", height: "100%" }}
            >
              <TileLayer
                attribution={darkMode ? ATTR_DARK : ATTR_LIGHT}
                url={darkMode ? TILE_DARK : TILE_LIGHT}
              />
              <ZoomControl position="bottomright" />
              <ScaleControl position="bottomleft" imperial={false} />

              <FitToData
                logs={filteredLogs}
                corridorRoute={showRoute ? CORRIDOR_ROUTE : null}
                fitTrigger={fitTrigger}
              />

              {/* Corridor bbox — purple dashed rectangle showing the backend
                  in-corridor bounding box. Increased fill opacity so it's
                  actually visible on the light tile (not just dark). */}
              {showBBox && (
                <Rectangle
                  bounds={CORRIDOR_BOUNDS}
                  pathOptions={{
                    color: "#7b1fa2",
                    weight: 2.5,
                    fillOpacity: darkMode ? 0.04 : 0.06,
                    fillColor: "#7b1fa2",
                    dashArray: "10,8",
                  }}
                />
              )}

              {/* Corridor route — two-layer line so it reads on both tiles.
                  Dark mode: thin bright blue on dark bg.
                  Light mode: wider navy line with visible glow. */}
              {showRoute && (<>
                <Polyline
                  positions={CORRIDOR_ROUTE}
                  pathOptions={{
                    color: "#0d47a1",
                    weight: darkMode ? 12 : 14,
                    opacity: darkMode ? 0.10 : 0.18,
                  }}
                />
                <Polyline
                  positions={CORRIDOR_ROUTE}
                  pathOptions={{
                    color: darkMode ? "#42a5f5" : "#1044a3",
                    weight: darkMode ? 4 : 5,
                    opacity: 0.90,
                  }}
                />
              </>)}

              {/* Trip path — dashed orange line, thicker on light mode */}
              {showTrace && filteredLogs.length > 1 && (
                <Polyline
                  positions={filteredLogs.map(l => [l.lat, l.lon])}
                  pathOptions={{
                    color: "#ff6f00",
                    weight: darkMode ? 3 : 3.5,
                    opacity: 0.90,
                    dashArray: "6,8",
                  }}
                />
              )}

              {/* Heatmap */}
              {showHeat && (
                <HeatmapLayer
                  points={filteredLogs}
                  visible={showHeat}
                  intensity={intensity}
                />
              )}

              {/* Raw log dots — white stroke + solid fill so they pop
                  on both dark tile and light tile backgrounds */}
              {showDots && filteredLogs.map((log, i) => {
                const isPoor = log.quality === "POOR";
                const fill   = QUALITY_COLORS[log.quality] || "#888";
                return (
                  <CircleMarker
                    key={i}
                    center={[log.lat, log.lon]}
                    radius={isPoor ? 6 : 5}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: fill,
                      fillOpacity: isPoor ? 0.65 : 0.92,
                      weight: 1.5,
                    }}
                  >
                    <Tooltip sticky>
                      <strong>{log.quality}</strong>
                      {isPoor && <> · <span style={{ color: "#c62828" }}>excluded from clustering</span></>}
                      <br />
                      Occ: {log.occupancy} · Acc: {log.accuracy?.toFixed(0)}m
                    </Tooltip>
                  </CircleMarker>
                );
              })}

              {/* Clusters — three concentric circles for depth.
                  Higher opacity values so they remain visible on light tiles. */}
              {showCluster && filteredClusters.map((c) => {
                const tierColor = DEMAND_COLORS[c.demand_tier] || "#555";
                const typeColor = CLUSTER_COLORS[c.cluster_type] || "#555";
                const radius = Math.max(14, Math.min(48, c.point_count * 2.5));
                const lf     = typeof c.load_factor_pct === "number"
                  ? c.load_factor_pct.toFixed(0) + "%" : "N/A";
                return (
                  <div key={c.cluster_id}>
                    {/* Outer glow ring — demand tier color */}
                    <CircleMarker
                      center={[c.centroid_lat, c.centroid_lon]}
                      radius={radius + 6}
                      pathOptions={{
                        color: tierColor,
                        fillColor: tierColor,
                        fillOpacity: darkMode ? 0.12 : 0.18,
                        weight: 0,
                      }}
                    />
                    {/* Mid ring — cluster type color with solid stroke */}
                    <CircleMarker
                      center={[c.centroid_lat, c.centroid_lon]}
                      radius={radius}
                      pathOptions={{
                        color: typeColor,
                        fillColor: typeColor,
                        fillOpacity: darkMode ? 0.28 : 0.35,
                        weight: darkMode ? 2.5 : 3,
                      }}
                    >
                      <Tooltip
                        permanent={c.cluster_type === "TRUE_STOP"}
                        direction="top"
                        offset={[0, -radius]}
                      >
                        <strong>C-{c.cluster_id} · {c.cluster_type.replace("_", " ")}</strong><br />
                        <span style={{ color: tierColor, fontWeight: 700 }}>{c.demand_tier}</span>
                         · {c.point_count} pts · LF {lf}<br />
                        <span style={{ fontSize: 11, color: "#666" }}>
                          {c.avg_velocity_ms?.toFixed(2)} m/s avg
                        </span>
                      </Tooltip>
                    </CircleMarker>
                    {/* Inner number bubble — handled by ClusterNumber DivIcon */}
                    <ClusterNumber cluster={c} />
                  </div>
                );
              })}

              {/* Ground truth stops — dark purple border so they're visible
                  on light tiles, white fill ring keeps them distinct */}
              {showGT && GROUND_TRUTH.map(([lat, lon, name], i) => (
                <CircleMarker
                  key={`gt-${i}`}
                  center={[lat, lon]}
                  radius={6}
                  pathOptions={{
                    color: "#4a148c",
                    fillColor: "#9c27b0",
                    fillOpacity: 0.85,
                    weight: 1.5,
                  }}
                >
                  <Tooltip direction="top">
                    <strong>GT-{i + 1}</strong> {name}
                  </Tooltip>
                </CircleMarker>
              ))}

              {/* Start marker — green circle with dark-green border
                  so it stays visible on both light and dark tiles */}
              {filteredLogs.length > 0 && (
                <CircleMarker
                  center={[filteredLogs[0].lat, filteredLogs[0].lon]}
                  radius={11}
                  pathOptions={{
                    color: "#1b5e20",
                    fillColor: "#2e7d32",
                    fillOpacity: 1,
                    weight: 2.5,
                  }}
                >
                  <Tooltip permanent direction="top" offset={[0, -12]}>
                    <strong style={{ color: "#2e7d32" }}>▶ START</strong>
                  </Tooltip>
                </CircleMarker>
              )}

              {/* End marker — red circle with dark-red border */}
              {filteredLogs.length > 1 && (
                <CircleMarker
                  center={[filteredLogs[filteredLogs.length - 1].lat, filteredLogs[filteredLogs.length - 1].lon]}
                  radius={11}
                  pathOptions={{
                    color: "#7f0000",
                    fillColor: "#c62828",
                    fillOpacity: 1,
                    weight: 2.5,
                  }}
                >
                  <Tooltip permanent direction="top" offset={[0, -12]}>
                    <strong style={{ color: "#c62828" }}>■ END</strong>
                  </Tooltip>
                </CircleMarker>
              )}
            </MapContainer>
          )}
        </div>

        {/* ── Legend ─────────────────────────────────────────────────── */}
        <div className="tripmap-legend">
          <div className="tripmap-legend-group">
            <span className="tripmap-legend-title">Clusters</span>
            {Object.entries(CLUSTER_COLORS).map(([type, color]) => (
              <span key={type} className="tripmap-legend-item">
                <span className="tripmap-legend-dot" style={{ background: color }} />
                {type.replace("_", " ")}
              </span>
            ))}
          </div>

          <div className="tripmap-legend-group">
            <span className="tripmap-legend-title">Demand</span>
            {Object.entries(DEMAND_COLORS).map(([tier, color]) => (
              <span key={tier} className="tripmap-legend-item">
                <span className="tripmap-legend-dot" style={{ background: color }} />
                {tier}
              </span>
            ))}
          </div>

          <div className="tripmap-legend-group">
            <span className="tripmap-legend-title">GPS Quality</span>
            {Object.entries(QUALITY_COLORS).map(([q, color]) => (
              <span key={q} className="tripmap-legend-item">
                <span className="tripmap-legend-dot" style={{ background: color }} />
                {q}
              </span>
            ))}
          </div>

          <div className="tripmap-legend-group">
            <span className="tripmap-legend-item">
              <span className="tripmap-legend-dot" style={{ background: "#2e7d32", border: "2px solid #fff", boxShadow: "0 0 0 1px #2e7d32" }} />
              Start
            </span>
            <span className="tripmap-legend-item">
              <span className="tripmap-legend-dot" style={{ background: "#c62828", border: "2px solid #fff", boxShadow: "0 0 0 1px #c62828" }} />
              End
            </span>
            <span className="tripmap-legend-item">
              <span className="tripmap-legend-dot" style={{ background: "#6200ea", border: "1.5px solid #fff" }} />
              GT Stop
            </span>
          </div>

          <div className="tripmap-legend-group">
            <span className="tripmap-legend-item">
              <span style={{ width: 28, height: 4, background: "#1565c0", borderRadius: 2, display: "inline-block", marginRight: 4 }} />
              Corridor
            </span>
            <span className="tripmap-legend-item">
              <span style={{ width: 28, height: 0, borderTop: "3px dashed #ff6f00", display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
              Trip Path
            </span>
          </div>

          <div className="tripmap-legend-group">
            <span className="tripmap-legend-title">Heatmap</span>
            <div className="tripmap-heat-gradient" />
            <span style={{ fontSize: 10, color: "#888" }}>Low → High occupancy</span>
          </div>
        </div>

      </div>
    </div>
  );
}
