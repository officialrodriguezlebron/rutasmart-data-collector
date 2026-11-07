import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_URL, TILE_ATTRIBUTION, TILE_MAX_ZOOM } from "../../config/basemap";
import { getStopZoneRecommendations } from "../../services/api";
import { CORRIDOR, RETURN_CORRIDOR } from "../../data/corridor";
import { DEMAND_COLOR } from "../../utils/adminFormatters";
import {
  DataStatusBadge, DataProvenanceNotice,
  useCorridorAnalytics, describeCluster, DEF,
} from "../../components/admin";
import "../AdminDashboard.css";
import "./AdminMap.css";

/**
 * Live Map.
 *
 * Two corrections here.
 *
 * The popup rendered z.recommendation verbatim from
 * /stop-zones/recommendations. Those strings prescribe franchise and route
 * actions ("Consider formalizing this location", "Stop underutilized -
 * consider consolidating with nearby stop"). Delimitation 2 excludes route
 * optimization and delimitation 11 states the system is not for binding
 * operational decision-making, so the UI now renders a descriptive
 * observation built by describeCluster() from the same tier, confidence and
 * coverage values. The endpoint is untouched.
 *
 * The marker colours keyed off the mapped High/Medium/Low tier, which the
 * backend collapses from the manuscript's four. The response also carries
 * demand_tier_raw, the original Normal/Moderate/High/Critical value, so the
 * four-tier classification is shown without changing any backend logic.
 *
 * Panel statistics now come from /analytics/merged/run-all rather than
 * /admin/aggregate, whose "Avg Signal Quality" was a mean of per-trip
 * GOOD-only percentages with ACCEPTABLE folded into POOR.
 */

// Suppress default icon URL warning — we use CircleMarkers only
delete L.Icon.Default.prototype._getIconUrl;

// Mapped tier (what /stop-zones/recommendations returns) kept for the
// confidence legend; DEMAND_COLOR carries the manuscript's four tiers and
// is keyed by demand_tier_raw.
const TIER_COLOR = { High: "#ff453a", Medium: "#ffd60a", Low: "#30d158" };

/** The manuscript tier for a zone, falling back to the mapped one. */
const rawTier = (z) => z.demand_tier_raw || z.demand_tier;
const tierColor = (z) => DEMAND_COLOR[rawTier(z)] || TIER_COLOR[z.demand_tier] || "#8e9ab0";

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
  const [zonesFor,   setZonesFor]   = useState(null);
  const [zonesErr,   setZonesErr]   = useState(null);
  const [flyTarget,  setFlyTarget]  = useState(null);

  // Corridor figures, per GPS log record.
  const a = useCorridorAnalytics({ direction, range: "ALL" });

  useEffect(() => {
    let cancelled = false;
    getStopZoneRecommendations("MR-001", direction)
      .then(r => {
        if (cancelled) return;
        setZones(r.data.zones || []);
        setZonesErr(null);
        setZonesFor(direction);
      })
      .catch(() => {
        if (cancelled) return;
        setZones([]);
        setZonesErr("Published stop zones could not be loaded for this direction.");
        setZonesFor(direction);
      });
    return () => { cancelled = true; };
  }, [direction]);

  const loading = zonesFor !== direction;

  // Full map-matched corridor polyline (same geometry backend uses for match_to_corridor())
  const corridorPath  = direction === "MALANDAY-RECTO" ? CORRIDOR : RETURN_CORRIDOR;
  const corridorColor = direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8";

  // Right panel stats, per GPS log record where the figure is a corridor
  // statistic. Zone counts are counts of published zones.
  const highDemandCount = zones.filter(
    z => rawTier(z) === "High" || rawTier(z) === "Critical"
  ).length;

  const panelCards = [
    { label: "Published zones", value: zones.length, accent: "#42a5f5",
      hint: "Stop zones currently published for this direction." },
    { label: "Met quality threshold",
      value: a.thresholdPct != null ? `${a.thresholdPct.toFixed(1)}%` : "—",
      accent: "#30d158", hint: DEF.qualityThreshold },
    { label: "High / Critical zones", value: highDemandCount, accent: "#ff453a",
      hint: "Published zones whose recorded demand tier is High or Critical." },
    { label: "Trips analysed", value: a.sourceTripCount ?? "—", accent: "#ffd60a",
      hint: DEF.tripsAnalyzed },
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
                <div style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.80)", marginBottom: 8 }}>
                  No stop zones published yet
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, marginBottom: 20 }}>
                  Open Stop Zones to review detected clusters and publish them for this corridor.
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
                  Open Stop Zones
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
                  <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
                  <BoundsFitter zones={zones} />
                  <FlyToController target={flyTarget} />

                  <Polyline positions={corridorPath} color={corridorColor} opacity={0.55} weight={2.5} />

                  {zones.map(z => (
                    <CircleMarker
                      key={z.cluster_id}
                      center={[z.centroid_lat, z.centroid_lon]}
                      radius={10}
                      fillOpacity={0.85}
                      fillColor={tierColor(z)}
                      color="rgba(0,0,0,0.35)"
                      weight={1}
                    >
                      <Popup className="admin-map-popup">
                        <div className="admin-map-popup-inner">
                          <div className="admin-map-popup-name">{z.name}</div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                            <span style={{
                              background: tierColor(z) + "28",
                              color: tierColor(z),
                              border: `1px solid ${tierColor(z)}50`,
                              padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                            }}>{rawTier(z)} demand</span>
                            <span style={{
                              background: "rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.72)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                            }}>{z.confidence} coverage</span>
                          </div>

                          {/* Observed evidence, then a descriptive note. The
                              backend's prescriptive recommendation string is
                              deliberately not rendered. */}
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", lineHeight: 1.6, marginBottom: 6 }}>
                            Observed on {z.trip_day_coverage ?? 0} of {z.total_trip_days ?? 0} collection
                            day{(z.total_trip_days ?? 0) === 1 ? "" : "s"}
                            {z.trip_day_coverage_pct != null && ` (${z.trip_day_coverage_pct}%)`}.
                            {z.avg_occupancy != null && ` Mean occupancy ${Number(z.avg_occupancy).toFixed(1)}.`}
                            {z.load_factor_pct != null && ` Load factor ${Number(z.load_factor_pct).toFixed(1)}%.`}
                            {z.peak_period && z.peak_period !== "—" && ` Busiest period ${z.peak_period}.`}
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", lineHeight: 1.5, fontStyle: "italic" }}>
                            {describeCluster(z.demand_tier, z.confidence, z.trip_day_coverage)}
                          </div>
                          {z.nearest_gt_name && (
                            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.52)", marginTop: 6 }}>
                              Nearest ground-truth stop: {z.nearest_gt_name}
                            </div>
                          )}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>

                {/* ── Legend strip below map ─────────────────────────────── */}
                <div className="admin-map-legend">
                  {["Normal", "Moderate", "High", "Critical"].map(tier => (
                    <span key={tier} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: DEMAND_COLOR[tier], display: "inline-block" }} />
                      <span>{tier}</span>
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
            {zonesErr && (
              <div style={{ fontSize: 11.5, color: "var(--rs-on-critical)", marginBottom: 10, lineHeight: 1.5 }}>
                {zonesErr}
              </div>
            )}
            {a.data && (
              <div style={{ fontSize: 10.5, color: "var(--rs-text-3)", lineHeight: 1.55, marginBottom: 10 }}>
                Corridor figures from {(a.totalLogs ?? 0).toLocaleString()} GPS log records
                across {a.sourceTripCount ?? 0} completed trips
                {a.collectionDays ? `, ${a.collectionDays} collection day${a.collectionDays === 1 ? "" : "s"}` : ""}.
                Not the published thesis dataset.
              </div>
            )}
            <div className="admin-map-panel-cards">
              {panelCards.map(({ label, value, accent, hint }) => (
                <div key={label} title={hint} style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.11)",
                  borderRadius: 10, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
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
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tierColor(z), flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.80)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {z.name}
                      </span>
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                        background: tierColor(z) + "28",
                        color: tierColor(z),
                        fontWeight: 700,
                      }}>{rawTier(z)}</span>
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
