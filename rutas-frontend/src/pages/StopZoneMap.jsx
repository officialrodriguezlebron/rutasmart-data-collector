/**
 * StopZoneMap — Boarding & Alighting Stop Zone Map
 * DBSCAN-detected stop zones shown as passenger boarding/alighting points.
 * Stop activity = how busy the stop is, NOT live jeepney occupancy.
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

// Stop activity — describes HOW BUSY a detected stop zone is
// based on number of GPS boarding/alighting events recorded there
const ACTIVITY = {
  Critical: { label:"Very Busy Stop",  desc:"Jeepneys often overcrowded here", color:"#ff453a", icon:"🔴" },
  High:     { label:"Busy Stop",       desc:"High boarding/alighting activity", color:"#ff9f0a", icon:"🟠" },
  Moderate: { label:"Moderate Stop",   desc:"Regular boarding/alighting",       color:"#ffd60a", icon:"🟡" },
  Normal:   { label:"Light Stop",      desc:"Occasional boarding/alighting",    color:"#30d158", icon:"🟢" },
};

// MacArthur Highway / Rizal Ave — Malanday to Recto
// Traced from OSM road geometry to avoid building shortcuts.
// Route: Malanday local roads → join MacArthur Hwy → south to Recto/Manila
const ROAD = [
  // ── Malanday terminal → local road east to MacArthur Hwy ──
  [14.7187, 120.9575],
  [14.7183, 120.9588],
  [14.7178, 120.9605],
  [14.7172, 120.9625],
  [14.7165, 120.9648],
  [14.7155, 120.9668],
  [14.7143, 120.9685],
  [14.7130, 120.9700],
  // ── Join MacArthur Highway (runs N-S at ~lon 120.981) ──
  [14.7115, 120.9718],
  [14.7098, 120.9738],
  [14.7080, 120.9755],
  [14.7060, 120.9768],
  [14.7040, 120.9778],
  [14.7020, 120.9785],
  [14.7013, 120.9792],  // ← cluster rank 1 area
  // ── MacArthur Hwy through Malabon/Caloocan — nearly straight ──
  [14.6995, 120.9800],
  [14.6978, 120.9808],
  [14.6960, 120.9813],
  [14.6940, 120.9815],
  [14.6920, 120.9817],
  [14.6900, 120.9820],
  [14.6880, 120.9822],
  [14.6860, 120.9824],
  [14.6840, 120.9825],
  [14.6820, 120.9826],
  // ── Grace Park / Kaunlaran — road stays on MacArthur Hwy ──
  [14.6800, 120.9827],
  [14.6780, 120.9828],
  [14.6760, 120.9829],
  [14.6740, 120.9830],
  [14.6720, 120.9831],
  [14.6700, 120.9832],
  // ── Maypajo area ──
  [14.6680, 120.9834],
  [14.6660, 120.9836],
  [14.6640, 120.9837],
  [14.6620, 120.9838],
  [14.6600, 120.9839],
  [14.6580, 120.9840],
  [14.6571, 120.9840],  // ← cluster rank 2/3
  [14.6555, 120.9840],
  [14.6535, 120.9840],
  [14.6515, 120.9839],
  // ── Caloocan/Manila boundary → Rizal Avenue ──
  [14.6495, 120.9838],
  [14.6475, 120.9836],
  [14.6455, 120.9835],
  [14.6435, 120.9833],
  [14.6415, 120.9831],
  [14.6395, 120.9828],
  [14.6375, 120.9826],
  [14.6355, 120.9822],
  [14.6334, 120.9818],  // ← cluster rank 4
  // ── Rizal Avenue through Manila ──
  [14.6315, 120.9820],
  [14.6295, 120.9821],
  [14.6275, 120.9822],
  [14.6255, 120.9823],
  [14.6235, 120.9824],
  [14.6215, 120.9825],
  [14.6195, 120.9827],
  [14.6175, 120.9830],
  [14.6155, 120.9832],
  [14.6135, 120.9834],
  [14.6115, 120.9836],
  [14.6095, 120.9838],
  [14.6075, 120.9840],
  [14.6055, 120.9842],
  [14.6048, 120.9848],  // ← cluster rank 65
  // ── Recto LRT terminal ──
  [14.6037, 120.9840],
];

// ── Full-screen overlay ────────────────────────────────────────────────────
function MapOverlay({ zones, onClose }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const mksRef = useRef([]);
  const [sel, setSel] = useState(null);
  const selZone = zones.find(z => z.cluster_id === sel);
  const selAct  = selZone ? (ACTIVITY[selZone.demand_tier] || ACTIVITY.Normal) : null;

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Init Leaflet once
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.9808],
      zoom: 13,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains:"abcd", maxZoom:19, attribution:"© CARTO © OSM" }).addTo(map);

    // Road corridor — dense waypoints, follows actual road geometry
    L.polyline(ROAD, {
      color: "#1976d2", weight: 4,
      opacity: 0.65, lineJoin: "round", lineCap: "round",
    }).addTo(map);

    // Terminals
    L.circleMarker([14.7187,120.9575],{radius:9,color:"#fff",fillColor:"#30d158",fillOpacity:1,weight:2.5})
      .bindTooltip("<strong>🚉 Malanday Terminal</strong>",{direction:"right"}).addTo(map);
    L.circleMarker([14.6037,120.9840],{radius:9,color:"#fff",fillColor:"#ff453a",fillOpacity:1,weight:2.5})
      .bindTooltip("<strong>🚉 Recto LRT Terminal</strong>",{direction:"right"}).addTo(map);

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Redraw markers when zones/selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zones.length) return;
    mksRef.current.forEach(m => map.removeLayer(m));
    mksRef.current = [];

    const maxC = Math.max(...zones.map(z => z.point_count), 1);

    zones.forEach(zone => {
      const act    = ACTIVITY[zone.demand_tier] || ACTIVITY.Normal;
      const active = sel === zone.cluster_id;
      const r      = 8 + Math.round((zone.point_count / maxC) * 22);
      const c      = act.color;

      const glow = L.circleMarker([zone.lat,zone.lon],{
        radius:r+8,color:c,fillColor:c,fillOpacity:active?0.22:0.08,weight:0,
      }).addTo(map);

      const dot = L.circleMarker([zone.lat,zone.lon],{
        radius:r,
        color:active?"#fff":c,
        fillColor:c,
        fillOpacity:active?1:0.85,
        weight:active?3:1.5,
      }).addTo(map);

      dot.bindTooltip(`
        <div style="font-family:'DM Sans',sans-serif;min-width:185px;line-height:1.55;padding:3px">
          <div style="font-weight:800;font-size:13px;margin-bottom:3px">
            ${zone.rank===1?"⭐ ":""}${act.icon} ${act.label}
          </div>
          <div style="color:${c};font-weight:700;font-size:12px">${act.desc}</div>
          <div style="color:#999;font-size:11px;margin-top:5px;border-top:1px solid #eee;padding-top:5px">
            📊 ${zone.point_count} boarding/alighting events<br/>
            🕐 Peak activity: <strong>${zone.peak_period}</strong>
          </div>
        </div>
      `, { sticky:true, opacity:0.97, maxWidth:240 });

      dot.on("click", () => setSel(p => p===zone.cluster_id ? null : zone.cluster_id));
      mksRef.current.push(glow, dot);
    });

    const b = L.latLngBounds(zones.map(z=>[z.lat,z.lon]));
    if (b.isValid()) map.fitBounds(b, { padding:[48,48], maxZoom:15 });
  }, [zones, sel]);

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:9999,
      display:"flex",flexDirection:"column",
      background:"#050f1e",
      fontFamily:"'DM Sans',sans-serif",
    }}>

      {/* Header */}
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"13px 16px",
        background:"rgba(5,15,30,0.96)",
        borderBottom:"1px solid rgba(255,255,255,0.10)",
        backdropFilter:"blur(20px)",
        flexShrink:0,zIndex:2,
      }}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"-0.3px"}}>
            🚏 Boarding &amp; Alighting Stops
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.42)",marginTop:2}}>
            {zones.length} stops detected by RutaSmart · tap a circle for details
          </div>
        </div>
        <button onClick={onClose} style={{
          background:"rgba(255,255,255,0.10)",
          border:"1px solid rgba(255,255,255,0.18)",
          borderRadius:99,color:"#fff",
          padding:"8px 18px",fontSize:13,fontWeight:700,
          cursor:"pointer",fontFamily:"inherit",
        }}>✕ Close</button>
      </div>

      {/* Selected stop detail */}
      {selZone && selAct && (
        <div style={{
          padding:"10px 16px",
          background:`${selAct.color}14`,
          borderBottom:`2px solid ${selAct.color}`,
          display:"flex",alignItems:"center",
          justifyContent:"space-between",
          flexShrink:0,zIndex:2,
        }}>
          <div>
            <div style={{fontWeight:800,fontSize:14,color:"#fff",marginBottom:2}}>
              {selAct.icon} {selAct.label}
              {selZone.rank===1 &&
                <span style={{color:"#ffd60a",marginLeft:8,fontSize:12,fontWeight:700}}>★ Busiest on route</span>}
            </div>
            <div style={{fontSize:12,color:selAct.color,fontWeight:600}}>{selAct.desc}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.42)",marginTop:2}}>
              {selZone.point_count} events · Peak: {selZone.peak_period}
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{
            background:"rgba(255,255,255,0.10)",border:"none",borderRadius:8,
            color:"rgba(255,255,255,0.50)",padding:"5px 12px",
            cursor:"pointer",fontSize:14,fontFamily:"inherit",flexShrink:0,
          }}>✕</button>
        </div>
      )}

      {/* Map */}
      <div ref={mapEl} style={{flex:1,zIndex:1}} />

      {/* Legend — stop activity, NOT jeepney status */}
      <div style={{
        padding:"9px 16px",
        background:"rgba(0,0,0,0.75)",
        borderTop:"1px solid rgba(255,255,255,0.07)",
        display:"flex",gap:"12px",flexWrap:"wrap",
        alignItems:"center",flexShrink:0,zIndex:2,
      }}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.38)",marginRight:2}}>
          Stop activity:
        </span>
        {[["Normal","🟢","Light"],["Moderate","🟡","Moderate"],["High","🟠","Busy"],["Critical","🔴","Very Busy"]].map(([k,icon,lbl])=>(
          <span key={k} style={{
            display:"flex",alignItems:"center",gap:5,
            fontSize:11,color:"rgba(255,255,255,0.70)",fontWeight:600,
          }}>
            <span style={{
              width:9,height:9,borderRadius:"50%",
              background:ACTIVITY[k].color,display:"inline-block",
            }}/>
            {lbl}
          </span>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginLeft:"auto"}}>
          Bigger = more events recorded
        </span>
      </div>
    </div>
  );
}

// ── Pill button ──────────────────────────────────────────────────────────────
export default function StopZoneMap({ routeId="MR-001" }) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta,    setMeta]    = useState(null);
  const [open,    setOpen]    = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        if (dead) return;
        setZones(d.stop_zones || []);
        setMeta({ count:(d.stop_zones||[]).length, trips:d.total_trips_analyzed });
        setLoading(false);
      })
      .catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [routeId]);

  if (loading) return (
    <div style={{
      display:"flex",alignItems:"center",gap:10,padding:"12px 16px",
      background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",
      borderRadius:99,color:"rgba(255,255,255,0.40)",
      fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
    }}>
      <span style={{
        width:13,height:13,
        border:"2px solid rgba(255,255,255,0.12)",
        borderTopColor:"rgba(255,255,255,0.55)",
        borderRadius:"50%",animation:"szm-s 0.8s linear infinite",
        display:"inline-block",flexShrink:0,
      }}/>
      Loading stop zones…
      <style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!zones.length) return null;

  return (
    <>
      <button
        onClick={()=>setOpen(true)}
        style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",
          width:"100%",padding:"13px 18px",
          background:"rgba(25,118,210,0.14)",
          border:"1.5px solid rgba(25,118,210,0.38)",
          borderRadius:99,color:"#fff",cursor:"pointer",
          fontFamily:"'DM Sans',sans-serif",
          transition:"background 0.15s",textAlign:"left",
        }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(25,118,210,0.26)"}
        onMouseLeave={e=>e.currentTarget.style.background="rgba(25,118,210,0.14)"}
      >
        <span style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>🚏</span>
          <span>
            <span style={{display:"block",fontSize:14,fontWeight:800,letterSpacing:"-0.2px"}}>
              Where to Board &amp; Alight
            </span>
            <span style={{display:"block",fontSize:11,color:"rgba(255,255,255,0.48)",fontWeight:500,marginTop:1}}>
              {meta?.count} stops detected · tap to view on map
            </span>
          </span>
        </span>
        <span style={{
          background:"rgba(25,118,210,0.30)",
          border:"1px solid rgba(255,255,255,0.16)",
          borderRadius:99,padding:"5px 14px",
          fontSize:12,fontWeight:700,
          color:"rgba(255,255,255,0.82)",flexShrink:0,
        }}>View Map →</span>
      </button>

      {open && <MapOverlay zones={zones} onClose={()=>setOpen(false)} />}
    </>
  );
}
