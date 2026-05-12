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

const CORRIDOR_CENTER = [14.6540, 120.9820];

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
  [14.6890, 120.9950, "C.P. Enerton Fuel Station"],
  [14.6910, 120.9970, "MacArthur / E. Pantaleon"],
  [14.6930, 120.9990, "MacArthur / Del Pilar"],
  [14.7015, 121.0089, "Malanday Terminal"],
  [14.6980, 121.0050, "Mercury Drug Malanday"],
  [14.6960, 121.0020, "Marisyl School"],
  [14.6860, 120.9930, "MacArthur / Santiago Road"],
  [14.6840, 120.9910, "Ign Pharmacy"],
  [14.6790, 120.9870, "Dalandanan Fire Sub-Station"],
  [14.6810, 120.9890, "Dalandanan Health Centre"],
  [14.6760, 120.9850, "Santos Encarnacion Elem"],
  [14.6740, 120.9830, "Iglesia ni Cristo"],
  [14.6710, 120.9810, "Galdrine Industrial Corp"],
  [14.6680, 120.9790, "MacArthur / San Miguel"],
  [14.6650, 120.9770, "Parish Church San Isidro"],
  [14.6620, 120.9750, "Jollibee Malinta"],
  [14.6600, 120.9740, "Malinta Elementary School"],
  [14.6575, 120.9725, "MacArthur / Maysan Road"],
  [14.6560, 120.9710, "Valenzuela City Hall / People's Park"],
  [14.6545, 120.9700, "Bureau of Telecom Training Institute"],
  [14.6520, 120.9685, "Karuhatan Public Market"],
  [14.6505, 120.9675, "Macro LPG"],
  [14.6490, 120.9665, "MacArthur / San Francisco"],
  [14.6470, 120.9655, "SM Center Valenzuela"],
  [14.6450, 120.9645, "MacArthur / Cayetano"],
  [14.6435, 120.9638, "Novo Dep. Store"],
  [14.6420, 120.9630, "Bread of Life"],
  [14.6530, 120.9690, "OLFU / Fatima University"],
  [14.6400, 120.9620, "Bearsea Auto Supply"],
  [14.6375, 120.9608, "Calalang General Hospital"],
  [14.6355, 120.9595, "CDC Manufacturing"],
  [14.6335, 120.9582, "MacArthur / Del Monte"],
  [14.6315, 120.9570, "Malabon / Victoneta Ave"],
  [14.6298, 120.9558, "Potrero Heights Elem School"],
  [14.6280, 120.9548, "MacArthur / Lanzones"],
  [14.6562, 120.9829, "Floresco North Mortuary"],
  [14.6548, 120.9825, "Gen. Rosendo Simon / Calle Uno"],
  [14.6535, 120.9822, "Bonifacio Market"],
  [14.6540, 120.9903, "Hypermarket Monumento"],
  [14.6525, 120.9850, "Araneta Square"],
  [14.6518, 120.9845, "Araneta Square Mall"],
  [14.6505, 120.9840, "Ever Gotesco Grand Central"],
  [14.6492, 120.9835, "McDonalds Rizal Ave"],
  [14.6478, 120.9830, "Rizal Ave / Asistio"],
  [14.6465, 120.9825, "Rizal Ave / 8th Ave West"],
  [14.6452, 120.9820, "Rizal Ave / 7th Ave West"],
  [14.6440, 120.9818, "Asia Trust Bank"],
  [14.6428, 120.9815, "JCSGO Caloocan"],
  [14.6415, 120.9812, "J. Teodoro / 5th Ave West"],
  [14.6402, 120.9810, "CR3 / M.H. Del Pilar"],
  [14.6390, 120.9808, "3rd Avenue West"],
  [14.6378, 120.9805, "Banco de Oro Rizal Ave"],
  [14.6365, 120.9802, "Baliwag Transit Bus Station"],
  [14.6352, 120.9800, "Rizal Ave / Road 1"],
  [14.6295, 120.9821, "LRT Papa Station"],
  [14.6282, 120.9818, "P. Sevilla / 2nd Ave West"],
  [14.6268, 120.9815, "Rizal Ave / Jose Abad Santos"],
  [14.6255, 120.9810, "Jose Abad Santos / Morong"],
  [14.6242, 120.9805, "Jose Abad Santos / Corregidor"],
  [14.6228, 120.9800, "Jose Abad Santos Ave"],
  [14.6215, 120.9795, "Jose Abad Santos / T. Bugallon"],
  [14.6202, 120.9790, "T. Bugallon Street"],
  [14.6188, 120.9785, "T. Bugallon / Cavite"],
  [14.6175, 120.9835, "T. Mapua / Laguna"],
  [14.6162, 120.9830, "Tomas Mapua / Batangas"],
  [14.6148, 120.9825, "Tomas Mapua / Camarines"],
  [14.6135, 120.9820, "Camarines Manila"],
  [14.6122, 120.9822, "Felix Huertas Manila"],
  [14.6108, 120.9820, "San Lazaro / Oroquieta"],
  [14.6095, 120.9818, "Quiricada / Felix Huertas"],
  [14.6082, 120.9820, "Oroquieta / Alvarez"],
  [14.6068, 120.9822, "Oroquieta / Bambang"],
  [14.6055, 120.9820, "Felix Huertas 2"],
  [14.6042, 120.9820, "Oroquieta / Mayhaligue"],
  [14.6030, 120.9820, "Sulu Manila"],
  [14.6018, 120.9818, "Quezon Blvd / P. Paredes"],
  [14.6010, 120.9818, "Isetann"],
  [14.6021, 120.9820, "Recto LRT"],
];

// ── Corridor route polyline (simplified road trace) ───────────────────────
// MacArthur Hwy (Malanday → Monumento) → Rizal Ave → Recto
const CORRIDOR_ROUTE = [
  [14.7015, 121.0089], // Malanday Terminal
  [14.6980, 121.0050],
  [14.6960, 121.0020],
  [14.6930, 120.9990],
  [14.6910, 120.9970],
  [14.6890, 120.9950],
  [14.6860, 120.9930],
  [14.6840, 120.9910],
  [14.6810, 120.9890],
  [14.6790, 120.9870],
  [14.6760, 120.9850],
  [14.6740, 120.9830],
  [14.6710, 120.9810],
  [14.6680, 120.9790],
  [14.6650, 120.9770],
  [14.6620, 120.9750],
  [14.6600, 120.9740],
  [14.6575, 120.9725],
  [14.6560, 120.9710],
  [14.6530, 120.9690],
  [14.6505, 120.9675],
  [14.6470, 120.9655],
  [14.6435, 120.9638],
  [14.6400, 120.9620],
  [14.6375, 120.9608],
  [14.6335, 120.9582],
  [14.6298, 120.9558],
  [14.6280, 120.9548],
  // Route curves toward Monumento via Caloocan
  [14.6562, 120.9829],
  [14.6540, 120.9903], // Monumento
  [14.6525, 120.9850],
  [14.6505, 120.9840],
  [14.6465, 120.9825],
  [14.6428, 120.9815],
  [14.6390, 120.9808],
  [14.6352, 120.9800],
  [14.6295, 120.9821], // LRT Papa
  [14.6255, 120.9810],
  [14.6215, 120.9795],
  [14.6175, 120.9835],
  [14.6135, 120.9820],
  [14.6095, 120.9818],
  [14.6055, 120.9820],
  [14.6021, 120.9820], // Recto LRT
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

              {/* Corridor route highlight */}
              {showRoute && (
                <Polyline
                  positions={CORRIDOR_ROUTE}
                  pathOptions={{ color: "#1565c0", weight: 4, opacity: 0.35, dashArray: "8 4" }}
                />
              )}

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
