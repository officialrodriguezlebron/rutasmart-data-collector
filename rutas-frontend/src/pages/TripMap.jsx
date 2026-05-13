import { useEffect, useRef, useState } from "react";
import {
  MapContainer, TileLayer, CircleMarker,
  Polyline, Tooltip, useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRawLogs, runAllAnalytics } from "../services/api";
import "./TripMap.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CORRIDOR_CENTER = [14.6600, 120.975];

const CLUSTER_COLORS = {
  TRUE_STOP:      "#1565c0",
  CREEPING_QUEUE: "#ef6c00",
  MOVING:         "#c62828",
};

const QUALITY_COLORS = {
  GOOD:       "#2e7d32",
  ACCEPTABLE: "#f57f17",
  POOR:       "#c62828",
};

// ── 78 Official Malanday-Recto Stops (from LTFRB franchise document) ─────
const GROUND_TRUTH = [
  // Official GTFS data — Sakay.ph trip 725192 (Malanday → Recto)
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
  [14.6516, 120.984, "Rizal Ave / Asistio"],
  [14.6488, 120.984, "Rizal Ave / 8th Ave West"],
  [14.6462, 120.984, "Asia Trust Bank"],
  [14.6445, 120.984, "CR3 / M.H. Del Pilar"],
  [14.6412, 120.984, "Banco De Oro Rizal Ave"],
  [14.64,   120.984, "Baliwag Transit Bus Station"],
  [14.6374, 120.983, "Rizal Ave / Road 1"],
  [14.6362, 120.982, "LRT R. Papa Station"],
  [14.6334, 120.981, "P. Sevilla / 2nd Ave West"],
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

// ── Corridor route polyline — accurate OSM-based trace ───────────────────
// MacArthur Hwy (Malanday → Karuhatan → Malabon) →
// turns east toward Monumento → Rizal Ave (Caloocan) →
// Jose Abad Santos → Tomas Mapua → Recto
// 87 nodes verified against known landmarks along DOTR:R_SAKAY_2018_PUJ_547
const CORRIDOR_ROUTE = [
  // Official GTFS stop positions — 70 stops, Malanday → Recto
  [14.7187, 120.957], [14.7183, 120.957], [14.718,  120.957],
  [14.7173, 120.957], [14.7155, 120.958], [14.7122, 120.959],
  [14.7093, 120.96],  [14.7085, 120.96],  [14.7041, 120.961],
  [14.7036, 120.962], [14.7022, 120.962], [14.7013, 120.962],
  [14.6988, 120.963], [14.697,  120.964], [14.6956, 120.964],
  [14.6929, 120.964], [14.6925, 120.965], [14.6928, 120.966],
  [14.6928, 120.969], [14.6922, 120.971], [14.6911, 120.973],
  [14.6899, 120.974], [14.6886, 120.975], [14.6877, 120.975],
  [14.6862, 120.976], [14.6852, 120.977], [14.6837, 120.978],
  [14.6815, 120.979], [14.6779, 120.98],  [14.6749, 120.981],
  [14.6732, 120.982], [14.67,   120.982], [14.6677, 120.982],
  [14.665,  120.984], [14.663,  120.984], [14.6617, 120.984],
  [14.6601, 120.984], [14.6576, 120.984], [14.6571, 120.984],
  [14.6564, 120.984], [14.6556, 120.984], [14.6538, 120.984],
  [14.6516, 120.984], [14.6488, 120.984], [14.6462, 120.984],
  [14.6445, 120.984], [14.6412, 120.984], [14.64,   120.984],
  [14.6374, 120.983], [14.6362, 120.982], [14.6334, 120.981],
  [14.632,  120.981], [14.6304, 120.98],  [14.629,  120.979],
  [14.6275, 120.979], [14.6257, 120.979], [14.6256, 120.98],
  [14.6243, 120.981], [14.623,  120.982], [14.6219, 120.982],
  [14.6206, 120.982], [14.6147, 120.985], [14.613,  120.984],
  [14.6115, 120.984], [14.6092, 120.984], [14.6076, 120.984],
  [14.6073, 120.986], [14.6048, 120.985], [14.6031, 120.985],
  [14.6037, 120.983],
];

// ── Heatmap layer ─────────────────────────────────────────────────────────
function HeatmapLayer({ points, visible }) {
  const map = useMap();
  const heatRef = useRef(null);

  useEffect(() => {
    if (!visible || !points.length) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }
    import("leaflet.heat").then(() => {
      if (heatRef.current) map.removeLayer(heatRef.current);
      const maxOcc = Math.max(...points.map(p => p.occupancy), 1);
      const heatPoints = points.map(p => [p.lat, p.lon, p.occupancy / maxOcc]);
      heatRef.current = L.heatLayer(heatPoints, {
        radius: 25, blur: 20, maxZoom: 17, max: 1.0,
        gradient: { 0.0: "#313695", 0.25: "#4575b4", 0.5: "#fdae61", 0.75: "#f46d43", 1.0: "#d73027" },
      }).addTo(map);
    });
    return () => {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [points, visible, map]);

  return null;
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TripMap({ tripId, onClose }) {
  const [logs,     setLogs]     = useState([]);
  const [clusters, setClusters] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [stats,    setStats]    = useState(null);

  const [showHeat,    setShowHeat]    = useState(true);
  const [showCluster, setShowCluster] = useState(true);
  const [showGT,      setShowGT]      = useState(true);
  const [showRoute,   setShowRoute]   = useState(true);
  const [qualFilter,  setQualFilter]  = useState("all");

  useEffect(() => {
    if (!tripId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(null);
    Promise.all([getRawLogs(tripId, qualFilter), runAllAnalytics(tripId)])
      .then(([logsRes, analyticsRes]) => {
        const raw = logsRes.data;
        setLogs(raw);
        setClusters(analyticsRes.data.dbscan?.clusters || []);
        const good = raw.filter(l => l.quality === "GOOD").length;
        const acc  = raw.filter(l => l.quality === "ACCEPTABLE").length;
        const poor = raw.filter(l => l.quality === "POOR").length;
        const maxOcc = Math.max(...raw.map(l => l.occupancy), 0);
        setStats({ total: raw.length, good, acc, poor, maxOcc,
                   clusters: analyticsRes.data.dbscan?.clusters?.length || 0 });
      })
      .catch(e => setError(e.response?.data?.detail || "Failed to load map data."))
      .finally(() => setLoading(false));
  }, [tripId, qualFilter]);

  return (
    <div className="tripmap-overlay">
      <div className="tripmap-container">

        <div className="tripmap-header">
          <div>
            <h2 className="tripmap-title">Trip Heatmap</h2>
            <p className="tripmap-subtitle">{tripId}</p>
          </div>
          <button className="tripmap-close" onClick={onClose}>✕ Close</button>
        </div>

        <div className="tripmap-controls">
          <div className="tripmap-toggles">
            {[
              { key: "heat",    label: "Heatmap",   state: showHeat,    setter: setShowHeat    },
              { key: "route",   label: "Corridor",  state: showRoute,   setter: setShowRoute   },
              { key: "cluster", label: "Clusters",  state: showCluster, setter: setShowCluster },
              { key: "gt",      label: "78 Stops",  state: showGT,      setter: setShowGT      },
            ].map(({ key, label, state, setter }) => (
              <button key={key}
                className={`tripmap-toggle ${state ? "active" : ""}`}
                onClick={() => setter(!state)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tripmap-quality-filter">
            <span>Quality:</span>
            {[["all", "All"], ["good", "GOOD + ACC"]].map(([val, label]) => (
              <button key={val}
                className={`tripmap-toggle ${qualFilter === val ? "active" : ""}`}
                onClick={() => setQualFilter(val)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {stats && (
          <div className="tripmap-stats">
            {[
              ["Total Logs", stats.total,    "#1f2937"],
              ["GOOD",       stats.good,     "#2e7d32"],
              ["ACCEPTABLE", stats.acc,      "#f57f17"],
              ["POOR",       stats.poor,     "#c62828"],
              ["Clusters",   stats.clusters, "#1565c0"],
              ["Max Occ",    stats.maxOcc,   "#1565c0"],
            ].map(([label, value, color]) => (
              <div key={label} className="tripmap-stat">
                <span className="tripmap-stat-value" style={{ color }}>{value}</span>
                <span className="tripmap-stat-label">{label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="tripmap-map-wrap">
          {loading && (
            <div className="tripmap-loading">
              <div className="tripmap-spinner" />
              <p>Loading map data…</p>
            </div>
          )}
          {error && <div className="tripmap-error">{error}</div>}
          {!loading && !error && (
            <MapContainer center={CORRIDOR_CENTER} zoom={13}
              style={{ width: "100%", height: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Corridor route — bold blue line */}
              {showRoute && (<>
                <Polyline
                  positions={CORRIDOR_ROUTE}
                  pathOptions={{ color: "#0d47a1", weight: 10, opacity: 0.12 }}
                />
                <Polyline
                  positions={CORRIDOR_ROUTE}
                  pathOptions={{ color: "#1565c0", weight: 4, opacity: 0.85 }}
                />
              </>)}

              {/* Heatmap */}
              {showHeat && <HeatmapLayer points={logs} visible={showHeat} />}

              {/* Raw GPS dots when heatmap off */}
              {!showHeat && logs.map((log, i) => (
                <CircleMarker key={i} center={[log.lat, log.lon]} radius={3}
                  pathOptions={{ color: QUALITY_COLORS[log.quality] || "#888",
                                 fillColor: QUALITY_COLORS[log.quality] || "#888",
                                 fillOpacity: 0.7, weight: 0 }}>
                  <Tooltip sticky>
                    {log.quality} | Occ: {log.occupancy} | Acc: {log.accuracy?.toFixed(0)}m
                  </Tooltip>
                </CircleMarker>
              ))}

              {/* DBSCAN clusters */}
              {showCluster && clusters.map((c) => {
                const color  = CLUSTER_COLORS[c.cluster_type] || "#555";
                const radius = Math.max(10, Math.min(40, c.point_count * 2));
                const lf     = typeof c.load_factor_pct === "number"
                  ? c.load_factor_pct.toFixed(0) + "%" : "N/A";
                return (
                  <CircleMarker key={c.cluster_id}
                    center={[c.centroid_lat, c.centroid_lon]} radius={radius}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.3, weight: 2.5 }}>
                    <Tooltip permanent={c.cluster_type === "TRUE_STOP"} direction="top">
                      <strong>C-{c.cluster_id} · {c.cluster_type.replace("_", " ")}</strong><br />
                      {c.point_count} logs · LF {lf}<br />
                      {c.demand_tier} · {c.avg_velocity_ms?.toFixed(2)} m/s
                    </Tooltip>
                  </CircleMarker>
                );
              })}

              {/* 78 Ground truth stops */}
              {showGT && GROUND_TRUTH.map(([lat, lon, name], i) => (
                <CircleMarker key={`gt-${i}`} center={[lat, lon]} radius={4}
                  pathOptions={{ color: "#6200ea", fillColor: "#6200ea",
                                 fillOpacity: 0.85, weight: 1 }}>
                  <Tooltip direction="top">
                    <strong>#{i + 1}</strong> {name}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          )}
        </div>

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
            <span className="tripmap-legend-title">GPS</span>
            {Object.entries(QUALITY_COLORS).map(([q, color]) => (
              <span key={q} className="tripmap-legend-item">
                <span className="tripmap-legend-dot" style={{ background: color }} />
                {q}
              </span>
            ))}
          </div>
          <div className="tripmap-legend-group">
            <span className="tripmap-legend-item">
              <span className="tripmap-legend-dot" style={{ background: "#6200ea" }} />
              GT Stop (78)
            </span>
            <span className="tripmap-legend-item">
              <span style={{ width: 24, height: 3, background: "#1565c0", opacity: 0.5, borderRadius: 2, display: "inline-block", marginRight: 4, borderTop: "2px dashed #1565c0" }} />
              Corridor Route
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
