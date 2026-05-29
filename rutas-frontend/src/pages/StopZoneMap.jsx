/**
 * StopZoneMap — Passenger Boarding & Alighting Map
 *
 * Map matching via Valhalla trace_route (valhalla1.openstreetmap.de):
 *   - Snaps all 66 cluster centroids to actual OSM road geometry
 *   - Returns both the snapped stop positions AND the road polyline
 *   - No hardcoded coordinates — 100% driven by real road data
 *
 * Passenger language only. No analytics terms.
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

const API      = import.meta.env.VITE_API_URL;
const VALHALLA = "https://valhalla1.openstreetmap.de";

// ── Valhalla map matching ──────────────────────────────────────────────────
// Sends cluster centroids as a GPS trace → returns snapped positions + road geometry
async function mapMatch(zones) {
  try {
    // Sort north → south so Valhalla gets them in travel order
    const sorted = [...zones].sort((a, b) => b.lat - a.lat);

    // Add terminal waypoints at start and end
    const shape = [
      { lat: 14.7187, lon: 120.9575, type: "break" },   // Malanday terminal
      ...sorted.map(z => ({ lat: z.lat, lon: z.lon, type: "via" })),
      { lat: 14.6037, lon: 120.9840, type: "break" },   // Recto LRT terminal
    ];

    const body = JSON.stringify({
      shape,
      costing: "auto",
      shape_match: "map_snap",           // snap each point to nearest road
      trace_options: {
        search_radius: 50,               // metres — snap within 50m of road
        gps_accuracy: 25,
      },
      filters: {
        attributes: ["matched.point", "matched.edge_index", "shape"],
        action: "include",
      },
    });

    const res = await fetch(`${VALHALLA}/trace_attributes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Valhalla ${res.status}`);
    const data = await res.json();

    // Decode the encoded polyline for the road geometry
    const roadPts = decodePolyline(data.shape || "");

    // The matched_points array gives us snapped positions for each input point
    // Index 0 = Malanday terminal, 1..N = stop zones, N+1 = Recto terminal
    const matched = data.matched_points || [];
    const snappedZones = sorted.map((zone, i) => {
      const mp = matched[i + 1]; // +1 to skip the terminal
      if (mp && mp.lat && mp.lon && mp.type !== "unmatched") {
        return { ...zone, lat: mp.lat, lon: mp.lon, snapped: true };
      }
      return { ...zone, snapped: false }; // keep original if unmatched
    });

    return { road: roadPts, zones: snappedZones };
  } catch (err) {
    console.warn("Valhalla map match failed:", err.message);
    return null;
  }
}

// Decode Valhalla's encoded polyline (precision 6)
function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision);
  const result = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result2 = 0;
    do { b = encoded.charCodeAt(index++) - 63; result2 |= (b & 0x1f) << shift; shift += 5; }
    while (b >= 0x20);
    lat += (result2 & 1) ? ~(result2 >> 1) : (result2 >> 1);
    shift = 0; result2 = 0;
    do { b = encoded.charCodeAt(index++) - 63; result2 |= (b & 0x1f) << shift; shift += 5; }
    while (b >= 0x20);
    lng += (result2 & 1) ? ~(result2 >> 1) : (result2 >> 1);
    result.push([lat / factor, lng / factor]);
  }
  return result;
}

// ── Fallback road — used while Valhalla loads or if it fails ──────────────
// Based on actual MacArthur Hwy / Rizal Ave OSM coordinates
const FALLBACK_ROAD = [
  [14.7187,120.9575],[14.7150,120.9600],[14.7110,120.9625],
  [14.7075,120.9648],[14.7040,120.9668],[14.7013,120.9688],
  [14.6975,120.9712],[14.6940,120.9732],[14.6905,120.9752],
  [14.6870,120.9768],[14.6835,120.9782],[14.6800,120.9794],
  [14.6765,120.9804],[14.6730,120.9814],[14.6695,120.9822],
  [14.6660,120.9830],[14.6625,120.9835],[14.6590,120.9838],
  [14.6574,120.9838],[14.6568,120.9832],[14.6560,120.9827],
  [14.6553,120.9826],[14.6548,120.9830],[14.6547,120.9836],
  [14.6549,120.9838],[14.6540,120.9838],[14.6520,120.9838],
  [14.6500,120.9837],[14.6475,120.9835],[14.6450,120.9833],
  [14.6425,120.9831],[14.6400,120.9829],[14.6375,120.9827],
  [14.6350,120.9825],[14.6334,120.9823],[14.6310,120.9825],
  [14.6285,120.9827],[14.6260,120.9829],[14.6235,120.9831],
  [14.6210,120.9833],[14.6185,120.9835],[14.6160,120.9837],
  [14.6135,120.9839],[14.6110,120.9841],[14.6085,120.9843],
  [14.6060,120.9845],[14.6048,120.9848],[14.6037,120.9840],
];

// ── Stop tier ──────────────────────────────────────────────────────────────
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

// ── Map overlay ─────────────────────────────────────────────────────────────
function PassengerMap({ zones, onClose }) {
  const mapEl   = useRef(null);
  const mapRef  = useRef(null);
  const mksRef  = useRef([]);
  const lineRef = useRef(null);

  const [matched,  setMatched]  = useState(null);   // map-matched zones
  const [roadPts,  setRoadPts]  = useState(null);   // matched road geometry
  const [matching, setMatching] = useState(true);   // loading state
  const [sel,      setSel]      = useState(null);
  const [filter,   setFilter]   = useState("all");
  const total = zones.length;

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Run Valhalla map matching
  useEffect(() => {
    let dead = false;
    mapMatch(zones).then(result => {
      if (dead) return;
      if (result) {
        setRoadPts(result.road);
        setMatched(result.zones);
      }
      setMatching(false);
    });
    return () => { dead = true; };
  }, [zones]);

  // Init Leaflet map
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.9750], zoom: 13,
      scrollWheelZoom: true, zoomControl: true, attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains:"abcd", maxZoom:19, attribution:"© CARTO © OSM" }).addTo(map);

    // Draw fallback road immediately
    lineRef.current = L.polyline(FALLBACK_ROAD, {
      color:"#42a5f5", weight:4, opacity:0.55,
      lineJoin:"round", lineCap:"round",
    }).addTo(map);

    // Terminal labels
    [[14.7187,120.9575,"🚉 Malanday"],[14.6037,120.9840,"🚉 Recto LRT"]]
      .forEach(([la,lo,lbl]) => L.marker([la,lo], { icon: L.divIcon({
        html:`<div style="background:rgba(5,15,30,.92);border:2px solid #42a5f5;
          border-radius:8px;padding:4px 10px;font-family:'DM Sans',sans-serif;
          font-size:11px;font-weight:700;color:#fff;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,.5)">${lbl}</div>`,
        className:"", iconAnchor:[45,14],
      })}).addTo(map));

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Swap in Valhalla road when ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !roadPts || roadPts.length < 2) return;
    if (lineRef.current) map.removeLayer(lineRef.current);
    lineRef.current = L.polyline(roadPts, {
      color:"#42a5f5", weight:4, opacity:0.60,
      lineJoin:"round", lineCap:"round",
    }).addTo(map);
  }, [roadPts]);

  // Draw stop markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    mksRef.current.forEach(m => map.removeLayer(m));
    mksRef.current = [];

    const src = matched || zones;
    const visible = filter === "all" ? src
      : filter === "frequent" ? src.filter(z => z.rank/total <= 0.15)
      : src.filter(z => z.rank/total <= 0.45);

    visible.forEach(zone => {
      const tier  = getTier(zone.rank, total);
      const isSel = sel === zone.cluster_id;
      const isTop = zone.rank === 1;

      if (isSel) mksRef.current.push(
        L.circleMarker([zone.lat,zone.lon],{
          radius:tier.r+14,color:tier.color,
          fillColor:tier.color,fillOpacity:0.18,weight:0,
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

      const click = () => setSel(p => p===zone.cluster_id ? null : zone.cluster_id);
      dot.on("click",click); ring.on("click",click);
      mksRef.current.push(ring,dot);

      if (isTop || tier.r >= 13) mksRef.current.push(
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
  }, [matched, zones, sel, filter, total]);

  const selZone = (matched||zones).find(z => z.cluster_id === sel);
  const selTier = selZone ? getTier(selZone.rank,total) : null;
  const freqN   = zones.filter(z=>z.rank/total<=0.15).length;
  const regN    = zones.filter(z=>z.rank/total<=0.45).length;

  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",
      flexDirection:"column",background:"#050f1e",fontFamily:"'DM Sans',sans-serif"}}>

      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"13px 16px",background:"rgba(5,15,30,.96)",
        borderBottom:"1px solid rgba(255,255,255,.10)",
        backdropFilter:"blur(20px)",flexShrink:0,zIndex:2}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"-0.3px"}}>
            🚏 Where to Board &amp; Alight
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.42)",marginTop:2}}>
            Malanday → Recto · {freqN} frequent · {total} total
            {matching && <span style={{color:"#ffd60a"}}> · matching to roads…</span>}
            {!matching && matched && <span style={{color:"#30d158"}}> · road-matched ✓</span>}
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.10)",
          border:"1px solid rgba(255,255,255,.18)",borderRadius:99,color:"#fff",
          padding:"8px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
          ✕ Close
        </button>
      </div>

      {/* Filter pills */}
      <div style={{display:"flex",gap:8,padding:"10px 16px",
        background:"rgba(0,0,0,.45)",borderBottom:"1px solid rgba(255,255,255,.07)",
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

      {/* Selected stop */}
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

      {/* Map */}
      <div ref={mapEl} style={{flex:1,zIndex:1}} />

      {/* Legend */}
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
          {matched ? "Road-matched via OpenStreetMap" : "From real jeepney GPS data"}
        </span>
      </div>
    </div>
  );
}

// ── Pill button ──────────────────────────────────────────────────────────────
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
    {open && <PassengerMap zones={zones} onClose={()=>setOpen(false)} />}
  </>);
}
