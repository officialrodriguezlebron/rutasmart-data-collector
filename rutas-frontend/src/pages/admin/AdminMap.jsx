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
  useCorridorAnalytics, DEF,
} from "../../components/admin";
import "../AdminDashboard.css";
import "./AdminMap.css";

/**
 * Demand Hotspots.
 *
 * Renamed from "Live Map": nothing here streams. Every marker is derived
 * from trips that have already completed.
 *
 * Two datasets, drawn differently on purpose
 * ------------------------------------------
 * Filled circles are DETECTED HOTSPOTS: clusters that the spatial detection
 * run groups out of the recorded observations for the selected direction.
 * They are coloured by demand tier.
 *
 * Outlined squares are REVIEWED PASSENGER ZONES: the separately assessed
 * passenger-service areas published for this corridor. They are drawn in one
 * neutral colour, because their role here is to say "a reviewed zone is
 * here", not to encode demand.
 *
 * Before this change the page drew only the reviewed zones and coloured them
 * by demand tier, so there was no way to see a detected hotspot at all, and
 * the one visible layer looked like it was the detection output. The two
 * counts also happened to both be 11 for the default view, which made the
 * conflation very easy to miss.
 *
 * What the colours mean
 * ---------------------
 * Demand tier, never GPS accuracy. The tier comes from the backend's
 * classify_demand(max_occ, official_capacity) (app/analytics/algorithms.py),
 * i.e. the HIGHEST occupancy recorded among a cluster's member observations,
 * not the mean. A location can therefore sit in a high tier while its mean
 * occupancy is much lower, which is why the legend and the list both say
 * "peak". GPS reliability is a separate figure in the panel.
 *
 * Two earlier corrections, still in force.
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

/** One neutral colour for every reviewed zone: shape says what it is. */
const ZONE_COLOR = "#7cc4fa";

/**
 * The manuscript tier for a reviewed zone, falling back to the mapped one.
 * Zones are no longer drawn on the canvas, but the Reviewed zones tab still
 * reports each zone's recorded tier.
 */
const rawTier = (z) => z.demand_tier_raw || z.demand_tier;

/** The four manuscript demand tiers, with the occupancy band behind each. */
const TIER_LEGEND = [
  { tier: "Normal",   band: "≤26 passengers" },
  { tier: "Moderate", band: "27–31 passengers" },
  { tier: "High",     band: "32–36 passengers" },
  { tier: "Critical", band: "37+ passengers" },
];

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
  /** Which list the panel shows. Both are long; showing one at a
      time is what removes the inner scrollbar. */
  const [listTab,    setListTab]    = useState("hotspots");
  /** Lists open at PREVIEW_ROWS and expand on request, so the map and
      the figures stay above the fold. */
  const [expanded,   setExpanded]   = useState(false);

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
  /**
   * Detected hotspots for the selected direction. These come from the
   * detection run, NOT from the published zone list, and the two are not
   * expected to agree in count or position.
   */
  const hotspots = (a.dbscan?.clusters ?? []).filter(
    c => c.centroid_lat != null && c.centroid_lon != null
  );

  /**
   * Severity order, so the five rows shown by default are the five worth
   * looking at. Ties break on peak occupancy. Descriptive ordering only:
   * it ranks what was recorded, not what to do about it.
   */
  const TIER_RANK = { Critical: 3, High: 2, Moderate: 1, Normal: 0 };
  const rankedHotspots = [...hotspots].sort(
    (x, y) => (TIER_RANK[y.demand_tier] ?? 0) - (TIER_RANK[x.demand_tier] ?? 0)
           || (y.max_occupancy ?? 0) - (x.max_occupancy ?? 0),
  );

  const highDemandHotspots = hotspots.filter(
    c => c.demand_tier === "High" || c.demand_tier === "Critical"
  ).length;

  const PREVIEW_ROWS = 5;
  const activeRows = listTab === "hotspots" ? rankedHotspots : zones;
  const shownRows = expanded ? activeRows : activeRows.slice(0, PREVIEW_ROWS);
  const hiddenCount = activeRows.length - shownRows.length;

  const dirLabelText = direction === "MALANDAY-RECTO"
    ? "Malanday → Recto" : "Recto → Malanday";

  // Every card is scoped to the selected direction, so each label says so
  // and each tooltip repeats it. "Met quality threshold" in particular must
  // not be read as the corridor-wide 96.90% figure.
  const panelCards = [
    { label: "Detected hotspots", value: hotspots.length, accent: "#ff9f0a",
      hint: `Hotspots found from recorded observations for ${dirLabelText}. A detection result, not a reviewed list.` },
    { label: "Reviewed passenger zones", value: zones.length, accent: ZONE_COLOR,
      hint: `Separately assessed passenger-service areas published for ${dirLabelText}.` },
    { label: "High / Critical demand hotspots", value: highDemandHotspots, accent: "#ff453a",
      hint: `Detected hotspots for ${dirLabelText} whose peak occupancy falls in the High or Critical band.` },
    { label: "GPS quality threshold",
      value: a.thresholdPct != null ? `${a.thresholdPct.toFixed(2)}%` : "—",
      accent: "#30d158",
      hint: `${DEF.qualityThreshold} Positional accuracy only — unrelated to the demand colours on the map. Scoped to ${dirLabelText}.` },
    { label: "Trips analysed", value: a.sourceTripCount ?? "—", accent: "#ffd60a",
      hint: `${DEF.tripsAnalyzed} Scoped to ${dirLabelText}.` },
  ];

  return (
    <div className="admin-map-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="admin-topbar" style={{ marginBottom: 0, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div>
          <h1>Demand Hotspots</h1>
          <p className="admin-map-subtitle">
            Detected demand hotspots from completed-trip observations
          </p>
        </div>
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
            {hotspots.length === 0 && zones.length === 0 ? (
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
                  style={{ width: "100%" }}
                  zoomControl
                >
                  <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
                  <BoundsFitter zones={hotspots} />
                  <FlyToController target={flyTarget} />

                  <Polyline positions={corridorPath} color={corridorColor} opacity={0.55} weight={2.5} />

                  {/* Detected hotspots: filled circles, coloured by demand
                      tier. Radius carries point count so a busier hotspot
                      reads as larger, but colour is the tier. */}
                  {hotspots.map(c => (
                    <CircleMarker
                      key={`hs-${c.cluster_id}`}
                      center={[c.centroid_lat, c.centroid_lon]}
                      radius={9}
                      fillOpacity={0.85}
                      fillColor={DEMAND_COLOR[c.demand_tier] || "#8e9ab0"}
                      color="rgba(0,0,0,0.35)"
                      weight={1}
                    >
                      <Popup className="admin-map-popup">
                        <div className="admin-map-popup-inner">
                          <div className="admin-map-popup-name">
                            Detected hotspot {c.cluster_id}
                          </div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                            <span style={{
                              background: (DEMAND_COLOR[c.demand_tier] || "#8e9ab0") + "28",
                              color: DEMAND_COLOR[c.demand_tier] || "#8e9ab0",
                              border: `1px solid ${(DEMAND_COLOR[c.demand_tier] || "#8e9ab0")}50`,
                              padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                            }}>{c.demand_tier} demand</span>
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
                            {/* Peak drives the tier; mean is shown beside it so
                                the two are never confused. */}
                            Peak occupancy {c.max_occupancy} passengers — this sets the tier.
                            {c.avg_occupancy != null && ` Mean occupancy ${Number(c.avg_occupancy).toFixed(1)}.`}
                            {c.peak_period && ` Busiest period ${c.peak_period}.`}
                            {c.point_count != null && ` ${c.point_count.toLocaleString()} recorded observations.`}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                </MapContainer>

                {/* ── Legend ──────────────────────────────────────────────
                    The old strip read "Normal / Moderate / High / Critical"
                    with no unit, which inspectors were reading as GPS
                    accuracy. Each row now carries the occupancy band, and
                    the note names the thing the colours are NOT. */}
                <div className="admin-map-legend" role="group" aria-label="Map legend">
                  <div className="admin-map-legend-title">Detected hotspot demand</div>
                  <div className="admin-map-legend-items">
                    {TIER_LEGEND.map(({ tier, band }) => (
                      <span className="admin-map-legend-item" key={tier}
                            title={`${tier} demand: peak occupancy ${band}`}>
                        <span className="admin-map-legend-dot"
                              style={{ background: DEMAND_COLOR[tier] }}
                              aria-hidden="true" />
                        <span>
                          {tier} demand
                          <span className="admin-map-legend-band"> · {band}</span>
                        </span>
                      </span>
                    ))}
                    <span className="admin-map-legend-item" title="Corridor path">
                      <span className="admin-map-legend-line"
                            style={{ background: corridorColor }} aria-hidden="true" />
                      <span>Corridor path</span>
                    </span>
                  </div>
                  <p className="admin-map-legend-note">
                    Marker colors show demand intensity at detected hotspots. A hotspot&rsquo;s tier
                    is based on its highest recorded passenger count.
                  </p>
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
            {/* Everything in this panel is scoped to the selected direction,
                not the whole corridor. Saying so matters: the direction
                subset is roughly half the dataset, so a reader comparing
                these counts against the corridor totals shown elsewhere
                would otherwise read the difference as an error rather than
                a filter. */}
            {a.data && (
              <div className="admin-map-scope">
                <div className="admin-map-scope-dir" style={{ color: corridorColor }}>
                  {direction === "MALANDAY-RECTO" ? "Malanday → Recto" : "Recto → Malanday"}
                </div>
                <div className="admin-map-scope-sub">
                  Selected direction · {a.sourceTripCount ?? 0} completed
                  trip{(a.sourceTripCount ?? 0) === 1 ? "" : "s"} ·{" "}
                  {(a.totalLogs ?? 0).toLocaleString()} recorded observations
                  {a.collectionDays
                    ? ` · ${a.collectionDays} collection day${a.collectionDays === 1 ? "" : "s"}`
                    : ""}
                </div>
                <div className="admin-map-scope-note">
                  Official study dataset · selected-direction view, not the full
                  corridor total.
                </div>
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

            {/* ── Tabs, then exactly one list ──────────────────────────
                Both lists in the panel at once produced a long column
                inside a fixed-height scroller: a scrollbar within a
                scrollbar. One at a time, in normal page flow, removes it. */}
            <div className="admin-map-tabs" role="tablist" aria-label="Map lists">
              <button
                type="button"
                role="tab"
                aria-selected={listTab === "hotspots"}
                className={`admin-map-tab${listTab === "hotspots" ? " is-active" : ""}`}
                onClick={() => { setListTab("hotspots"); setExpanded(false); }}
              >
                Detected hotspots · {hotspots.length}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={listTab === "zones"}
                className={`admin-map-tab${listTab === "zones" ? " is-active" : ""}`}
                onClick={() => { setListTab("zones"); setExpanded(false); }}
              >
                Reviewed zones · {zones.length}
              </button>
            </div>

            <div className="admin-map-zone-list">
              {activeRows.length === 0 ? (
                <p className="admin-map-list-empty">
                  {listTab === "hotspots"
                    ? "No hotspots were detected for this direction."
                    : "No reviewed passenger zones are published for this direction."}
                </p>
              ) : (
                <>
                  <div className="admin-map-rows">
                    {listTab === "hotspots"
                      ? shownRows.map(c => {
                          const col = DEMAND_COLOR[c.demand_tier] || "#8e9ab0";
                          return (
                            <button
                              key={`hsrow-${c.cluster_id}`}
                              onClick={() => setFlyTarget({ lat: c.centroid_lat, lon: c.centroid_lon, tick: Date.now() })}
                              className="admin-map-row"
                              aria-label={`Detected hotspot, peak ${c.max_occupancy} passengers, ${c.demand_tier} demand`}
                            >
                              <span className="admin-map-row-dot" style={{ background: col }} />
                              {/* The cluster id is an internal label from the
                                  detection run and means nothing to an
                                  inspector, so it is not shown. The backend
                                  supplies no verified name for a hotspot, and
                                  inventing one would be worse than none. */}
                              <span className="admin-map-row-name">
                                <span className="admin-map-row-kind">Detected hotspot</span>
                                <span className="admin-map-row-peak">
                                  Peak {c.max_occupancy} passengers
                                </span>
                              </span>
                              <span className="admin-map-row-chip"
                                    style={{ background: col + "28", color: col }}>
                                {c.demand_tier} demand
                              </span>
                            </button>
                          );
                        })
                      : shownRows.map(z => (
                          <button
                            key={`zrow-${z.cluster_id}`}
                            onClick={() => setFlyTarget({ lat: z.centroid_lat, lon: z.centroid_lon, tick: Date.now() })}
                            className="admin-map-row"
                            /* Full landmark survives truncation. */
                            title={`${z.name} — ${rawTier(z)} demand`}
                            aria-label={`Reviewed passenger zone ${z.name}, ${rawTier(z)} demand`}
                          >
                            <span className="admin-map-row-square" style={{ borderColor: ZONE_COLOR }} />
                            <span className="admin-map-row-name">{z.name}</span>
                            <span className="admin-map-row-plain">{rawTier(z)} demand</span>
                          </button>
                        ))}
                  </div>

                  {/* Rendering all 23 rows by default pushed the map and the
                      figures off the top of the screen. Five, then opt in. */}
                  {hiddenCount > 0 && (
                    <button type="button" className="admin-map-more"
                            onClick={() => setExpanded(true)}>
                      View all {activeRows.length}{" "}
                      {listTab === "hotspots" ? "hotspots" : "reviewed zones"}
                    </button>
                  )}
                  {expanded && activeRows.length > PREVIEW_ROWS && (
                    <button type="button" className="admin-map-more"
                            onClick={() => setExpanded(false)}>
                      Show top {PREVIEW_ROWS} only
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
