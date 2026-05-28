/**
 * StopZoneMap — Passenger-facing stop zone map for PublicDashboard
 *
 * Shows detected boarding and alighting zones from completed trip data.
 * Embedded inside PublicDashboard below the jeepney cards.
 * Matches the existing dark glassmorphism design exactly.
 *
 * Usage in PublicDashboard.jsx:
 *   import StopZoneMap from "./StopZoneMap";
 *   <StopZoneMap routeId={routeId} />
 */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon path broken by Vite bundling
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const API = import.meta.env.VITE_API_URL;

// Corridor center and bounds — Malanday–Recto
const CENTER = [14.66, 120.975];

// Demand tier colours — match PublicDashboard TIER_CONFIG exactly
const TIER_COLOR = {
  Normal:   "#2e7d32",
  Moderate: "#f9a825",
  High:     "#ef6c00",
  Critical: "#c62828",
};

const TIER_LABEL = {
  Normal:   "🟢 Light demand",
  Moderate: "🟡 Filling up",
  High:     "🟠 Heavy demand",
  Critical: "🔴 Overcrowded",
};

export default function StopZoneMap({ routeId = "MR-001" }) {
  const mapRef     = useRef(null);  // DOM node for the map container
  const leafletRef = useRef(null);  // Leaflet map instance
  const markersRef = useRef([]);    // Track markers for cleanup

  const [zones,     setZones]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [meta,      setMeta]      = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activeDir, setActiveDir] = useState("all"); // "all" | "MALANDAY-RECTO" | "RECTO-MALANDAY"
  const [selected,  setSelected]  = useState(null);  // selected zone cluster_id

  // ── Fetch stop zones from public endpoint ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        setZones(data.stop_zones || []);
        setMeta({
          trips:  data.total_trips_analyzed,
          logs:   data.total_logs_clustered,
          count:  (data.stop_zones || []).length,
        });
        setLoading(false);
      })
      .catch(e => {
        if (!cancelled) { setError(e.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [routeId]);

  // ── Initialise Leaflet map once the container is mounted ─────────────────
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, {
      center: CENTER,
      zoom: 13,
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: true,
    });

    // Dark CARTO tile — matches the app's deep navy theme
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: "© CARTO" }
    ).addTo(map);

    // Corridor polyline — the route path in blue
    const CORRIDOR = [
      [14.7187, 120.957], [14.718, 120.957], [14.7155, 120.958],
      [14.7122, 120.959], [14.7085, 120.96],  [14.6988, 120.963],
      [14.6929, 120.964], [14.6862, 120.976], [14.6732, 120.982],
      [14.6617, 120.984], [14.6564, 120.984], [14.6320, 120.981],
      [14.6219, 120.982], [14.6037, 120.983],
    ];
    L.polyline(CORRIDOR, { color: "#1565c0", weight: 4, opacity: 0.7 }).addTo(map);

    // Terminal markers
    L.circleMarker([14.7187, 120.957], {
      radius: 8, color: "#fff", fillColor: "#2e7d32", fillOpacity: 1, weight: 2,
    }).bindTooltip("🚉 Malanday Terminal", { permanent: false }).addTo(map);

    L.circleMarker([14.6037, 120.983], {
      radius: 8, color: "#fff", fillColor: "#c62828", fillOpacity: 1, weight: 2,
    }).bindTooltip("🚉 Recto LRT Terminal", { permanent: false }).addTo(map);

    leafletRef.current = map;

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  // ── Render zone markers whenever zones or selection changes ──────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || zones.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const maxCount = Math.max(...zones.map(z => z.point_count), 1);

    zones.forEach(zone => {
      const isBusiest  = zone.rank === 1;
      const isSelected = selected === zone.cluster_id;

      // Scale radius 8–26 based on relative activity
      const radius = 8 + Math.round((zone.point_count / maxCount) * 18);
      const color  = TIER_COLOR[zone.demand_tier] || "#1565c0";

      // Outer glow ring
      const glow = L.circleMarker([zone.lat, zone.lon], {
        radius: radius + 8,
        color:  color,
        fillColor: color,
        fillOpacity: isSelected ? 0.30 : 0.12,
        weight: 0,
      }).addTo(map);
      markersRef.current.push(glow);

      // Main circle
      const circle = L.circleMarker([zone.lat, zone.lon], {
        radius:      radius,
        color:       isSelected ? "#fff" : color,
        fillColor:   color,
        fillOpacity: isSelected ? 0.95 : 0.80,
        weight:      isSelected ? 2.5 : 1.5,
      }).addTo(map);
      markersRef.current.push(circle);

      // Tooltip — shown on hover
      const lf = zone.load_factor_pct
        ? `${zone.load_factor_pct.toFixed(0)}% load factor`
        : "";
      circle.bindTooltip(`
        <div style="font-family:'DM Sans',sans-serif;min-width:180px">
          <strong style="font-size:13px">${isBusiest ? "⭐ Busiest Stop Zone" : `Stop Zone #${zone.rank}`}</strong><br/>
          <span style="color:${color};font-weight:700">${TIER_LABEL[zone.demand_tier] || zone.demand_tier}</span><br/>
          <span style="color:#555;font-size:12px">
            ${zone.point_count} GPS logs recorded here<br/>
            Avg occupancy: ${zone.avg_occupancy.toFixed(0)} passengers<br/>
            ${lf ? lf + "<br/>" : ""}
            Peak: ${zone.peak_period}
          </span>
        </div>
      `, { sticky: true, opacity: 0.98 });

      circle.on("click", () => {
        setSelected(prev => prev === zone.cluster_id ? null : zone.cluster_id);
      });
    });

    // Fit map to all markers
    if (zones.length > 0) {
      const bounds = L.latLngBounds(zones.map(z => [z.lat, z.lon]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: true });
      }
    }
  }, [zones, selected]);

  // ── Invalidate map size when collapsed/expanded ───────────────────────────
  useEffect(() => {
    if (!collapsed && leafletRef.current) {
      setTimeout(() => leafletRef.current?.invalidateSize(), 300);
    }
  }, [collapsed]);

  const selectedZone = zones.find(z => z.cluster_id === selected);

  return (
    <div style={{
      margin: "8px 0",
      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 20,
      overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
    }}>

      {/* ── Section header ─────────────────────────────────────────────── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: "white",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🗺</span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.3px" }}>
              Where to Board & Alight
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
              {loading
                ? "Loading stop zones…"
                : error
                  ? "Could not load stop zones"
                  : meta
                    ? `${meta.count} stop zones from ${meta.trips} recorded trips`
                    : "Tap to expand"
              }
            </div>
          </div>
        </div>
        <span style={{
          fontSize: 18,
          color: "rgba(255,255,255,0.50)",
          transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
          transition: "transform 0.2s",
        }}>
          ›
        </span>
      </button>

      {/* ── Expanded content ───────────────────────────────────────────── */}
      {!collapsed && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>

          {/* ── Explanation banner ─────────────────────────────────────── */}
          <div style={{
            padding: "10px 18px",
            fontSize: 12,
            color: "rgba(255,255,255,0.65)",
            lineHeight: 1.5,
            background: "rgba(21,101,192,0.12)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <strong style={{ color: "rgba(255,255,255,0.85)" }}>📍 How to use this map:</strong>
            {" "}Circles show where jeepneys most frequently stop to board and alight.
            <strong style={{ color: "#ffd60a" }}> Bigger = busier</strong>.
            Color shows how crowded it usually gets at that zone.
            Tap any circle for details.
          </div>

          {/* ── Loading / error states ─────────────────────────────────── */}
          {loading && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.50)" }}>
              <div style={{
                width: 32, height: 32,
                border: "3px solid rgba(255,255,255,0.15)",
                borderTopColor: "white",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 12px",
              }} />
              <p style={{ margin: 0, fontSize: 13 }}>Analyzing corridor data…</p>
            </div>
          )}

          {error && (
            <div style={{
              margin: 12,
              padding: "12px 14px",
              background: "rgba(255,69,58,0.12)",
              border: "1px solid rgba(255,69,58,0.25)",
              borderRadius: 12,
              fontSize: 13,
              color: "#ffb3ae",
            }}>
              ⚠️ Could not load stop zone data — {error}
            </div>
          )}

          {!loading && !error && zones.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.50)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🗺</div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "white" }}>
                No stop data yet
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                Stop zone maps appear once conductors complete recorded trips on this route.
              </p>
            </div>
          )}

          {/* ── Map ─────────────────────────────────────────────────────── */}
          {!loading && !error && zones.length > 0 && (
            <>
              {/* Selected zone detail card */}
              {selectedZone && (
                <div style={{
                  margin: "12px 12px 0",
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.10)",
                  border: `2px solid ${TIER_COLOR[selectedZone.demand_tier] || "#1565c0"}`,
                  borderRadius: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "white", marginBottom: 2 }}>
                      {selectedZone.rank === 1 ? "⭐ Busiest Stop Zone" : `Stop Zone #${selectedZone.rank}`}
                    </div>
                    <div style={{ fontSize: 12, color: TIER_COLOR[selectedZone.demand_tier], fontWeight: 700 }}>
                      {TIER_LABEL[selectedZone.demand_tier]}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                      {selectedZone.point_count} GPS logs · avg {selectedZone.avg_occupancy.toFixed(0)} passengers · {selectedZone.peak_period}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      border: "none",
                      borderRadius: 8,
                      color: "rgba(255,255,255,0.60)",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "inherit",
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Map container */}
              <div
                ref={mapRef}
                style={{
                  height: 340,
                  margin: 12,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />

              {/* Legend */}
              <div style={{
                padding: "10px 18px 16px",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 16px",
                borderTop: "1px solid rgba(255,255,255,0.08)",
              }}>
                {Object.entries(TIER_COLOR).map(([tier, color]) => (
                  <span key={tier} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    color: "rgba(255,255,255,0.65)",
                    fontWeight: 600,
                  }}>
                    <span style={{
                      width: 10, height: 10,
                      borderRadius: "50%",
                      background: color,
                      display: "inline-block",
                      flexShrink: 0,
                    }} />
                    {tier}
                  </span>
                ))}
                <span style={{
                  display: "flex", alignItems: "center", gap: 5,
                  fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 500,
                  width: "100%",
                }}>
                  Bigger circle = more recorded stops at that location
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Spin keyframe — injected once */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
