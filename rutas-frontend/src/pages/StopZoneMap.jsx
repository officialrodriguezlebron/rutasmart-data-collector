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

// GTFS corridor LTFRB_PUJ1426 — corrected to match reference map
// Route stays nearly straight south — no westward diagonal detour
const CORRIDOR = [
  [14.719025, 120.9575194],
  [14.7186437, 120.9573102],
  [14.7183142, 120.9571868],
  [14.7179251, 120.9571063],
  [14.7174581, 120.9571921],
  [14.7172116, 120.9572672],
  [14.7169548, 120.9573423],
  [14.7166098, 120.9574684],
  [14.7161234, 120.9576307],
  [14.7157407, 120.9577607],
  [14.7146223, 120.9580675],
  [14.7135038, 120.9584602],
  [14.7123853, 120.9587884],
  [14.7112668, 120.9591811],
  [14.7101483, 120.9595415],
  [14.7090299, 120.9599019],
  [14.7067929, 120.9606013],
  [14.7045715, 120.9612846],
  [14.7023293, 120.9620537],
  [14.7000664, 120.9627692],
  [14.697845, 120.9633988],
  [14.696745, 120.9638065],
  [14.6956034, 120.9641927],
  [14.6943477, 120.9640639],
  [14.6930712, 120.9640639],
  [14.6927754, 120.9642088],
  [14.6924693, 120.9645253],
  [14.6924745, 120.9649491],
  [14.6925108, 120.9653729],
  [14.6927806, 120.966553],
  [14.6928429, 120.9677332],
  [14.6928273, 120.9686183],
  [14.6925627, 120.9695035],
  [14.6920749, 120.9712308],
  [14.6914522, 120.9726363],
  [14.6910578, 120.9732317],
  [14.6905389, 120.9736555],
  [14.689431, 120.9742671],
  [14.6882816, 120.9748786],
  [14.6860244, 120.9761661],
  [14.6849061, 120.9768152],
  [14.6837671, 120.9773999],
  [14.6815098, 120.9785908],
  [14.6805472, 120.979079],
  [14.679543, 120.9794813],
  [14.6775347, 120.9802645],
  [14.6755472, 120.9810155],
  [14.6735389, 120.9818094],
  [14.6729239, 120.9819623],
  [14.672309, 120.9820293],
  [14.6710791, 120.9819918],
  [14.6685985, 120.982024],
  [14.6678668, 120.9821715],
  [14.6673323, 120.9826087],
  [14.6669534, 120.9829936],
  [14.6665746, 120.983357],
  [14.666175, 120.9837312],
  [14.6657339, 120.984041],
  [14.665512, 120.984151],
  [14.6652486, 120.9841537],
  [14.663767, 120.9840947],
  [14.6627731, 120.9840893],
  [14.6618416, 120.9840732],
  [14.6608425, 120.9840544],
  [14.6598435, 120.9839928],
  [14.6577312, 120.9838909],
  [14.657408, 120.9836411],
  [14.6570017, 120.9835415],
  [14.6567912, 120.9838144],
  [14.6559549, 120.9838667],
  [14.6532652, 120.9838426],
  [14.6508973, 120.9836897],
  [14.6484878, 120.9835797],
  [14.6461354, 120.9834697],
  [14.643783, 120.9834026],
  [14.6414514, 120.9833356],
  [14.6388499, 120.9832256],
  [14.6378053, 120.9829579],
  [14.6371343, 120.9826044],
  [14.6354602, 120.9818115],
  [14.6337862, 120.9810615],
  [14.6319875, 120.9804403],
  [14.6305549, 120.9798663],
  [14.6292884, 120.979464],
  [14.6278974, 120.9789973],
  [14.6265894, 120.9785306],
  [14.6257493, 120.9784616],
  [14.6256247, 120.9796149],
  [14.6249811, 120.9804008],
  [14.6242959, 120.9811009],
  [14.6230553, 120.9810633],
  [14.622993, 120.9819646],
  [14.6211919, 120.9818921],
  [14.6193907, 120.9818626],
  [14.6193648, 120.9833379],
  [14.6192973, 120.9848131],
  [14.6171327, 120.9847433],
  [14.6156819, 120.9846065],
  [14.614231, 120.9844697],
  [14.6126088, 120.9843517],
  [14.6109452, 120.9842337],
  [14.6092815, 120.9840942],
  [14.6076178, 120.9840406],
  [14.6075347, 120.9855158],
  [14.6072882, 120.9858537],
  [14.6066679, 120.9857625],
  [14.6049859, 120.9854353],
  [14.6034701, 120.9849794],
  [14.6033975, 120.9845663],
  [14.6034961, 120.9840567]
];

function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,p=Math.PI/180;
  const a=Math.sin((lat2-lat1)*p/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function snapToRoad(lat,lon){
  let bLat=lat,bLon=lon,bDist=Infinity;
  for(let i=0;i<CORRIDOR.length-1;i++){
    const[ax,ay]=CORRIDOR[i],[bx,by]=CORRIDOR[i+1];
    const dx=bx-ax,dy=by-ay;
    const t=dx===0&&dy===0?0:Math.max(0,Math.min(1,((lat-ax)*dx+(lon-ay)*dy)/(dx*dx+dy*dy)));
    const sLat=ax+t*dx,sLon=ay+t*dy;
    const d=haversine(lat,lon,sLat,sLon);
    if(d<bDist){bDist=d;bLat=sLat;bLon=sLon;}
  }
  return{lat:bLat,lon:bLon};
}
function getTier(rank,total){
  const pct=rank/total;
  if(pct<=0.15)return{badge:"⭐ Frequent Stop",desc:"Jeepneys stop here very often. Best place to wait.",color:"#30d158",r:13};
  if(pct<=0.45)return{badge:"🚏 Regular Stop",desc:"Jeepneys stop here regularly.",color:"#ffd60a",r:9};
  return{badge:"🚏 Occasional Stop",desc:"Jeepneys sometimes stop here.",color:"#8e9ab0",r:6};
}
function peakLabel(p){
  return{"Morning Peak":"🌅 Busiest 6–9 AM","Afternoon Peak":"🌆 Busiest 4–7 PM",
    "Midday":"☀️ Busiest midday","Off-Peak":"🌙 Busiest off-peak"}[p]||p;
}

function PassengerMap({zones,onClose}){
  const mapEl=useRef(null),mapRef=useRef(null),mksRef=useRef([]);
  const[sel,setSel]=useState(null);
  const[filter,setFilter]=useState("all");
  const total=zones.length;
  const snapped=zones.map(z=>({...z,...snapToRoad(z.lat,z.lon)}));

  useEffect(()=>{document.body.style.overflow="hidden";return()=>{document.body.style.overflow="";};});

  useEffect(()=>{
    if(!mapEl.current||mapRef.current)return;
    const map=L.map(mapEl.current,{
      center:[14.663,120.975],zoom:12,  // shows full route Malanday→Recto
      scrollWheelZoom:true,zoomControl:true,attributionControl:true});
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {subdomains:"abcd",maxZoom:19,attribution:"© CARTO © OSM"}).addTo(map);
    L.polyline(CORRIDOR,{color:"#42a5f5",weight:3,opacity:0.65,lineJoin:"round",lineCap:"round"}).addTo(map);
    [[14.7180,120.957,"🚉 Malanday"],[14.6035,120.983,"🚉 Recto LRT"]]
      .forEach(([la,lo,lbl])=>L.marker([la,lo],{icon:L.divIcon({
        html:`<div style="background:rgba(5,15,30,.92);border:2px solid #42a5f5;border-radius:8px;padding:4px 10px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5)">${lbl}</div>`,
        className:"",iconAnchor:[45,14]})}).addTo(map));
    mapRef.current=map;
    setTimeout(()=>map.invalidateSize(),200);
    return()=>{map.remove();mapRef.current=null;};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    mksRef.current.forEach(m=>map.removeLayer(m));
    mksRef.current=[];
    const visible=filter==="all"?snapped
      :filter==="frequent"?snapped.filter(z=>z.rank/total<=0.15)
      :snapped.filter(z=>z.rank/total<=0.45);
    visible.forEach(zone=>{
      const tier=getTier(zone.rank,total),isSel=sel===zone.cluster_id,isTop=zone.rank===1;
      if(isSel)mksRef.current.push(L.circleMarker([zone.lat,zone.lon],
        {radius:tier.r+14,color:tier.color,fillColor:tier.color,fillOpacity:0.18,weight:0}).addTo(map));
      const ring=L.circleMarker([zone.lat,zone.lon],{radius:tier.r+3,color:"#fff",
        fillColor:"transparent",fillOpacity:0,weight:isSel?2.5:1.8,opacity:isSel?1:0.35}).addTo(map);
      const dot=L.circleMarker([zone.lat,zone.lon],{radius:tier.r,color:"transparent",
        fillColor:tier.color,fillOpacity:isSel?1:0.88,weight:0}).addTo(map);
      dot.bindTooltip(`<div style="font-family:'DM Sans',sans-serif;min-width:185px;line-height:1.6;padding:4px 2px">
        <div style="font-weight:800;font-size:13px;color:#111;margin-bottom:3px">${tier.badge}${isTop?" <small style='color:#888'>— Busiest on route</small>":""}</div>
        <div style="font-size:11px;color:#555;border-top:1px solid #eee;padding-top:5px;margin-top:3px">${tier.desc}<br/>
        <span style="color:#1976d2;font-weight:600">${peakLabel(zone.peak_period)}</span></div></div>`,
        {sticky:true,opacity:0.98,maxWidth:240,direction:"top"});
      const click=()=>setSel(p=>p===zone.cluster_id?null:zone.cluster_id);
      dot.on("click",click);ring.on("click",click);
      mksRef.current.push(ring,dot);
      if(isTop||tier.r>=13)mksRef.current.push(L.marker([zone.lat,zone.lon],{icon:L.divIcon({
        html:`<span style="font-size:${isTop?14:11}px;pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.8)">${isTop?"⭐":"🚏"}</span>`,
        className:"",iconAnchor:[8,8]}),interactive:false,zIndexOffset:1000}).addTo(map));
    });
    // Fit to full corridor instead of just clusters
    const b=L.latLngBounds(CORRIDOR.map(c=>[c[0],c[1]]));
    if(b.isValid())map.fitBounds(b,{padding:[48,48],maxZoom:14});
  },[snapped,sel,filter,total]); // eslint-disable-line

  const selZone=snapped.find(z=>z.cluster_id===sel);
  const selTier=selZone?getTier(selZone.rank,total):null;
  const freqN=zones.filter(z=>z.rank/total<=0.15).length;
  const regN=zones.filter(z=>z.rank/total<=0.45).length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",flexDirection:"column",background:"#050f1e",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",background:"rgba(5,15,30,.96)",borderBottom:"1px solid rgba(255,255,255,.10)",backdropFilter:"blur(20px)",flexShrink:0,zIndex:2}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"-0.3px"}}>🚏 Where to Board &amp; Alight</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.42)",marginTop:2}}>Malanday → Recto · {freqN} frequent · {total} total · road-matched ✓</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.10)",border:"1px solid rgba(255,255,255,.18)",borderRadius:99,color:"#fff",padding:"8px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✕ Close</button>
      </div>
      <div style={{display:"flex",gap:8,padding:"10px 16px",background:"rgba(0,0,0,.45)",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0,zIndex:2,flexWrap:"wrap",alignItems:"center"}}>
        {[{key:"all",label:`All (${total})`,color:"#42a5f5"},{key:"frequent",label:`⭐ Frequent (${freqN})`,color:"#30d158"},{key:"regular",label:`Regular+ (${regN})`,color:"#ffd60a"}]
          .map(({key,label,color})=>(
          <button key={key} onClick={()=>setFilter(key)} style={{padding:"6px 14px",borderRadius:99,border:"1.5px solid",
            borderColor:filter===key?color:"rgba(255,255,255,.15)",background:filter===key?`${color}22`:"rgba(255,255,255,.06)",
            color:filter===key?"#fff":"rgba(255,255,255,.55)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>{label}</button>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,.28)",marginLeft:"auto"}}>Bigger = more reliable</span>
      </div>
      {selZone&&selTier&&(
        <div style={{padding:"12px 16px",background:`${selTier.color}18`,borderBottom:`2px solid ${selTier.color}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexShrink:0,zIndex:2}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:15,color:"#fff",marginBottom:4}}>{selTier.badge}{selZone.rank===1&&<span style={{color:"#ffd60a",marginLeft:8,fontSize:12}}>★ Busiest on route</span>}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.65)",lineHeight:1.55}}>{selTier.desc}<br/><span style={{color:"#42a5f5",fontWeight:600}}>{peakLabel(selZone.peak_period)}</span></div>
          </div>
          <button onClick={()=>setSel(null)} style={{background:"rgba(255,255,255,.10)",border:"none",borderRadius:8,color:"rgba(255,255,255,.50)",padding:"6px 12px",cursor:"pointer",fontSize:14,fontFamily:"inherit",flexShrink:0}}>✕</button>
        </div>
      )}
      <div ref={mapEl} style={{flex:1,zIndex:1}}/>
      <div style={{padding:"9px 16px",background:"rgba(0,0,0,.75)",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",gap:"14px",flexWrap:"wrap",alignItems:"center",flexShrink:0,zIndex:2}}>
        {[["#30d158","Frequent stop",13],["#ffd60a","Regular stop",9],["#8e9ab0","Occasional stop",6]].map(([c,l,r])=>(
          <span key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"rgba(255,255,255,.65)",fontWeight:600}}>
            <span style={{width:r,height:r,borderRadius:"50%",background:c,display:"inline-block",flexShrink:0}}/>{l}
          </span>
        ))}
        <span style={{fontSize:10,color:"rgba(255,255,255,.25)",marginLeft:"auto"}}>Road-matched · LTFRB GTFS</span>
      </div>
    </div>
  );
}

export default function StopZoneMap({routeId="MR-001"}){
  const[zones,setZones]=useState([]);
  const[loading,setLoading]=useState(true);
  const[open,setOpen]=useState(false);
  useEffect(()=>{
    let dead=false;
    fetch(`${API}/public/route/${routeId}/stop-zones`)
      .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();})
      .then(d=>{if(!dead){setZones(d.stop_zones||[]);setLoading(false);}})
      .catch(()=>{if(!dead)setLoading(false);});
    return()=>{dead=true;};
  },[routeId]);
  if(loading)return(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.10)",borderRadius:99,color:"rgba(255,255,255,.40)",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
      <span style={{width:13,height:13,border:"2px solid rgba(255,255,255,.12)",borderTopColor:"rgba(255,255,255,.55)",borderRadius:"50%",animation:"szm-s .8s linear infinite",display:"inline-block",flexShrink:0}}/>
      Finding boarding stops…<style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if(!zones.length)return null;
  const freqN=zones.filter(z=>z.rank/zones.length<=0.15).length;
  return(<>
    <button onClick={()=>setOpen(true)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"14px 18px",background:"rgba(25,118,210,.14)",border:"1.5px solid rgba(25,118,210,.38)",borderRadius:18,color:"#fff",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"background .15s",textAlign:"left"}}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(25,118,210,.26)"}
      onMouseLeave={e=>e.currentTarget.style.background="rgba(25,118,210,.14)"}>
      <span style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:26,background:"rgba(25,118,210,.22)",borderRadius:12,padding:"6px 10px",display:"flex",alignItems:"center"}}>🚏</span>
        <span>
          <span style={{display:"block",fontSize:15,fontWeight:800,letterSpacing:"-0.3px"}}>Where to Board &amp; Alight</span>
          <span style={{display:"block",fontSize:11,color:"rgba(255,255,255,.50)",fontWeight:500,marginTop:2}}>⭐ {freqN} frequent stops · {zones.length} total · tap to view</span>
        </span>
      </span>
      <span style={{background:"#1976d2",borderRadius:99,padding:"6px 16px",fontSize:12,fontWeight:800,color:"#fff",flexShrink:0,boxShadow:"0 2px 8px rgba(25,118,210,.40)"}}>View Map →</span>
    </button>
    {open&&<PassengerMap zones={zones} onClose={()=>setOpen(false)}/>}
  </>);
}
