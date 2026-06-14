import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getStopZoneRecommendations, getAggregateDashboard } from "../../services/api";
import { CORRIDOR, RETURN_CORRIDOR } from "../../data/corridor";
import "../AdminDashboard.css";
import "./AdminMap.css";

// Suppress default icon URL warning — we use CircleMarkers only
delete L.Icon.Default.prototype._getIconUrl;

const TIER_COLOR  = { High: "#ff453a", Medium: "#ffd60a", Low: "#30d158" };
const CARTO_DARK  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const CARTO_ATTR  = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

// ── Auto-fit bounds when zones change ─────────────────────────────────────────
function BoundsFitter({ zones }) {
  const map = useMap();
  useEffect(() => {
    if (zones.length < 2) return;
    const bounds = L.latLngBounds(zones.map(z => [z.centroid_lat, z.centroid_lon]));
    map.fitBounds(bounds, { padding: [48, 48] });
  }, [zones, map]);
  return null;
}

// ── Fly-to a zone on list-row click ───────────────────────────────────────────
function FlyToController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], 16, { animate: true, duration: 1 });
  }, [target, map]);
  return null;
}

export default function AdminMap() {
  const [direction,  setDirection]  = useState("MALANDAY-RECTO");
  const [zones,      setZones]      = useState([]);
  const [aggregate,  setAggregate]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [flyTarget,  setFlyTarget]  = useState(null);

  useEffect(() => {
    setLoading(true);
    setZones([]);
    Promise.all([
      getStopZoneRecommendations("MR-001", direction),
      getAggregateDashboard(),
    ])
      .then(([zRes, aRes]) => {
        setZones(zRes.data.zones || []);
        setAggregate(aRes.data);
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [direction]);

  // Full map-matched corridor polyline (same geometry backend uses for match_to_corridor())
  const corridorPath  = direction === "MALANDAY-RECTO" ? CORRIDOR : RETURN_CORRIDOR;
  const corridorColor = direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8";

  // Right panel stats
  const summaries       = aggregate?.trip_summaries || [];
  const avgSigQuality   = summaries.length
    ? summaries.reduce((s, t) => s + (t.good_pct || 0), 0) / summaries.length
    : null;
  const highDemandCount = zones.filter(z => z.demand_tier === "High").length;
  const totalTrips      = aggregate?.total_trips ?? summaries.length;

  const panelCards = [
    { label: "Published Zones",   value: zones.length,  accent: "#42a5f5" },
    { label: "Avg Signal Quality", value: avgSigQuality != null ? `${avgSigQuality.toFixed(1)}%` : "—", accent: "#30d158" },
    { label: "High Demand Zones", value: highDemandCount, accent: "#ff453a" },
    { label: "Total Trips",       value: totalTrips || "—", accent: "#ffd60a" },
  ];

  return (
    <div className="admin-map-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="admin-topbar" style={{ marginBottom: 0, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <h1>Map Dashboard</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { dir: "MALANDAY-RECTO",  label: "Malanday → Recto" },
            { dir: "RECTO-MALANDAY",  label: "Recto → Malanday" },
          ].map(({ dir, label }) => (
            <button
              key={dir}
              onClick={() => { if (dir !== direction) { setDirection(dir); setFlyTarget(null); } }}
              style={{
                padding: "7px 16px", borderRadius: 8, fontSize: 12,
                cursor: "pointer", fontFamily: "var(--font)", fontWeight: 700,
                border: `1px solid ${direction === dir ? corridorColor : "rgba(255,255,255,0.15)"}`,
                background: direction === dir ? corridorColor + "22" : "transparent",
                color: direction === dir ? corridorColor : "rgba(255,255,255,0.50)",
                transition: "all .15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="admin-loading" style={{ flex: 1 }}>Loading map data…</div>
      ) : (
        <div className="admin-map-body">
          {/* ── Leaflet Map ─────────────────────────────────────────────────── */}
          <div className="admin-map-wrap">
            {zones.length === 0 ? (
              <div className="admin-map-empty">
                <div style={{ fontSize: 52, marginBottom: 16 }}>🗺</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.80)", marginBottom: 8 }}>
                  No stop zones published yet
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, marginBottom: 20 }}>
                  Go to Stop Detection to publish zones for this corridor.
                </div>
                <Link to="/admin/stop-zones" style={{
                  padding: "9px 22px",
                  background: "rgba(66,165,245,0.14)",
                  color: "#42a5f5",
                  borderRadius: 9,
                  border: "1px solid rgba(66,165,245,0.30)",
                  fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                }}>
                  → Go to Stop Detection
                </Link>
              </div>
            ) : (
              <>
                <MapContainer
                  key={direction}
                  center={[14.65, 120.97]}
                  zoom={13}
                  style={{ width: "100%", height: "100%" }}
                  zoomControl
                >
                  <TileLayer url={CARTO_DARK} attribution={CARTO_ATTR} />
                  <BoundsFitter zones={zones} />
                  <FlyToController target={flyTarget} />

                  <Polyline positions={corridorPath} color={corridorColor} opacity={0.55} weight={2.5} />

                  {zones.map(z => (
                    <CircleMarker
                      key={z.cluster_id}
                      center={[z.centroid_lat, z.centroid_lon]}
                      radius={10}
                      fillOpacity={0.85}
                      fillColor={TIER_COLOR[z.demand_tier] || "#8e9ab0"}
                      color="rgba(0,0,0,0.35)"
                      weight={1}
                    >
                      <Popup className="admin-map-popup">
                        <div className="admin-map-popup-inner">
                          <div className="admin-map-popup-name">{z.name}</div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                            <span style={{
                              background: (TIER_COLOR[z.demand_tier] || "#8e9ab0") + "28",
                              color: TIER_COLOR[z.demand_tier] || "#8e9ab0",
                              border: `1px solid ${(TIER_COLOR[z.demand_tier] || "#8e9ab0")}50`,
                              padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                            }}>{z.demand_tier} Demand</span>
                            <span style={{
                              background: "rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.65)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                            }}>{z.confidence} Confidence</span>
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                            {z.recommendation}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>

                {/* ── Legend strip below map ─────────────────────────────── */}
                <div className="admin-map-legend">
                  {Object.entries(TIER_COLOR).map(([tier, color]) => (
                    <span key={tier} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />
                      <span>{tier} Demand</span>
                    </span>
                  ))}
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 18, height: 2, background: corridorColor, display: "inline-block", opacity: 0.65 }} />
                    <span>Corridor path</span>
                  </span>
                </div>
              </>
            )}
          </div>

          {/* ── Right panel ─────────────────────────────────────────────────── */}
          <div className="admin-map-panel">
            <div className="admin-map-panel-cards">
              {panelCards.map(({ label, value, accent }) => (
                <div key={label} style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.11)",
                  borderRadius: 10, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: accent, letterSpacing: "-0.5px", fontFamily: "var(--mono)" }}>{value}</div>
                </div>
              ))}
            </div>

            {zones.length > 0 && (
              <div className="admin-map-zone-list">
                <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                  Zones ({zones.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {zones.map(z => (
                    <button
                      key={z.cluster_id}
                      onClick={() => setFlyTarget({ lat: z.centroid_lat, lon: z.centroid_lon, tick: Date.now() })}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "7px 10px", borderRadius: 8,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer", width: "100%", textAlign: "left",
                        fontFamily: "var(--font)",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: TIER_COLOR[z.demand_tier] || "#8e9ab0", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.80)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {z.name}
                      </span>
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                        background: (TIER_COLOR[z.demand_tier] || "#8e9ab0") + "28",
                        color: TIER_COLOR[z.demand_tier] || "#8e9ab0",
                        fontWeight: 700,
                      }}>{z.demand_tier}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
