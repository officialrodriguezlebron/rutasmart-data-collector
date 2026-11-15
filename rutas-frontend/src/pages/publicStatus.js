/**
 * Passenger-facing vocabulary for the public route page.
 *
 * One definition shared by the map markers, the popups and the vehicle
 * list, so a jeepney cannot read "Near capacity" in one place and
 * "Filling Up" in another.
 *
 * Everything here is deliberately plain language. The backend's internal
 * tier names (AVAILABLE / MODERATE / FULL / OVERCAP) and its GPS-quality
 * flag are not shown to passengers; neither is trip_id, which is an
 * internal key and is used only as a React/Leaflet identity.
 */

/** Colour carries capacity status only — never location or data quality. */
export const STATUS = {
  AVAILABLE: { key: "available", label: "Available seats", color: "#30d158" },
  NEAR:      { key: "near",      label: "Near capacity",   color: "#ffd60a" },
  FULL:      { key: "full",      label: "Full",            color: "#ff453a" },
  OVER:      { key: "over",      label: "Over capacity",   color: "#ff453a" },
  UNKNOWN:   { key: "unknown",   label: "Status unknown",  color: "#8e9ab0" },
};

/**
 * Backend tier -> passenger status.
 *
 * The endpoint bands on percentage of official capacity:
 *   AVAILABLE <= 40%, MODERATE 41-75%, FULL 76-100%, OVERCAP > capacity.
 * Those boundaries are the backend's; this only renames them for readers
 * and collapses FULL and OVERCAP onto the same red, as the two both mean
 * "do not expect to sit".
 */
export function statusFor(j) {
  if (!j) return STATUS.UNKNOWN;
  if (j.occupancy > j.capacity || j.tier === "OVERCAP") return STATUS.OVER;
  if (j.tier === "FULL") return STATUS.FULL;
  if (j.tier === "MODERATE") return STATUS.NEAR;
  if (j.tier === "AVAILABLE") return STATUS.AVAILABLE;
  // Fall back to the percentage if a tier ever arrives unset.
  const pct = Number(j.occupancy_pct);
  if (!Number.isFinite(pct)) return STATUS.UNKNOWN;
  if (pct > 100) return STATUS.OVER;
  if (pct > 75) return STATUS.FULL;
  if (pct > 40) return STATUS.NEAR;
  return STATUS.AVAILABLE;
}

export const DIR_LABEL = {
  "MALANDAY-RECTO": "Malanday to Recto",
  "RECTO-MALANDAY": "Recto to Malanday",
};

/**
 * How old an update may be before the position stops being trustworthy.
 *
 * Conductor devices log every few seconds and the page polls every five,
 * so a minute without a fix means something is wrong — a dropped signal, a
 * backgrounded app, a dead battery. The vehicle stays on the map at its
 * last known place, clearly marked, because "it was here a moment ago" is
 * still useful; claiming it is there now would not be.
 */
export const STALE_AFTER_MS = 60_000;

function parseStamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso.endsWith("Z") ? iso : iso + "Z");
  return Number.isFinite(ms) ? ms : null;
}

export function ageMs(j, now = Date.now()) {
  const ms = parseStamp(j?.last_updated);
  return ms == null ? null : now - ms;
}

export function isStale(j, now = Date.now()) {
  const age = ageMs(j, now);
  return age != null && age > STALE_AFTER_MS;
}

/**
 * Is there a fix worth putting on a map?
 *
 * Rejects null, non-numeric and the 0,0 null-island pair. A trip that has
 * started but not yet logged a position must appear in the list as
 * "Waiting for location", never as a marker in the Atlantic.
 */
export function hasPosition(j) {
  const lat = Number(j?.last_lat);
  const lon = Number(j?.last_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return true;
}

export function timeAgo(iso, now = Date.now()) {
  const ms = parseStamp(iso);
  if (ms == null) return "—";
  const s = Math.floor((now - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  return `${Math.floor(s / 3600)} hours ago`;
}
