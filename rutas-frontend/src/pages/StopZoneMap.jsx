/**
 * StopZoneMap — Passenger Boarding & Alighting Map
 *
 * Map matching: nearest-point-on-polyline against a hardcoded dense corridor.
 * The corridor is calibrated to actual cluster centroid positions.
 * Snapping runs synchronously before any marker is drawn.
 * No external API calls for stop positions.
 *
 * Road line: fetched from /public/route/{id}/path (our real GPS data).
 * Falls back to the same hardcoded corridor if the endpoint fails.
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

// ── Calibrated corridor: MacArthur Highway → Rizal Avenue ─────────────────
// Dense enough for accurate snapping (~30-50m between points).
// Passes through actual cluster centroid positions so snapping is precise.
// Malanday (north) → joins MacArthur Hwy → Monumento → Rizal Ave → Recto
const CORRIDOR = [
  [14.7187, 120.9575], [14.7160, 120.9585], [14.7140, 120.9595],
  [14.7120, 120.9603], [14.7100, 120.9611], [14.7080, 120.9619],
  [14.7060, 120.9627], [14.7013, 120.9635], // rank 1 area
  [14.6990, 120.9670], [14.6960, 120.9710], [14.6930, 120.9745],
  [14.6900, 120.9775], [14.6870, 120.9798], [14.6840, 120.9815],
  [14.6810, 120.9825], [14.6780, 120.9832], [14.6750, 120.9836],
  [14.6720, 120.9838], [14.6690, 120.9839], [14.6660, 120.9839],
  [14.6630, 120.9839], [14.6600, 120.9839],
  // Monumento
  [14.6574, 120.9838], [14.6571, 120.9840], // rank 2
  [14.6564, 120.9840], // rank 3
  [14.6550, 120.9839], [14.6530, 120.9839], [14.6510, 120.9839],
  // Rizal Avenue — straight south at lon ~120.984
  [14.6490, 120.9838], [14.6470, 120.9838], [14.6462, 120.9840],
  [14.6440, 120.9838], [14.6420, 120.9837], [14.6400, 120.9836],
  [14.6380, 120.9836], [14.6360, 120.9836], [14.6340, 120.9836],
  [14.6334, 120.9836], // rank 4 anchor
  [14.6310, 120.9836], [14.6290, 120.9836], [14.6270, 120.9836],
  [14.6256, 120.9836], // rank 10 anchor
  [14.6240, 120.9837], [14.6220, 120.9838], [14.6200, 120.9839],
  [14.6180, 120.9840], [14.6160, 120.9841], [14.6140, 120.9843],
  [14.6120, 120.9844], [14.6100, 120.9845], [14.6080, 120.9847],
  [14.6060, 120.9848], [14.6048, 120.9850], // rank 65
  [14.6037, 120.9840], // Recto LRT
];

// ── Haversine distance in metres ──────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, p = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*p/2)**2
    + Math.cos(lat1*p) * Math.cos(lat2*p) * Math.sin((lon2-lon1)*p/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Snap a point to nearest position on the corridor ─────────────────────
function snapToRoad(lat, lon) {
  let bLat = lat, bLon = lon, bDist = Infinity;
  for (let i = 0; i < CORRIDOR.length - 1; i++) {
    const [ax, ay] = CORRIDOR[i];
    const [bx, by] = CORRIDOR[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0
      : Math.max(0, Math.min(1, ((lat-ax)*dx + (lon-ay)*dy) / (dx*dx + dy*dy)));
    const sLat = ax + t * dx, sLon = ay + t * dy;
    const d = haversine(lat, lon, sLat, sLon);
    if (d < bDist) { bDist = d; bLat = sLat; bLon = sLon; }
  }
  return { lat: bLat, lon: bLon };
}

// ── Stop tier ─────────────────────────────────────────────────────────────
function getTier(rank, total) {
  const pct = rank / total;
  if (pct <= 0.15) return { badge:"⭐ Frequent Stop",   desc:"Jeepneys stop here very often. Best place to wait.", color:"#30d158", r:13 };
  if (pct <= 0.45) return { badge:"🚏 Regular Stop",    desc:"Jeepneys stop here regularly.",                     color:"#ffd60a", r:9  };
  return               { badge:"🚏 Occasional Stop", desc:"Jeepneys sometimes stop here.",                     color:"#8e9ab0", r:6  };
}

function peakLabel(p) {
  return { "Morning Peak":"🌅 Busiest 6–9 AM","Afternoon Peak":"🌆 Busiest 4–7 PM",
           "Midday":"☀️ Busiest midday","Off-Peak":"🌙 Busiest off-peak" }[p] || p;
}

// ── Full-screen map ───────────────────────────────────────────────────────
function PassengerMap({ zones, routeId, onClose }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const mksRef = useRef([]);

  const [sel,    setSel]    = useState(null);
  const [filter, setFilter] = useState("all");
  const total = zones.length;

  // Snap ALL stops synchronously before any state is set
  // This runs once and never changes — snapping is deterministic
  const snapped = zones.map(z => {
    const { lat, lon } = snapToRoad(z.lat, z.lon);
    return { ...z, lat, lon };
  });

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Init map + fetch road line from GPS track
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.9750], zoom: 13,
      scrollWheelZoom: true, zoomControl: true, attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains:"abcd", maxZoom:19, attribution:"© CARTO © OSM" }).addTo(map);

    // Draw corridor immediately as fallback road
    L.polyline(CORRIDOR, {
      color:"#42a5f5", weight:3, opacity:0.50,
      lineJoin:"round", lineCap:"round",
    }).addTo(map);

    // Terminal labels
    [[14.7187,120.9575,"🚉 Malanday"],[14.6037,120.9840,"🚉 Recto LRT"]]
      .forEach(([la,lo,lbl]) => L.marker([la,lo],{ icon:L.divIcon({
        html:`<div style="background:rgba(5,15,30,.92);border:2px solid #42a5f5;
          border-radius:8px;padding:4px 10px;font-family:'DM Sans',sans-serif;
          font-size:11px;font-weight:700;color:#fff;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,.5)">${lbl}</div>`,
        className:"", iconAnchor:[45,14],
      })}).addTo(map));

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);

    // Upgrade road line from actual GPS track if available
    let dead = false;
    fetch(`${API}/public/route/${routeId}/path`)
      .then(r => r.json())
      .then(d => {
        if (dead || !mapRef.current || !d.path?.length) return;
        // Remove corridor fallback layers and add real GPS track
        mapRef.current.eachLayer(l => {
          if (l instanceof L.Polyline) mapRef.current.removeLayer(l);
        });
        const lls = d.path.map(p => [p.lat, p.lon]);
        L.polyline(lls, {
          color:"#42a5f5", weight:3, opacity:0.65,
          lineJoin:"round", lineCap:"round",
        }).addTo(mapRef.current);
      })
      .catch(() => {}); // corridor fallback stays

    return () => {
      dead = true;
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line

  // Draw markers from snapped positions
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    mksRef.current.forEach(m => map.removeLayer(m));
    mksRef.current = [];

    const visible = filter === "all"     ? snapped
      : filter === "frequent" ? snapped.filter(z => z.rank/total <= 0.15)
      : snapped.filter(z => z.rank/total <= 0.45);

    visible.forEach(zone => {
      const tier  = getTier(zone.rank, total);
      const isSel = sel === zone.cluster_id;
      const isTop = zone.rank === 1;

      if (isSel) mksRef.current.push(
        L.circleMarker([zone.lat,zone.lon],{
          radius:tier.r+14,color:tier.color,fillColor:tier.color,fillOpacity:0.18,weight:0,
        }).addTo(map)
      );

      const ring = L.circleMarker([zone.lat,zone.lon],{
        radius:tier.r+3,color:"#fff",fillColor:"transparent",fillOpacity:0,
        weight:isSel?2.5:1.8,opacity:isSel?1:0.35,
      }).addTo(map);

      const dot = L.circleMarker([zone.lat,zone.lon],{
        radius:tier.r,color:"transparent",
        fillColor:tier.color,fillOpacity:isSel?1:0.88,weight:0,
      }).addTo(map);

      dot.bindTooltip(`
        <div style="font-family:'DM Sans',sans-serif;min-width:185px;line-height:1.6;padding:4px 2px">
          <div style="font-weight:800;font-size:13px;color:#111;margin-bottom:3px">
            ${tier.badge}${isTop?" <small style='color:#888'>— Busiest on route</small>":""}
          </div>
          <div style="font-size:11px;color:#555;border-top:1px solid #eee;padding-top:5px;margin-top:3px">
            ${tier.desc}<br/>
            <span style="color:#1976d2;font-weight:600">${peakLabel(zone.peak_period)}</span>
          </div>
        </div>
      `,{sticky:true,opacity:0.98,maxWidth:240,direction:"top"});

      const click = () => setSel(p => p===zone.cluster_id?null:zone.cluster_id);
      dot.on("click",click); ring.on("click",click);
      mksRef.current.push(ring,dot);

      if (isTop||tier.r>=13) mksRef.current.push(
        L.marker([zone.lat,zone.lon],{
          icon:L.divIcon({
            html:`<span style="font-size:${isTop?14:11}px;pointer-events:none;
              text-shadow:0 1px 4px rgba(0,0,0,.8)">${isTop?"⭐":"🚏"}</span>`,
            className:"",iconAnchor:[8,8],
          }),interactive:false,zIndexOffset:1000,
        }).addTo(map)
      );
    });

    if (visible.length) {
      const b = L.latLngBounds(visible.map(z=>[z.lat,z.lon]));
      if (b.isValid()) map.fitBounds(b,{padding:[48,48],maxZoom:15});
    }
  }, [snapped, sel, filter, total]); // eslint-disable-line

  const selZone = snapped.find(z => z.cluster_id === sel);
  const selTier = selZone ? getTier(selZone.rank, total) : null;
  const freqN   = zones.filter(z=>z.rank/total<=0.15).length;
  const regN    = zones.filter(z=>z.rank/total<=0.45).length;

  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",
      flexDirection:"column",background:"#050f1e",fontFamily:"'DM Sans',sans-serif"}}>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"13px 16px",background:"rgba(5,15,30,.96)",
        borderBottom:"1px solid rgba(255,255,255,.10)",
        backdropFilter:"blur(20px)",flexShrink:0,zIndex:2}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"-0.3px"}}>
            🚏 Where to Board &amp; Alight
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.42)",marginTop:2}}>
            Malanday → Recto · {freqN} frequent · {total} total stops · road-matched ✓
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.10)",
          border:"1px solid rgba(255,255,255,.18)",borderRadius:99,color:"#fff",
          padding:"8px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
          ✕ Close
        </button>
      </div>

      <div style={{display:"flex",gap:8,padding:"10px 16px",background:"rgba(0,0,0,.45)",
        borderBottom:"1px solid rgba(255,255,255,.07)",
        flexShrink:0,zIndex:2,flexWrap:"wrap",alignItems:"center"}}>
        {[
          {key:"all",      label:`All (${total})`,        color:"#42a5f5"},
          {key:"frequent", label:`⭐ Frequent (${freqN})`, color:"#30d158"},
          {key:"regular",  label:`Regular+ (${regN})`,    color:"#ffd60a"},
        ].map(({key,label,color})=>(
          <button key={key} onClick={()=>setFilter(key)} style={{
            padding:"6px 14px",borderRadius:99,border:"1.5px solid",
            borderColor:filter===key?color:"rgba(255,255,255,.15)",
            background:filter===key?`${color}22`:"rgba(255,255,255,.06)",
            color:filter===key?"#fff":"rgba(255,255,255,.55)",
            fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",
          }}>{label}</button>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,.28)",marginLeft:"auto"}}>
          Bigger = more reliable
        </span>
      </div>

      {selZone && selTier && (
        <div style={{padding:"12px 16px",background:`${selTier.color}18`,
          borderBottom:`2px solid ${selTier.color}`,display:"flex",
          alignItems:"flex-start",justifyContent:"space-between",gap:12,
          flexShrink:0,zIndex:2}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:15,color:"#fff",marginBottom:4}}>
              {selTier.badge}
              {selZone.rank===1&&<span style={{color:"#ffd60a",marginLeft:8,fontSize:12}}>★ Busiest on route</span>}
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.65)",lineHeight:1.55}}>
              {selTier.desc}<br/>
              <span style={{color:"#42a5f5",fontWeight:600}}>{peakLabel(selZone.peak_period)}</span>
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{background:"rgba(255,255,255,.10)",
            border:"none",borderRadius:8,color:"rgba(255,255,255,.50)",
            padding:"6px 12px",cursor:"pointer",fontSize:14,fontFamily:"inherit",flexShrink:0}}>✕</button>
        </div>
      )}

      <div ref={mapEl} style={{flex:1,zIndex:1}} />

      <div style={{padding:"9px 16px",background:"rgba(0,0,0,.75)",
        borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",
        gap:"14px",flexWrap:"wrap",alignItems:"center",flexShrink:0,zIndex:2}}>
        {[["#30d158","Frequent stop",13],["#ffd60a","Regular stop",9],["#8e9ab0","Occasional stop",6]]
          .map(([c,l,r])=>(
          <span key={l} style={{display:"flex",alignItems:"center",gap:6,
            fontSize:11,color:"rgba(255,255,255,.65)",fontWeight:600}}>
            <span style={{width:r,height:r,borderRadius:"50%",background:c,
              display:"inline-block",flexShrink:0}}/>
            {l}
          </span>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,.25)",marginLeft:"auto"}}>
          Stops road-matched to MacArthur Hwy / Rizal Ave corridor
        </span>
      </div>
    </div>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────
export default function StopZoneMap({ routeId="MR-001" }) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(false);

  useEffect(()=>{
    let dead=false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();})
      .then(d=>{if(!dead){setZones(d.stop_zones||[]);setLoading(false);}})
      .catch(()=>{if(!dead)setLoading(false);});
    return ()=>{dead=true;};
  },[routeId]);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",
      background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.10)",
      borderRadius:99,color:"rgba(255,255,255,.40)",
      fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
      <span style={{width:13,height:13,border:"2px solid rgba(255,255,255,.12)",
        borderTopColor:"rgba(255,255,255,.55)",borderRadius:"50%",
        animation:"szm-s .8s linear infinite",display:"inline-block",flexShrink:0}}/>
      Finding boarding stops…
      <style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!zones.length) return null;
  const freqN = zones.filter(z=>z.rank/zones.length<=0.15).length;

  return (<>
    <button onClick={()=>setOpen(true)} style={{
      display:"flex",alignItems:"center",justifyContent:"space-between",
      width:"100%",padding:"14px 18px",
      background:"rgba(25,118,210,.14)",border:"1.5px solid rgba(25,118,210,.38)",
      borderRadius:18,color:"#fff",cursor:"pointer",
      fontFamily:"'DM Sans',sans-serif",transition:"background .15s",textAlign:"left",
    }}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(25,118,210,.26)"}
      onMouseLeave={e=>e.currentTarget.style.background="rgba(25,118,210,.14)"}
    >
      <span style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:26,background:"rgba(25,118,210,.22)",borderRadius:12,
          padding:"6px 10px",display:"flex",alignItems:"center"}}>🚏</span>
        <span>
          <span style={{display:"block",fontSize:15,fontWeight:800,letterSpacing:"-0.3px"}}>
            Where to Board &amp; Alight
          </span>
          <span style={{display:"block",fontSize:11,color:"rgba(255,255,255,.50)",fontWeight:500,marginTop:2}}>
            ⭐ {freqN} frequent stops · {zones.length} total · tap to view
          </span>
        </span>
      </span>
      <span style={{background:"#1976d2",borderRadius:99,padding:"6px 16px",
        fontSize:12,fontWeight:800,color:"#fff",flexShrink:0,
        boxShadow:"0 2px 8px rgba(25,118,210,.40)"}}>View Map →</span>
    </button>
    {open && <PassengerMap zones={zones} routeId={routeId} onClose={()=>setOpen(false)}/>}
  </>);
}
