import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Vite broken icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

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

const CORRIDOR = [
  [14.7187, 120.9575],
  [14.7120, 120.9590],
  [14.7013, 120.9620],
  [14.6960, 120.9645],
  [14.6900, 120.9680],
  [14.6850, 120.9718],
  [14.6800, 120.9750],
  [14.6740, 120.9780],
  [14.6700, 120.9800],
  [14.6640, 120.9820],
  [14.6571, 120.9840],
  [14.6500, 120.9840],
  [14.6450, 120.9835],
  [14.6400, 120.9828],
  [14.6334, 120.9810],
  [14.6280, 120.9820],
  [14.6240, 120.9825],
  [14.6150, 120.9835],
  [14.6100, 120.9840],
  [14.6048, 120.9850],
  [14.6037, 120.9840],
];

// ── Inner map component — only mounts when zones are ready ─────────────────
function LeafletMap({ zones, sel, onSel }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const mks    = useRef([]);

  // Init map once
  useEffect(() => {
    if (!mapEl.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.975],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19 }
    ).addTo(map);
    L.polyline(CORRIDOR, { color:"#1976d2", weight:3, opacity:0.55, dashArray:"6,4" }).addTo(map);
    L.circleMarker([14.7187,120.957],{radius:7,color:"#fff",fillColor:"#2e7d32",fillOpacity:1,weight:2})
      .bindTooltip("🚉 Malanday Terminal").addTo(map);
    L.circleMarker([14.6037,120.983],{radius:7,color:"#fff",fillColor:"#c62828",fillOpacity:1,weight:2})
      .bindTooltip("🚉 Recto Terminal").addTo(map);
    mapRef.current = map;
    // Critical: invalidate after a tick so container is measured
    setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || zones.length === 0) return;
    mks.current.forEach(m => map.removeLayer(m));
    mks.current = [];
    const maxC = Math.max(...zones.map(z => z.point_count), 1);
    zones.forEach(zone => {
      const isActive = sel === zone.cluster_id;
      const color = TIER_COLOR[zone.demand_tier] || "#1565c0";
      const r = 7 + Math.round((zone.point_count / maxC) * 18);
      const glow = L.circleMarker([zone.lat, zone.lon], {
        radius: r+9, color, fillColor: color, fillOpacity: isActive ? 0.22 : 0.08, weight: 0,
      }).addTo(map);
      const dot = L.circleMarker([zone.lat, zone.lon], {
        radius: r,
        color: isActive ? "#ffffff" : color,
        fillColor: color,
        fillOpacity: isActive ? 1 : 0.82,
        weight: isActive ? 2.5 : 1.5,
      }).addTo(map);
      dot.bindTooltip(`
        <div style="font-family:DM Sans,sans-serif;min-width:150px;font-size:12px;line-height:1.5">
          <strong style="font-size:13px">${zone.rank===1?"⭐ Busiest Zone":`Stop Zone #${zone.rank}`}</strong><br/>
          <span style="color:${color};font-weight:700">${TIER_LABEL[zone.demand_tier]||zone.demand_tier}</span><br/>
          <span style="color:#888">${zone.point_count} GPS logs · avg ${Math.round(zone.avg_occupancy)} pax</span>
        </div>
      `, { sticky: true, opacity: 0.96 });
      dot.on("click", () => onSel(prev => prev === zone.cluster_id ? null : zone.cluster_id));
      mks.current.push(glow, dot);
    });
    const bounds = L.latLngBounds(zones.map(z => [z.lat, z.lon]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding:[32,32], maxZoom:15 });
  }, [zones, sel, onSel]);

  return (
    <div
      ref={mapEl}
      style={{
        height: 320,
        margin: "10px 12px 0",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    />
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function StopZoneMap({ routeId = "MR-001" }) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [meta,    setMeta]    = useState(null);
  const [sel,     setSel]     = useState(null);

  useEffect(() => {
    let dead = false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => { if (!r.ok) throw new Error(`Server ${r.status}`); return r.json(); })
      .then(d => {
        if (dead) return;
        setZones(d.stop_zones || []);
        setMeta({ count: (d.stop_zones||[]).length, trips: d.total_trips_analyzed });
        setLoading(false);
      })
      .catch(e => { if (!dead) { setError(e.message); setLoading(false); } });
    return () => { dead = true; };
  }, [routeId]);

  const selZone = zones.find(z => z.cluster_id === sel);

  return (
    <div style={{
      margin: "12px 0 0",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 20,
      overflow: "hidden",
      fontFamily: "'DM Sans',sans-serif",
      paddingBottom: zones.length > 0 && !loading ? 14 : 0,
    }}>

      {/* Header */}
      <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
          <span style={{ fontSize:18 }}>🗺</span>
          <span style={{ fontWeight:800, fontSize:15, color:"#fff", letterSpacing:"-0.3px" }}>
            Where to Board &amp; Alight
          </span>
        </div>
        <p style={{ margin:0, fontSize:11, color:"rgba(255,255,255,0.45)", lineHeight:1.4 }}>
          {loading ? "Analyzing corridor data…"
            : error ? "Could not load stop zones"
            : meta ? `${meta.count} stop zones from ${meta.trips} recorded trips`
            : ""}
        </p>
      </div>

      {/* Instruction */}
      {!loading && !error && zones.length > 0 && (
        <div style={{
          padding:"8px 16px", fontSize:11, color:"rgba(255,255,255,0.55)", lineHeight:1.5,
          background:"rgba(21,101,192,0.10)", borderBottom:"1px solid rgba(255,255,255,0.06)",
        }}>
          <strong style={{color:"rgba(255,255,255,0.80)"}}>📍 How to use:</strong>
          {" "}Circles show where jeepneys most frequently stop.{" "}
          <strong style={{color:"#ffd60a"}}>Bigger = busier.</strong>
          {" "}Tap any circle for details.
        </div>
      )}

      {/* Selected zone detail */}
      {selZone && (
        <div style={{
          margin:"10px 12px 0", padding:"10px 14px",
          background:"rgba(255,255,255,0.08)",
          border:`2px solid ${TIER_COLOR[selZone.demand_tier]||"#1565c0"}`,
          borderRadius:12, display:"flex", justifyContent:"space-between",
          alignItems:"center", gap:8,
        }}>
          <div>
            <div style={{fontWeight:800,fontSize:13,color:"#fff",marginBottom:2}}>
              {selZone.rank===1?"⭐ Busiest Stop Zone":`Stop Zone #${selZone.rank}`}
            </div>
            <div style={{fontSize:12,color:TIER_COLOR[selZone.demand_tier],fontWeight:700}}>
              {TIER_LABEL[selZone.demand_tier]}
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>
              {selZone.point_count} logs · avg {Math.round(selZone.avg_occupancy)} pax · {selZone.peak_period}
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{
            background:"rgba(255,255,255,0.10)",border:"none",borderRadius:8,
            color:"rgba(255,255,255,0.50)",padding:"4px 10px",
            cursor:"pointer",fontSize:13,fontFamily:"inherit",
          }}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{textAlign:"center",padding:"48px 20px",color:"rgba(255,255,255,0.40)"}}>
          <div style={{
            width:28,height:28,border:"3px solid rgba(255,255,255,0.10)",
            borderTopColor:"rgba(255,255,255,0.65)",borderRadius:"50%",
            animation:"szm-spin 0.8s linear infinite",margin:"0 auto 12px",
          }}/>
          <p style={{margin:0,fontSize:13}}>Analyzing corridor data…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          margin:12,padding:"10px 14px",
          background:"rgba(198,40,40,0.12)",border:"1px solid rgba(198,40,40,0.28)",
          borderRadius:10,fontSize:13,color:"#ffb3ae",
        }}>
          ⚠️ Could not load stop zones — {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && zones.length===0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"rgba(255,255,255,0.40)"}}>
          <div style={{fontSize:36,marginBottom:10}}>📍</div>
          <p style={{margin:0,fontSize:14,fontWeight:700,color:"#fff"}}>No stop zones published yet</p>
          <p style={{margin:"6px 0 0",fontSize:12}}>
            An administrator must publish stop zones before they appear here.
          </p>
        </div>
      )}

      {/* The map — only render when we have zones */}
      {!loading && !error && zones.length > 0 && (
        <LeafletMap zones={zones} sel={sel} onSel={setSel} />
      )}

      {/* Legend */}
      {!loading && !error && zones.length > 0 && (
        <div style={{
          padding:"10px 16px 0", marginTop:8,
          display:"flex",flexWrap:"wrap",gap:"6px 14px",
          borderTop:"1px solid rgba(255,255,255,0.07)",
        }}>
          {Object.entries(TIER_COLOR).map(([tier,color])=>(
            <span key={tier} style={{
              display:"flex",alignItems:"center",gap:5,
              fontSize:11,color:"rgba(255,255,255,0.60)",fontWeight:600,
            }}>
              <span style={{width:9,height:9,borderRadius:"50%",background:color,display:"inline-block"}}/>
              {tier}
            </span>
          ))}
          <span style={{width:"100%",fontSize:10,color:"rgba(255,255,255,0.30)",marginTop:2}}>
            Bigger circle = more recorded stops at that location
          </span>
        </div>
      )}

      <style>{`@keyframes szm-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
