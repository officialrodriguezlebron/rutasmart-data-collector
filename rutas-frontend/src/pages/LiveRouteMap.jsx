import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_URL, TILE_OPTIONS } from "../config/basemap";
import { CORRIDOR, RETURN_CORRIDOR } from "../data/corridor";
import {
  DIR_LABEL, STATUS, statusFor, isStale, hasPosition, timeAgo,
} from "./publicStatus";
import "./LiveRouteMap.css";

/**
 * Live vehicle map for the public passenger page.
 *
 * Imperative Leaflet rather than react-leaflet, matching StopZoneMap and the
 * other maps in this project, and for a concrete reason here: the page polls
 * every five seconds, and a marker layer that is torn down and rebuilt on
 * each poll makes popups close, animations restart and the map flicker.
 * Markers are therefore held in a ref keyed by trip and are moved in place;
 * only vehicles that actually appear or disappear touch the layer.
 *
 * The map is created once. Nothing in the polling path re-initialises it.
 */

/** Only re-frame when the set of vehicles changes, not on every nudge. */
function idSignature(list) {
  return list.map((j) => j.trip_id).sort().join("|");
}

function popupHtml(j) {
  const st = statusFor(j);
  const stale = isStale(j);
  const over = j.occupancy > j.capacity;
  return `
    <div class="lrm-popup">
      <div class="lrm-popup-code">${j.jeep_code ?? "Jeepney"}</div>
      <div class="lrm-popup-dir">${DIR_LABEL[j.direction] || j.direction || ""}</div>
      <div class="lrm-popup-count">
        <strong>${j.occupancy} / ${j.capacity}</strong> passengers
        ${over ? `<span class="lrm-popup-over">${j.occupancy - j.capacity} over</span>` : ""}
      </div>
      <div class="lrm-popup-pct">${Math.round(j.occupancy_pct)}% full</div>
      <div class="lrm-popup-status" style="color:${st.color}">${st.label}</div>
      <div class="lrm-popup-time">Updated ${timeAgo(j.last_updated)}</div>
      ${stale ? `<div class="lrm-popup-stale">Last update may be stale — this is the last
         known position, not necessarily where the jeepney is now.</div>` : ""}
    </div>`;
}

function markerIcon(j) {
  const st = statusFor(j);
  const stale = isStale(j);
  const label = (j.jeep_code || "?").replace(/^MR-?/i, "");
  return L.divIcon({
    className: "",
    html: `<div class="lrm-pin${stale ? " is-stale" : ""}" style="--pin:${st.color}">
             <span class="lrm-pin-label">${label}</span>
             <span class="lrm-pin-pct">${Math.round(j.occupancy_pct)}%</span>
           </div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

export default function LiveRouteMap({ jeepneys = [], direction = "all", height }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const corridorRef = useRef(null);
  const lastFitRef = useRef("");

  // ── Create the map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      center: [14.66, 120.975],
      zoom: 12,
      scrollWheelZoom: true,
      zoomControl: true,
      attributionControl: true,   // OSM attribution is a licence condition
    });
    L.tileLayer(TILE_URL, { ...TILE_OPTIONS }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    // Captured now: the ref's contents are read at cleanup time otherwise.
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  // ── Corridor line, redrawn only when the direction filter changes ──────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (corridorRef.current) {
      map.removeLayer(corridorRef.current);
      corridorRef.current = null;
    }
    const paths =
      direction === "MALANDAY-RECTO" ? [[CORRIDOR, "#42a5f5"]]
        : direction === "RECTO-MALANDAY" ? [[RETURN_CORRIDOR, "#00b4d8"]]
          : [[CORRIDOR, "#42a5f5"], [RETURN_CORRIDOR, "#00b4d8"]];
    corridorRef.current = L.layerGroup(
      paths.map(([pts, color]) =>
        L.polyline(pts, { color, weight: 3, opacity: 0.5, lineJoin: "round" })),
    ).addTo(map);
  }, [direction]);

  // ── Vehicles: move what exists, add what is new, drop what left ────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // A jeepney without a usable fix is listed, not mapped. Plotting it
    // would put it at 0,0 in the Gulf of Guinea.
    const plottable = jeepneys.filter(hasPosition);
    const seen = new Set();

    plottable.forEach((j) => {
      seen.add(j.trip_id);
      const pos = [j.last_lat, j.last_lon];
      const existing = markersRef.current.get(j.trip_id);
      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(markerIcon(j));
        existing.setPopupContent(popupHtml(j));
      } else {
        const m = L.marker(pos, { icon: markerIcon(j), keyboard: true,
                                  alt: `${j.jeep_code}, ${statusFor(j).label}` })
          .bindPopup(popupHtml(j), { className: "lrm-popup-wrap", maxWidth: 260 })
          .addTo(map);
        markersRef.current.set(j.trip_id, m);
      }
    });

    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        map.removeLayer(m);
        markersRef.current.delete(id);
      }
    });

    // Re-frame only when the vehicle set changes. Doing it on every poll
    // would yank the map away from a passenger who has panned or zoomed.
    const sig = idSignature(plottable) + "|" + direction;
    if (sig !== lastFitRef.current && plottable.length > 0) {
      lastFitRef.current = sig;
      const b = L.latLngBounds(plottable.map((j) => [j.last_lat, j.last_lon]));
      if (b.isValid()) {
        map.fitBounds(b, { padding: [60, 60], maxZoom: plottable.length === 1 ? 15 : 14 });
      }
    }
    if (plottable.length === 0) lastFitRef.current = "";
  }, [jeepneys, direction]);

  return (
    <div className="lrm-wrap" style={height ? { height } : undefined}>
      <div ref={elRef} className="lrm-canvas" />
    </div>
  );
}
