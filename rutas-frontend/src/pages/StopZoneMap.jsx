/**
 * StopZoneMap — Passenger Boarding & Alighting Map
 *
 * Shows WHERE to board and alight along the Malanday–Recto corridor.
 * Stops were identified by RutaSmart's spatial analytics module from
 * real jeepney GPS data — these are where jeepneys actually stop.
 *
 * Road geometry is fetched from OSRM routing API using the actual
 * stop positions as waypoints — guarantees the line follows real roads.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const API = import.meta.env.VITE_API_URL;

// Stop frequency tiers — tells passenger HOW RELIABLE this boarding point is
function getStopTier(rank, total) {
  const pct = rank / total;
  if (pct <= 0.15) return {
    badge: "⭐ Frequent Stop",
    desc:  "Jeepneys stop here very often. Best place to wait.",
    color: "#30d158", radius: 14,
  };
  if (pct <= 0.45) return {
    badge: "🚏 Regular Stop",
    desc:  "Jeepneys stop here regularly.",
    color: "#ffd60a", radius: 10,
  };
  return {
    badge: "🚏 Occasional Stop",
    desc:  "Jeepneys sometimes stop here. You may need to flag one down.",
    color: "#8e9ab0", radius: 7,
  };
}

function peakLabel(p) {
  return {
    "Morning Peak":   "🌅 Most active: Morning (6–9 AM)",
    "Afternoon Peak": "🌆 Most active: Afternoon (4–7 PM)",
    "Midday":         "☀️ Most active: Midday",
    "Off-Peak":       "🌙 Most active: Off-peak hours",
  }[p] || `Peak: ${p}`;
}

// Fallback corridor — used only if OSRM fails
// Calibrated to actual cluster centroid positions
const FALLBACK_ROAD = [
  [14.7187,120.9575],[14.7155,120.9600],[14.7120,120.9630],
  [14.7085,120.9655],[14.7050,120.9678],[14.7013,120.9700],
  [14.6980,120.9720],[14.6950,120.9740],[14.6920,120.9760],
  [14.6890,120.9775],[14.6860,120.9788],[14.6830,120.9800],
  [14.6800,120.9810],[14.6770,120.9818],[14.6740,120.9824],
  [14.6710,120.9830],[14.6680,120.9835],[14.6650,120.9838],
  [14.6620,120.9840],[14.6590,120.9840],[14.6571,120.9840],
  [14.6540,120.9840],[14.6510,120.9839],[14.6480,120.9838],
  [14.6450,120.9836],[14.6420,120.9833],[14.6390,120.9830],
  [14.6360,120.9825],[14.6334,120.9818],[14.6310,120.9820],
  [14.6280,120.9822],[14.6250,120.9823],[14.6220,120.9825],
  [14.6190,120.9827],[14.6160,120.9830],[14.6130,120.9833],
  [14.6100,120.9837],[14.6070,120.9840],[14.6048,120.9848],
  [14.6037,120.9840],
];

// Fetch actual road geometry from OSRM using stop positions as waypoints
async function fetchRoadGeometry(zones) {
  try {
    // Use top 6 stops spread along the route as waypoints
    // OSRM will route between them on real roads
    const sorted = [...zones].sort((a, b) => b.lat - a.lat); // north to south
    const step   = Math.max(1, Math.floor(sorted.length / 5));
    const picks  = [
      [14.7187, 120.9575],                           // Malanday terminal
      ...([0, step, step*2, step*3, step*4]
          .map(i => sorted[Math.min(i, sorted.length-1)])
          .filter(Boolean)
          .map(z => [z.lat, z.lon])),
      [14.6037, 120.9840],                           // Recto terminal
    ];

    const coords = picks.map(([lat, lon]) => `${lon},${lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    if (data.code !== "Ok") throw new Error("OSRM returned non-OK");

    // OSRM returns [lon, lat] — convert to [lat, lon] for Leaflet
    return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  } catch {
    return null; // fall back to hardcoded
  }
}

// ── Full-screen passenger map ──────────────────────────────────────────────
function PassengerMap({ zones, onClose }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const mksRef = useRef([]);
  const lineRef = useRef(null);

  const [sel,    setSel]    = useState(null);
  const [filter, setFilter] = useState("all");
  const total = zones.length;

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Init map + fetch road geometry
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const map = L.map(mapEl.current, {
      center: [14.66, 120.9808],
      zoom: 13,
      scrollWheelZoom: true,
      attributionControl: true,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19, attribution: "© CARTO © OSM" }
    ).addTo(map);

    // Terminal label markers
    [[14.7187, 120.9575, "🚉 Malanday"], [14.6037, 120.9840, "🚉 Recto LRT"]]
      .forEach(([lat, lon, label]) => {
        L.marker([lat, lon], {
          icon: L.divIcon({
            html: `<div style="
              background:rgba(5,15,30,0.90);
              border:2px solid #42a5f5;
              border-radius:8px;padding:4px 10px;
              font-family:'DM Sans',sans-serif;
              font-size:11px;font-weight:700;
              color:#fff;white-space:nowrap;
              box-shadow:0 2px 8px rgba(0,0,0,0.5);
            ">${label}</div>`,
            className: "", iconAnchor: [45, 14],
          }),
        }).addTo(map);
      });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);

    // Draw fallback road first, then replace with OSRM if available
    lineRef.current = L.polyline(FALLBACK_ROAD, {
      color: "#42a5f5", weight: 4, opacity: 0.55,
      lineJoin: "round", lineCap: "round",
    }).addTo(map);

    // Async: fetch real road geometry and swap in
    fetchRoadGeometry(zones).then(road => {
      if (!mapRef.current) return;
      if (road && road.length > 5) {
        if (lineRef.current) mapRef.current.removeLayer(lineRef.current);
        lineRef.current = L.polyline(road, {
          color: "#42a5f5", weight: 4, opacity: 0.55,
          lineJoin: "round", lineCap: "round",
        }).addTo(mapRef.current);
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line

  // Redraw stop markers when filter / selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    mksRef.current.forEach(m => map.removeLayer(m));
    mksRef.current = [];

    const visible = filter === "all"
      ? zones
      : filter === "frequent"
        ? zones.filter(z => z.rank / total <= 0.15)
        : zones.filter(z => z.rank / total <= 0.45);

    visible.forEach(zone => {
      const tier  = getStopTier(zone.rank, total);
      const isSel = sel === zone.cluster_id;
      const isTop = zone.rank === 1;

      // Pulse for selected
      if (isSel) {
        const pulse = L.circleMarker([zone.lat, zone.lon], {
          radius: tier.radius + 14,
          color: tier.color, fillColor: tier.color,
          fillOpacity: 0.20, weight: 0,
        }).addTo(map);
        mksRef.current.push(pulse);
      }

      // White ring — makes it look like a real stop marker
      const ring = L.circleMarker([zone.lat, zone.lon], {
        radius: tier.radius + 3,
        color: "#ffffff",
        fillColor: "transparent",
        fillOpacity: 0,
        weight: isSel ? 2.5 : 1.8,
        opacity: isSel ? 1 : 0.35,
      }).addTo(map);

      // Filled dot
      const dot = L.circleMarker([zone.lat, zone.lon], {
        radius: tier.radius,
        color: "transparent",
        fillColor: tier.color,
        fillOpacity: isSel ? 1 : 0.88,
        weight: 0,
      }).addTo(map);

      // Tooltip — pure passenger language, no analytics terms
      dot.bindTooltip(`
        <div style="
          font-family:'DM Sans',sans-serif;
          min-width:195px;line-height:1.6;padding:4px 2px;
        ">
          <div style="font-weight:800;font-size:13px;color:#111;margin-bottom:3px">
            ${tier.badge}
          </div>
          <div style="font-size:11px;color:#555;border-top:1px solid #eee;padding-top:6px;margin-top:4px">
            ${tier.desc}<br/>
            <span style="color:#1976d2;font-weight:600">${peakLabel(zone.peak_period)}</span>
          </div>
        </div>
      `, { sticky: true, opacity: 0.98, maxWidth: 240, direction: "top" });

      dot.on("click",  () => setSel(p => p === zone.cluster_id ? null : zone.cluster_id));
      ring.on("click", () => setSel(p => p === zone.cluster_id ? null : zone.cluster_id));

      mksRef.current.push(ring, dot);

      // ⭐ icon on top frequent stops
      if (isTop || tier.radius >= 14) {
        const icon = L.marker([zone.lat, zone.lon], {
          icon: L.divIcon({
            html: `<span style="font-size:${isTop ? 14 : 11}px;
              pointer-events:none;
              text-shadow:0 1px 4px rgba(0,0,0,0.8)">
              ${isTop ? "⭐" : "🚏"}
            </span>`,
            className: "", iconAnchor: [8, 8],
          }),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
        mksRef.current.push(icon);
      }
    });

    if (visible.length > 0) {
      const b = L.latLngBounds(visible.map(z => [z.lat, z.lon]));
      if (b.isValid()) map.fitBounds(b, { padding: [48, 48], maxZoom: 15 });
    }
  }, [zones, sel, filter, total]);

  const selZone = zones.find(z => z.cluster_id === sel);
  const selTier = selZone ? getStopTier(selZone.rank, total) : null;
  const freqCount = zones.filter(z => z.rank / total <= 0.15).length;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", flexDirection: "column",
      background: "#050f1e", fontFamily: "'DM Sans', sans-serif",
    }}>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "13px 16px",
        background: "rgba(5,15,30,0.96)",
        borderBottom: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(20px)",
        flexShrink: 0, zIndex: 2,
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: "-0.3px" }}>
            🚏 Where to Board &amp; Alight
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", marginTop: 2 }}>
            Malanday → Recto · {freqCount} frequent + {total - freqCount} other stops · tap for details
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 99, color: "#fff",
          padding: "8px 18px", fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>✕ Close</button>
      </div>

      {/* Filter pills */}
      <div style={{
        display: "flex", gap: 8, padding: "10px 16px",
        background: "rgba(0,0,0,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0, zIndex: 2, flexWrap: "wrap",
        alignItems: "center",
      }}>
        {[
          { key: "all",      label: `All Stops (${total})`,           color: "#42a5f5" },
          { key: "frequent", label: `⭐ Frequent Only (${freqCount})`, color: "#30d158" },
          { key: "regular",  label: `Regular+ (${zones.filter(z=>z.rank/total<=0.45).length})`, color: "#ffd60a" },
        ].map(({ key, label, color }) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding: "6px 14px", borderRadius: 99, border: "1.5px solid",
            borderColor: filter === key ? color : "rgba(255,255,255,0.15)",
            background: filter === key ? `${color}22` : "rgba(255,255,255,0.06)",
            color: filter === key ? "#fff" : "rgba(255,255,255,0.55)",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.15s",
          }}>{label}</button>
        ))}
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginLeft: "auto" }}>
          Bigger = more reliable
        </span>
      </div>

      {/* Selected stop panel */}
      {selZone && selTier && (
        <div style={{
          padding: "12px 16px",
          background: `${selTier.color}18`,
          borderBottom: `2px solid ${selTier.color}`,
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12,
          flexShrink: 0, zIndex: 2,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#fff", marginBottom: 4 }}>
              {selTier.badge}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {selTier.desc}<br/>
              <span style={{ color: "#42a5f5", fontWeight: 600 }}>
                {peakLabel(selZone.peak_period)}
              </span>
            </div>
          </div>
          <button onClick={() => setSel(null)} style={{
            background: "rgba(255,255,255,0.10)", border: "none",
            borderRadius: 8, color: "rgba(255,255,255,0.50)",
            padding: "6px 12px", cursor: "pointer",
            fontSize: 14, fontFamily: "inherit", flexShrink: 0,
          }}>✕</button>
        </div>
      )}

      {/* Map */}
      <div ref={mapEl} style={{ flex: 1, zIndex: 1 }} />

      {/* Legend */}
      <div style={{
        padding: "9px 16px",
        background: "rgba(0,0,0,0.75)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        display: "flex", gap: "14px", flexWrap: "wrap",
        alignItems: "center", flexShrink: 0, zIndex: 2,
      }}>
        {[
          { color: "#30d158", label: "Frequent stop",   r: 14 },
          { color: "#ffd60a", label: "Regular stop",    r: 10 },
          { color: "#8e9ab0", label: "Occasional stop", r: 7  },
        ].map(({ color, label, r }) => (
          <span key={label} style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 600,
          }}>
            <span style={{
              width: r, height: r, borderRadius: "50%",
              background: color, display: "inline-block", flexShrink: 0,
            }}/>
            {label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginLeft: "auto" }}>
          Identified from real jeepney GPS data
        </span>
      </div>
    </div>
  );
}

// ── Pill button ─────────────────────────────────────────────────────────────
export default function StopZoneMap({ routeId = "MR-001" }) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        if (dead) return;
        setZones(d.stop_zones || []);
        setLoading(false);
      })
      .catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [routeId]);

  if (loading) return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 99, color: "rgba(255,255,255,0.40)",
      fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
    }}>
      <span style={{
        width: 13, height: 13,
        border: "2px solid rgba(255,255,255,0.12)",
        borderTopColor: "rgba(255,255,255,0.55)",
        borderRadius: "50%", animation: "szm-s 0.8s linear infinite",
        display: "inline-block", flexShrink: 0,
      }}/>
      Finding boarding stops…
      <style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!zones.length) return null;

  const freqCount = zones.filter(z => z.rank / zones.length <= 0.15).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "14px 18px",
          background: "rgba(25,118,210,0.14)",
          border: "1.5px solid rgba(25,118,210,0.38)",
          borderRadius: 18, color: "#fff", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
          transition: "background 0.15s", textAlign: "left",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(25,118,210,0.26)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(25,118,210,0.14)"}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontSize: 26, background: "rgba(25,118,210,0.22)",
            borderRadius: 12, padding: "6px 10px",
            display: "flex", alignItems: "center",
          }}>🚏</span>
          <span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 800, letterSpacing: "-0.3px" }}>
              Where to Board &amp; Alight
            </span>
            <span style={{
              display: "block", fontSize: 11,
              color: "rgba(255,255,255,0.50)", fontWeight: 500, marginTop: 2,
            }}>
              ⭐ {freqCount} frequent stops · {zones.length} total · tap to view map
            </span>
          </span>
        </span>
        <span style={{
          background: "#1976d2", borderRadius: 99,
          padding: "6px 16px", fontSize: 12, fontWeight: 800,
          color: "#fff", flexShrink: 0,
          boxShadow: "0 2px 8px rgba(25,118,210,0.40)",
        }}>View Map →</span>
      </button>

      {open && <PassengerMap zones={zones} onClose={() => setOpen(false)} />}
    </>
  );
}
