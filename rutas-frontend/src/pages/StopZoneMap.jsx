/**
 * StopZoneMap — Passenger Boarding & Alighting Map
 *
 * Phase 2: direction is passed as a prop — no guessing, no /path fetch.
 *
 * direction prop → correct corridor selected immediately →
 * fetch stops from API with that direction → snap to corridor → draw.
 *
 * MALANDAY-RECTO uses CORRIDOR        (forward, 110 pts)
 * RECTO-MALANDAY uses RETURN_CORRIDOR (return,  156 pts)
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

import { CORRIDOR, RETURN_CORRIDOR } from "../data/corridor";
const API = import.meta.env.VITE_API_URL;

const DIR_LABELS = {
  "MALANDAY-RECTO": "Malanday → Recto",
  "RECTO-MALANDAY": "Recto → Malanday",
};

const TERMINALS = {
  "MALANDAY-RECTO": [
    [14.7190, 120.9575, "Malanday"],
    [14.6035, 120.9830, "Recto LRT"],
  ],
  "RECTO-MALANDAY": [
    [14.6036, 120.9829, "Recto LRT"],
    [14.7202, 120.9582, "Malanday"],
  ],
};

// ── Haversine + nearest-point-on-segment map matching ────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, p = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*p/2)**2
    + Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function snapToRoad(lat, lon, corridor) {
  let bLat = lat, bLon = lon, bDist = Infinity;
  for (let i = 0; i < corridor.length - 1; i++) {
    const [ax, ay] = corridor[i], [bx, by] = corridor[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0
      : Math.max(0, Math.min(1, ((lat-ax)*dx + (lon-ay)*dy) / (dx*dx + dy*dy)));
    const sLat = ax + t*dx, sLon = ay + t*dy;
    const d = haversine(lat, lon, sLat, sLon);
    if (d < bDist) { bDist = d; bLat = sLat; bLon = sLon; }
  }
  return { lat: bLat, lon: bLon };
}

// ── Stop tier ─────────────────────────────────────────────────────────────
function getTier(rank, total) {
  const pct = rank / total;
  if (pct <= 0.15) return {
    badge: "Crowded",
    desc:  "Usually crowded — typical for this stop (based on past trips)",
    color: "#30d158", r: 13,
  };
  if (pct <= 0.45) return {
    badge: "Moderate",
    desc:  "Moderately busy — typical for this stop (based on past trips)",
    color: "#ffd60a", r: 9,
  };
  return {
    badge: "Has Space",
    desc:  "Usually has space — typical for this stop (based on past trips)",
    color: "#8e9ab0", r: 6,
  };
}

function peakLabel(p) {
  return { "Morning Peak":"Busiest 6–9 AM","Afternoon Peak":"Busiest 4–7 PM",
           "Midday":"Busiest midday","Off-Peak":"Busiest off-peak" }[p] || p;
}

// ── Full-screen map ───────────────────────────────────────────────────────
function PassengerMap({ zones, direction, onClose }) {
  const mapEl  = useRef(null);
  const mapRef = useRef(null);
  const mksRef = useRef([]);
  const [sel,    setSel]    = useState(null);
  const [filter, setFilter] = useState("all");

  // Pick corridor once — no async, no guessing
  const corridor = direction === "RECTO-MALANDAY" ? RETURN_CORRIDOR : CORRIDOR;
  const total    = zones.length;

  // Snap all stops synchronously to the correct corridor
  const snapped = zones.map(z => ({ ...z, ...snapToRoad(z.lat, z.lon, corridor) }));

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Init map — draw road and terminals immediately, no waiting
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [14.66, 120.975], zoom: 12,
      scrollWheelZoom: true, zoomControl: true, attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains:"abcd", maxZoom:19, attribution:"© CARTO © OSM" }).addTo(map);

    // Road line from the clean corridor — no GPS track, no async
    L.polyline(corridor, {
      color:"#42a5f5", weight:3, opacity:0.65,
      lineJoin:"round", lineCap:"round",
    }).addTo(map);

    // Terminal labels
    (TERMINALS[direction] || TERMINALS["MALANDAY-RECTO"]).forEach(([la, lo, lbl]) =>
      L.marker([la, lo], { icon: L.divIcon({
        html: `<div style="background:rgba(5,15,30,.92);border:2px solid #42a5f5;
          border-radius:8px;padding:4px 10px;font-family:'DM Sans',sans-serif;
          font-size:11px;font-weight:700;color:#fff;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,.5)">${lbl}</div>`,
        className:"", iconAnchor:[40,14],
      })}).addTo(map)
    );

    // Fit to corridor extent
    const b = L.latLngBounds(corridor.map(c => [c[0], c[1]]));
    if (b.isValid()) map.fitBounds(b, { padding:[40,40], maxZoom:14 });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line

  // Draw stop markers
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
        L.circleMarker([zone.lat, zone.lon], {
          radius:tier.r+14, color:tier.color, fillColor:tier.color, fillOpacity:0.18, weight:0,
        }).addTo(map)
      );

      const ring = L.circleMarker([zone.lat, zone.lon], {
        radius:tier.r+3, color:"#fff", fillColor:"transparent", fillOpacity:0,
        weight:isSel?2.5:1.8, opacity:isSel?1:0.35,
      }).addTo(map);

      const dot = L.circleMarker([zone.lat, zone.lon], {
        radius:tier.r, color:"transparent",
        fillColor:tier.color, fillOpacity:isSel?1:0.88, weight:0,
      }).addTo(map);

      dot.bindTooltip(`
        <div style="font-family:'DM Sans',sans-serif;min-width:190px;line-height:1.6;padding:4px 2px">
          <div style="font-weight:800;font-size:13px;color:#111;margin-bottom:2px">
            ${zone.name || "Boarding stop"}
          </div>
          <div style="font-size:11px;color:#666;margin-bottom:3px">
            ${tier.badge}${isTop?" · Busiest on route":""}
          </div>
          <div style="font-size:11px;color:#555;border-top:1px solid #eee;padding-top:5px;margin-top:3px">
            ${tier.desc}<br/>
            <span style="color:#1976d2;font-weight:600">${peakLabel(zone.peak_period)}</span>
          </div>
        </div>
      `, { sticky:true, opacity:0.98, maxWidth:260, direction:"top" });

      const click = () => setSel(p => p === zone.cluster_id ? null : zone.cluster_id);
      dot.on("click", click); ring.on("click", click);
      mksRef.current.push(ring, dot);

      if (isTop || tier.r >= 13) mksRef.current.push(
        L.marker([zone.lat, zone.lon], {
          icon: L.divIcon({
            html: `<span style="font-size:${isTop?14:11}px;pointer-events:none;
              text-shadow:0 1px 4px rgba(0,0,0,.8)">${isTop?"★":""}</span>`,
            className:"", iconAnchor:[8,8],
          }),
          interactive:false, zIndexOffset:1000,
        }).addTo(map)
      );
    });
  }, [snapped, sel, filter, total]); // eslint-disable-line

  const selZone = snapped.find(z => z.cluster_id === sel);
  const selTier = selZone ? getTier(selZone.rank, total) : null;
  const freqN   = snapped.filter(z => z.rank/total <= 0.15).length;
  const regN    = snapped.filter(z => z.rank/total <= 0.45).length;
  const isRet   = direction === "RECTO-MALANDAY";

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, display:"flex",
      flexDirection:"column", background:"#050f1e", fontFamily:"'DM Sans',sans-serif" }}>

      {/* Top bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"13px 16px", background:"rgba(5,15,30,.96)",
        borderBottom:"1px solid rgba(255,255,255,.10)",
        backdropFilter:"blur(20px)", flexShrink:0, zIndex:2 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:"#fff", letterSpacing:"-0.3px" }}>
            Where to Board &amp; Alight
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.42)", marginTop:2 }}>
            {DIR_LABELS[direction]} · {freqN} high demand · {total} total · road-matched
          </div>
        </div>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,.10)",
          border:"1px solid rgba(255,255,255,.18)", borderRadius:99, color:"#fff",
          padding:"8px 18px", fontSize:13, fontWeight:700,
          cursor:"pointer", fontFamily:"inherit" }}>Close</button>
      </div>

      {/* Filter pills + direction badge */}
      <div style={{ display:"flex", gap:8, padding:"10px 16px",
        background:"rgba(0,0,0,.45)", borderBottom:"1px solid rgba(255,255,255,.07)",
        flexShrink:0, zIndex:2, flexWrap:"wrap", alignItems:"center" }}>
        {[
          { key:"all",      label:`All stops (${total})`,    color:"#42a5f5" },
          { key:"frequent", label:`Crowded (${freqN})`,    color:"#30d158" },
          { key:"regular",  label:`Moderate+ (${regN})`,   color:"#ffd60a" },
        ].map(({ key, label, color }) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding:"6px 14px", borderRadius:99, border:"1.5px solid",
            borderColor: filter===key ? color : "rgba(255,255,255,.15)",
            background:  filter===key ? `${color}22` : "rgba(255,255,255,.06)",
            color:       filter===key ? "#fff" : "rgba(255,255,255,.55)",
            fontSize:12, fontWeight:700, cursor:"pointer",
            fontFamily:"inherit", transition:"all .15s",
          }}>{label}</button>
        ))}
        <span style={{
          marginLeft:"auto", padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:700,
          background: isRet ? "rgba(255,214,10,.15)" : "rgba(66,165,245,.15)",
          border: `1px solid ${isRet ? "#ffd60a44" : "#42a5f544"}`,
          color: isRet ? "#ffd60a" : "#42a5f5",
        }}>
          {isRet ? "Return trip" : "Forward trip"}
        </span>
      </div>

      {/* Selected stop panel */}
      {selZone && selTier && (
        <div style={{ padding:"12px 16px", background:`${selTier.color}18`,
          borderBottom:`2px solid ${selTier.color}`, display:"flex",
          alignItems:"flex-start", justifyContent:"space-between", gap:12,
          flexShrink:0, zIndex:2 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:15, color:"#fff", marginBottom:2 }}>
              {selZone.name || selTier.badge}
              {selZone.rank===1 && <span style={{ color:"#ffd60a", marginLeft:8, fontSize:12 }}>Busiest on route</span>}
            </div>
            <div style={{ fontSize:12, color:`${selTier.color}cc`, fontWeight:700, marginBottom:4 }}>
              {selTier.badge}
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,.60)", lineHeight:1.55 }}>
              {selTier.desc}<br/>
              <span style={{ color:"#42a5f5", fontWeight:600 }}>{peakLabel(selZone.peak_period)}</span>
            </div>
          </div>
          <button onClick={() => setSel(null)} style={{ background:"rgba(255,255,255,.10)",
            border:"none", borderRadius:8, color:"rgba(255,255,255,.50)",
            padding:"6px 12px", cursor:"pointer", fontSize:14,
            fontFamily:"inherit", flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* Map */}
      <div ref={mapEl} style={{ flex:1, zIndex:1 }} />

      {/* Legend */}
      <div style={{ padding:"9px 16px", background:"rgba(0,0,0,.75)",
        borderTop:"1px solid rgba(255,255,255,.07)", display:"flex",
        gap:"14px", flexWrap:"wrap", alignItems:"center", flexShrink:0, zIndex:2 }}>
        {[["#30d158","High demand (crowded)",13],["#ffd60a","Moderate demand",9],["#8e9ab0","Lower demand (has space)",6]]
          .map(([c,l,r]) => (
            <span key={l} style={{ display:"flex", alignItems:"center", gap:6,
              fontSize:11, color:"rgba(255,255,255,.65)", fontWeight:600 }}>
              <span style={{ width:r, height:r, borderRadius:"50%",
                background:c, display:"inline-block", flexShrink:0 }}/>
              {l}
            </span>
          ))}
        <span style={{ fontSize:10, color:"rgba(255,255,255,.25)", marginLeft:"auto" }}>
          Road-matched to jeep corridor
        </span>
      </div>
    </div>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────
// direction prop: "MALANDAY-RECTO" | "RECTO-MALANDAY"
// Fetches the correct stops from the API for that direction,
// then passes direction straight to PassengerMap — no guessing needed.
export default function StopZoneMap({
  routeId   = "MR-001",
  direction = "MALANDAY-RECTO",
}) {
  const [zones,   setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(false);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setZones([]);
    // Fetch stops for THIS direction from the API
    fetch(`${API}/public/route/${routeId}/stop-zones?direction=${direction}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!dead) { setZones(d.stop_zones || []); setLoading(false); } })
      .catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [routeId, direction]); // re-fetch when direction changes

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px",
      background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.10)",
      borderRadius:99, color:"rgba(255,255,255,.40)",
      fontSize:13, fontWeight:600, fontFamily:"'DM Sans',sans-serif" }}>
      <span style={{ width:13, height:13, border:"2px solid rgba(255,255,255,.12)",
        borderTopColor:"rgba(255,255,255,.55)", borderRadius:"50%",
        animation:"szm-s .8s linear infinite", display:"inline-block", flexShrink:0 }}/>
      Finding boarding stops…
      <style>{`@keyframes szm-s{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!zones.length) return (
    <div style={{ padding:"12px 16px",
      background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)",
      borderRadius:14, fontSize:13, color:"rgba(255,255,255,.35)",
      fontFamily:"'DM Sans',sans-serif" }}>
      Stop zones not yet published for {DIR_LABELS[direction] || direction}.
    </div>
  );

  const freqN = zones.filter(z => z.rank/zones.length <= 0.15).length;
  const isRet = direction === "RECTO-MALANDAY";

  return (<>
    <button onClick={() => setOpen(true)} style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      width:"100%", padding:"14px 18px",
      background: isRet ? "rgba(180,120,0,.12)" : "rgba(25,118,210,.14)",
      border: `1.5px solid ${isRet ? "rgba(180,120,0,.35)" : "rgba(25,118,210,.38)"}`,
      borderRadius:18, color:"#fff", cursor:"pointer",
      fontFamily:"'DM Sans',sans-serif", transition:"background .15s", textAlign:"left",
    }}
      onMouseEnter={e => e.currentTarget.style.background = isRet ? "rgba(180,120,0,.22)" : "rgba(25,118,210,.26)"}
      onMouseLeave={e => e.currentTarget.style.background = isRet ? "rgba(180,120,0,.12)" : "rgba(25,118,210,.14)"}
    >
      <span style={{ display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:24,
          background: isRet ? "rgba(180,120,0,.20)" : "rgba(25,118,210,.22)",
          borderRadius:12, padding:"6px 10px", display:"flex", alignItems:"center" }}>
          &#x1F68F;
        </span>
        <span>
          <span style={{ display:"block", fontSize:15, fontWeight:800, letterSpacing:"-0.3px" }}>
            Where to Board &amp; Alight
          </span>
          <span style={{ display:"block", fontSize:11,
            color:"rgba(255,255,255,.50)", fontWeight:500, marginTop:2 }}>
            {DIR_LABELS[direction]} · {freqN} high demand · {zones.length} stops
          </span>
        </span>
      </span>
      <span style={{
        background: isRet ? "#a67c00" : "#1976d2",
        borderRadius:99, padding:"6px 16px",
        fontSize:12, fontWeight:800, color:"#fff", flexShrink:0,
        boxShadow:`0 2px 8px ${isRet ? "rgba(180,120,0,.40)" : "rgba(25,118,210,.40)"}`,
      }}>View Map</span>
    </button>

    {open && (
      <PassengerMap
        zones={zones}
        direction={direction}
        onClose={() => setOpen(false)}
      />
    )}
  </>);
}
