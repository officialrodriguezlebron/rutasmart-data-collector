/**
 * StopZoneMap — "Where to Board & Alight"
 * Appears as a pill button. Tapping opens a full-screen map overlay.
 * Matches RutaSmart dark glassmorphism design exactly.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const API = import.meta.env.VITE_API_URL;

const TIER_COLOR = { Normal:"#30d158", Moderate:"#ffd60a", High:"#ff9f0a", Critical:"#ff453a" };
const TIER_LABEL = { Normal:"Light demand", Moderate:"Filling up", High:"Heavy demand", Critical:"Overcrowded" };

// Calibrated to actual GPS centroids from field data
const CORRIDOR = [
  [14.7187,120.9575],[14.7120,120.9590],[14.7013,120.9620],
  [14.6960,120.9645],[14.6900,120.9680],[14.6850,120.9718],
  [14.6800,120.9750],[14.6740,120.9780],[14.6700,120.9800],
  [14.6640,120.9820],[14.6571,120.9840],[14.6500,120.9840],
  [14.6450,120.9835],[14.6400,120.9828],[14.6334,120.9810],
  [14.6280,120.9820],[14.6240,120.9825],[14.6150,120.9835],
  [14.6100,120.9840],[14.6048,120.9850],[14.6037,120.9840],
];

// ── Full-screen map overlay ─────────────────────────────────────────────────
function MapOverlay({ zones, onClose }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const [sel, setSel] = useState(null);
  const selZone = zones.find(z => z.cluster_id === sel);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Init map
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.975],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains:"abcd", maxZoom:19 }).addTo(map);
    L.polyline(CORRIDOR, { color:"#42a5f5", weight:3, opacity:0.55, dashArray:"6,4" }).addTo(map);
    [[14.7187,120.9575,"🚉 Malanday","#30d158"],[14.6037,120.984,"🚉 Recto LRT","#ff453a"]]
      .forEach(([lat,lon,tip,c]) =>
        L.circleMarker([lat,lon],{radius:7,color:"#fff",fillColor:c,fillOpacity:1,weight:2})
          .bindTooltip(tip,{permanent:false}).addTo(map));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zones.length) return;
    // clear existing markers (keep polyline + terminals)
    map.eachLayer(l => { if (l instanceof L.CircleMarker && !l._isTerminal) map.removeLayer(l); });
    const maxC = Math.max(...zones.map(z => z.point_count), 1);
    zones.forEach(zone => {
      const active = sel === zone.cluster_id;
      const color  = TIER_COLOR[zone.demand_tier] || "#42a5f5";
      const r      = 8 + Math.round((zone.point_count / maxC) * 20);
      L.circleMarker([zone.lat,zone.lon],{
        radius:r+10,color,fillColor:color,fillOpacity:active?0.25:0.10,weight:0,
      }).addTo(map);
      const dot = L.circleMarker([zone.lat,zone.lon],{
        radius:r,
        color: active?"#fff":color,
        fillColor:color,
        fillOpacity:active?1:0.82,
        weight:active?2.5:1.5,
      }).addTo(map);
      dot.bindTooltip(`
        <div style="font-family:'DM Sans',sans-serif;min-width:155px;font-size:12px;line-height:1.55">
          <strong>${zone.rank===1?"⭐ Busiest Stop Zone":`Stop Zone #${zone.rank}`}</strong><br/>
          <span style="color:${color};font-weight:700">${TIER_LABEL[zone.demand_tier]||zone.demand_tier}</span><br/>
          <span style="color:#888">${zone.point_count} GPS logs · avg ${Math.round(zone.avg_occupancy)} pax · ${zone.peak_period}</span>
        </div>`,{sticky:true,opacity:0.97});
      dot.on("click",()=>setSel(p=>p===zone.cluster_id?null:zone.cluster_id));
    });
    const bounds = L.latLngBounds(zones.map(z=>[z.lat,z.lon]));
    if (bounds.isValid()) map.fitBounds(bounds,{padding:[48,48],maxZoom:15});
  }, [zones, sel]);

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:9999,
      display:"flex",flexDirection:"column",
      background:"#050f1e",fontFamily:"'DM Sans',sans-serif",
    }}>
      {/* Top bar */}
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"14px 16px",
        background:"rgba(255,255,255,0.08)",
        borderBottom:"1px solid rgba(255,255,255,0.12)",
        backdropFilter:"blur(20px)",
        flexShrink:0,
        zIndex:2,
      }}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"-0.3px"}}>
            🗺 Where to Board &amp; Alight
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>
            {zones.length} stop zones · tap a circle for details
          </div>
        </div>
        <button onClick={onClose} style={{
          background:"rgba(255,255,255,0.12)",
          border:"1px solid rgba(255,255,255,0.18)",
          borderRadius:99,color:"#fff",
          padding:"7px 16px",fontSize:13,fontWeight:700,
          cursor:"pointer",fontFamily:"inherit",
        }}>✕ Close</button>
      </div>

      {/* Selected zone strip */}
      {selZone && (
        <div style={{
          padding:"10px 16px",
          background:`${TIER_COLOR[selZone.demand_tier]}18`,
          borderBottom:`2px solid ${TIER_COLOR[selZone.demand_tier]}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",
          flexShrink:0,zIndex:2,
        }}>
          <div>
            <span style={{fontWeight:800,fontSize:13,color:"#fff"}}>
              {selZone.rank===1?"⭐ Busiest Stop Zone":`Stop Zone #${selZone.rank}`}
            </span>
            {" · "}
            <span style={{fontSize:13,color:TIER_COLOR[selZone.demand_tier],fontWeight:700}}>
              {TIER_LABEL[selZone.demand_tier]}
            </span>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.50)",marginTop:2}}>
              {selZone.point_count} GPS logs · avg {Math.round(selZone.avg_occupancy)} pax · {selZone.peak_period}
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{
            background:"rgba(255,255,255,0.10)",border:"none",borderRadius:8,
            color:"rgba(255,255,255,0.55)",padding:"4px 10px",cursor:"pointer",
            fontSize:13,fontFamily:"inherit",flexShrink:0,
          }}>✕</button>
        </div>
      )}

      {/* Map — fills remaining space */}
      <div ref={mapEl} style={{ flex:1, zIndex:1 }} />

      {/* Legend bar */}
      <div style={{
        padding:"10px 16px",
        background:"rgba(0,0,0,0.50)",
        borderTop:"1px solid rgba(255,255,255,0.08)",
        display:"flex",gap:"14px",flexWrap:"wrap",alignItems:"center",
        flexShrink:0,zIndex:2,
      }}>
        {Object.entries(TIER_COLOR).map(([tier,color])=>(
          <span key={tier} style={{
            display:"flex",alignItems:"center",gap:5,
            fontSize:11,color:"rgba(255,255,255,0.65)",fontWeight:600,
          }}>
            <span style={{width:9,height:9,borderRadius:"50%",background:color,display:"inline-block"}}/>
            {tier}
          </span>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,0.30)",marginLeft:"auto"}}>
          Bigger circle = more GPS logs recorded
        </span>
      </div>
    </div>
  );
}

// ── Main component — just the pill button + overlay ─────────────────────────
export default function StopZoneMap({ routeId = "MR-001" }) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [meta,    setMeta]    = useState(null);
  const [open,    setOpen]    = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => {
        if (dead) return;
        setZones(d.stop_zones || []);
        setMeta({ count:(d.stop_zones||[]).length, trips:d.total_trips_analyzed });
        setLoading(false);
      })
      .catch(e => { if (!dead) { setError(e.message); setLoading(false); } });
    return () => { dead = true; };
  }, [routeId]);

  // Don't render anything until loaded
  if (loading) return (
    <div style={{
      display:"flex",alignItems:"center",gap:10,
      padding:"12px 16px",
      background:"rgba(255,255,255,0.05)",
      border:"1px solid rgba(255,255,255,0.10)",
      borderRadius:99,
      color:"rgba(255,255,255,0.45)",
      fontSize:13,fontWeight:600,
      fontFamily:"'DM Sans',sans-serif",
    }}>
      <span style={{
        width:14,height:14,border:"2px solid rgba(255,255,255,0.15)",
        borderTopColor:"rgba(255,255,255,0.60)",borderRadius:"50%",
        animation:"szm-s 0.8s linear infinite",display:"inline-block",flexShrink:0,
      }}/>
      Loading stop zones…
      <style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error || zones.length === 0) return null; // silent fail — don't clutter UI

  return (
    <>
      {/* The pill button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",
          width:"100%",
          padding:"13px 18px",
          background:"rgba(21,101,192,0.18)",
          border:"1.5px solid rgba(21,101,192,0.45)",
          borderRadius:99,
          color:"#fff",
          fontFamily:"'DM Sans',sans-serif",
          fontSize:14,fontWeight:700,
          cursor:"pointer",
          transition:"all 0.15s",
          textAlign:"left",
        }}
        onMouseEnter={e=>{e.currentTarget.style.background="rgba(21,101,192,0.30)";}}
        onMouseLeave={e=>{e.currentTarget.style.background="rgba(21,101,192,0.18)";}}
      >
        <span style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>🗺</span>
          <span>
            <span style={{display:"block",fontSize:14,fontWeight:800,letterSpacing:"-0.2px"}}>
              Where to Board &amp; Alight
            </span>
            <span style={{display:"block",fontSize:11,color:"rgba(255,255,255,0.55)",fontWeight:500,marginTop:1}}>
              {meta?.count} stop zones from {meta?.trips} trips · tap to view map
            </span>
          </span>
        </span>
        <span style={{
          background:"rgba(21,101,192,0.40)",
          border:"1px solid rgba(255,255,255,0.20)",
          borderRadius:99,padding:"4px 12px",fontSize:12,fontWeight:700,
          color:"rgba(255,255,255,0.85)",flexShrink:0,
        }}>View →</span>
      </button>

      {/* Full-screen overlay */}
      {open && <MapOverlay zones={zones} onClose={() => setOpen(false)} />}
    </>
  );
}
