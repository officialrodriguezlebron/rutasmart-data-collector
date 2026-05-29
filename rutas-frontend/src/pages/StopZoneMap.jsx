/**
 * StopZoneMap — Passenger-facing stop zone map
 * Matches RutaSmart's dark glassmorphism UI exactly.
 * Fixed: Leaflet init timing, no-collapse layout for mobile clarity.
 */
import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL;

const TIER_COLOR = {
  Normal:   "#2e7d32",
  Moderate: "#f9a825",
  High:     "#ef6c00",
  Critical: "#c62828",
};

const TIER_LABEL = {
  Normal:   "Light demand",
  Moderate: "Filling up",
  High:     "Heavy demand",
  Critical: "Overcrowded",
};

export default function StopZoneMap({ routeId = "MR-001" }) {
  const mapEl   = useRef(null);
  const mapObj  = useRef(null);
  const markers = useRef([]);

  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [meta,    setMeta]    = useState(null);
  const [sel,     setSel]     = useState(null);

  // ── Fetch published stop zones ─────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => {
        if (dead) return;
        setZones(d.stop_zones || []);
        setMeta({ count: (d.stop_zones||[]).length, trips: d.total_trips_analyzed });
        setLoading(false);
      })
      .catch(e => { if (!dead) { setError(e.message); setLoading(false); } });
    return () => { dead = true; };
  }, [routeId]);

  // ── Init Leaflet once the map element is in the DOM ───────────────────────
  useEffect(() => {
    if (!mapEl.current || mapObj.current) return;

    // Dynamically import Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id   = "leaflet-css";
      link.rel  = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    import("leaflet").then(({ default: L }) => {
      if (mapObj.current || !mapEl.current) return;

      // Fix Vite asset paths
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapEl.current, {
        center: [14.66, 120.975],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19 }
      ).addTo(map);

      // Corridor polyline
      const CORRIDOR = [
        [14.7187,120.957],[14.718,120.957],[14.7155,120.958],
        [14.7122,120.959],[14.7085,120.960],[14.6988,120.963],
        [14.6929,120.964],[14.6862,120.976],[14.6732,120.982],
        [14.6617,120.984],[14.6564,120.984],[14.6320,120.981],
        [14.6219,120.982],[14.6037,120.983],
      ];
      L.polyline(CORRIDOR, { color: "#1565c0", weight: 3, opacity: 0.6, dashArray: "6,4" }).addTo(map);

      // Terminal pins
      [
        [[14.7187,120.957], "🚉 Malanday Terminal", "#2e7d32"],
        [[14.6037,120.983], "🚉 Recto LRT Terminal", "#c62828"],
      ].forEach(([latlng, tip, color]) => {
        L.circleMarker(latlng, {
          radius: 7, color: "#fff", fillColor: color, fillOpacity: 1, weight: 2,
        }).bindTooltip(tip).addTo(map);
      });

      mapObj.current = map;
      // Trigger resize so tiles load correctly
      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
  }, []); // run once

  // ── Render markers whenever zones or selection changes ─────────────────────
  useEffect(() => {
    if (!mapObj.current || zones.length === 0) return;

    import("leaflet").then(({ default: L }) => {
      const map = mapObj.current;
      if (!map) return;

      // Remove old markers
      markers.current.forEach(m => map.removeLayer(m));
      markers.current = [];

      const maxCount = Math.max(...zones.map(z => z.point_count), 1);

      zones.forEach(zone => {
        const isBest   = zone.rank === 1;
        const isActive = sel === zone.cluster_id;
        const color    = TIER_COLOR[zone.demand_tier] || "#1565c0";
        const radius   = 7 + Math.round((zone.point_count / maxCount) * 20);

        // Glow
        const glow = L.circleMarker([zone.lat, zone.lon], {
          radius: radius + 9, color: color, fillColor: color,
          fillOpacity: isActive ? 0.25 : 0.10, weight: 0,
        }).addTo(map);
        markers.current.push(glow);

        // Main dot
        const dot = L.circleMarker([zone.lat, zone.lon], {
          radius, color: isActive ? "#fff" : color,
          fillColor: color, fillOpacity: isActive ? 1 : 0.82,
          weight: isActive ? 2.5 : 1.5,
        }).addTo(map);

        dot.bindTooltip(`
          <div style="font-family:DM Sans,sans-serif;min-width:160px;font-size:12px">
            <strong>${isBest ? "⭐ Busiest Stop Zone" : `Stop Zone #${zone.rank}`}</strong><br/>
            <span style="color:${color};font-weight:700">${TIER_LABEL[zone.demand_tier] || zone.demand_tier}</span><br/>
            <span style="color:#666">${zone.point_count} GPS logs · avg ${Math.round(zone.avg_occupancy)} pax · ${zone.peak_period}</span>
          </div>
        `, { sticky: true, opacity: 0.97 });

        dot.on("click", () => setSel(p => p === zone.cluster_id ? null : zone.cluster_id));
        markers.current.push(dot);
      });

      // Fit bounds to all markers
      const lls = zones.map(z => [z.lat, z.lon]);
      const bounds = L.latLngBounds(lls);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
    });
  }, [zones, sel]);

  const selZone = zones.find(z => z.cluster_id === sel);

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      margin: "12px 0 0",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 20,
      overflow: "hidden",
      fontFamily: "'DM Sans',sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
          <span style={{ fontSize:18 }}>🗺</span>
          <span style={{ fontWeight:800, fontSize:15, color:"#fff", letterSpacing:"-0.3px" }}>
            Where to Board &amp; Alight
          </span>
        </div>
        <p style={{ margin:0, fontSize:11, color:"rgba(255,255,255,0.50)", lineHeight:1.4 }}>
          {loading
            ? "Analyzing corridor data…"
            : error
              ? "Could not load stop zones"
              : meta
                ? `${meta.count} stop zones from ${meta.trips} recorded trips`
                : ""}
        </p>
      </div>

      {/* Instruction banner */}
      {!loading && !error && zones.length > 0 && (
        <div style={{
          padding:"9px 16px",
          fontSize:11,
          color:"rgba(255,255,255,0.60)",
          lineHeight:1.5,
          background:"rgba(21,101,192,0.10)",
          borderBottom:"1px solid rgba(255,255,255,0.06)",
        }}>
          <strong style={{color:"rgba(255,255,255,0.80)"}}>📍 How to use:</strong>
          {" "}Circles show where jeepneys most frequently stop.{" "}
          <strong style={{color:"#ffd60a"}}>Bigger = busier.</strong>
          {" "}Tap any circle for details.
        </div>
      )}

      {/* Selected zone card */}
      {selZone && (
        <div style={{
          margin:"10px 12px 0",
          padding:"10px 14px",
          background:"rgba(255,255,255,0.09)",
          border:`2px solid ${TIER_COLOR[selZone.demand_tier]||"#1565c0"}`,
          borderRadius:12,
          display:"flex",
          justifyContent:"space-between",
          alignItems:"center",
          gap:8,
        }}>
          <div>
            <div style={{fontWeight:800,fontSize:13,color:"#fff",marginBottom:2}}>
              {selZone.rank===1?"⭐ Busiest Stop Zone":`Stop Zone #${selZone.rank}`}
            </div>
            <div style={{fontSize:12,color:TIER_COLOR[selZone.demand_tier],fontWeight:700}}>
              {TIER_LABEL[selZone.demand_tier]}
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.50)",marginTop:2}}>
              {selZone.point_count} logs · avg {Math.round(selZone.avg_occupancy)} pax · {selZone.peak_period}
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{
            background:"rgba(255,255,255,0.10)",border:"none",borderRadius:8,
            color:"rgba(255,255,255,0.55)",padding:"4px 10px",cursor:"pointer",
            fontSize:13,fontFamily:"inherit",
          }}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{textAlign:"center",padding:"48px 20px",color:"rgba(255,255,255,0.45)"}}>
          <div style={{
            width:28,height:28,
            border:"3px solid rgba(255,255,255,0.12)",
            borderTopColor:"rgba(255,255,255,0.70)",
            borderRadius:"50%",
            animation:"szm-spin 0.8s linear infinite",
            margin:"0 auto 12px",
          }}/>
          <p style={{margin:0,fontSize:13}}>Analyzing corridor data…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          margin:12,padding:"10px 14px",
          background:"rgba(198,40,40,0.12)",
          border:"1px solid rgba(198,40,40,0.30)",
          borderRadius:10,fontSize:13,color:"#ffb3ae",
        }}>
          ⚠️ Could not load stop zones — {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && zones.length===0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"rgba(255,255,255,0.45)"}}>
          <div style={{fontSize:36,marginBottom:10}}>📍</div>
          <p style={{margin:0,fontSize:14,fontWeight:700,color:"#fff"}}>No stop zones published yet</p>
          <p style={{margin:"6px 0 0",fontSize:12}}>
            An administrator must publish stop zones before they appear here.
          </p>
        </div>
      )}

      {/* Map */}
      {!loading && !error && zones.length > 0 && (
        <div
          ref={mapEl}
          style={{
            height: 320,
            margin: "10px 12px 0",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#0d1117",
          }}
        />
      )}

      {/* Legend */}
      {!loading && !error && zones.length > 0 && (
        <div style={{
          padding:"10px 16px 14px",
          display:"flex",flexWrap:"wrap",gap:"6px 14px",
          borderTop:"1px solid rgba(255,255,255,0.07)",
          marginTop:10,
        }}>
          {Object.entries(TIER_COLOR).map(([tier,color])=>(
            <span key={tier} style={{
              display:"flex",alignItems:"center",gap:5,
              fontSize:11,color:"rgba(255,255,255,0.60)",fontWeight:600,
            }}>
              <span style={{
                width:9,height:9,borderRadius:"50%",
                background:color,display:"inline-block",flexShrink:0,
              }}/>
              {tier}
            </span>
          ))}
          <span style={{
            width:"100%",fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:2,
          }}>
            Bigger circle = more recorded stops at that location
          </span>
        </div>
      )}

      <style>{`@keyframes szm-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
