import axios from "axios";
import { authService } from "./authService";
import { tripService } from "./tripService.js";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: {
    // API key sent on every request — set VITE_API_KEY in .env
    // Matches RUTASMART_API_KEY on the backend
    "X-API-Key": import.meta.env.VITE_API_KEY || "",
  },
});

// Login endpoints answer 401 for a wrong password or PIN. That is a failed
// attempt, not an expired session, so it must never clear stored state.
const isLoginRequest = (url = "") => url.includes("/auth/login/");

/** Fired once when a session expires, so mounted screens can react in place. */
export const SESSION_EXPIRED_EVENT = "rutasmart:session-expired";

// A single failure can produce several concurrent 401s (the recording screen
// posts every 3s and flushes a queue in a loop). Without this latch each one
// would clear state and trigger its own navigation.
let sessionExpiryHandled = false;

/**
 * Tear down the session.
 *
 * Normally this also navigates to /login: the call site is an axios
 * interceptor outside the React tree, and a full load guarantees no component
 * is left holding stale authenticated state.
 *
 * The exception is an active recording trip. Navigating away would unmount
 * Recording, cancelling its geolocation watch and its 3-second interval, so
 * the jeepney would stop being tracked the moment a token expired — a hole in
 * the trip's GPS coverage. Capture and queueing are purely local and need no
 * token, so the screen is left mounted and told to surface the state instead.
 * The conductor can sign in when convenient; active_trip and the offline
 * queue are never touched here, so nothing is lost either way.
 */
export function expireSession(
  message = "Your session has expired. Please sign in again."
) {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;

  authService.clearSession();          // token + user only, never trip data
  authService.setSessionNotice(message);

  let hasActiveTrip = false;
  try {
    hasActiveTrip = !!tripService.getActiveTrip();
  } catch {
    hasActiveTrip = false;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, {
      detail: { message, hasActiveTrip },
    }));
    if (!hasActiveTrip && window.location.pathname !== "/login") {
      window.location.replace("/login");
    }
  }
}

/** Re-arm the latch after a successful sign-in. */
export function resetSessionExpiryLatch() {
  sessionExpiryHandled = false;
}

/**
 * Headers for a protected endpoint called through raw fetch().
 *
 * Mirrors what the axios interceptors below attach, so the two transports
 * stay in step. Do NOT use this for /public/* — those endpoints are
 * anonymous by design and are exempt from the API key on the backend.
 */
export function protectedHeaders(extra = {}) {
  const headers = {
    "X-API-Key": import.meta.env.VITE_API_KEY || "",
    ...extra,
  };
  const token = authService.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** fetch() for protected endpoints: attaches auth headers, handles 401. */
export async function protectedFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: protectedHeaders(options.headers || {}),
  });
  if (res.status === 401 && !isLoginRequest(url)) expireSession();
  return res;
}

// ── Attach the signed session token to every axios request ─────────────────
// The backend issues it at login but does not verify it yet (Phase 3A Step 4
// adds enforcement). Sending it now means enforcement can be switched on
// without a second frontend change.
API.interceptors.request.use((config) => {
  const token = authService.getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Treat a 401 on a protected route as an expired session ─────────────────
API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || "";
    if (status === 401 && !isLoginRequest(url)) expireSession();
    return Promise.reject(error);
  }
);

// ── Auth ───────────────────────────────────────────────────────────────────
export const loginAdmin     = (data) => API.post("/auth/login/admin", data);
export const loginConductor = (data) => API.post("/auth/login/conductor", data);
export const seedUsers      = ()     => API.post("/auth/seed");
export const createUser     = (data) => API.post("/auth/create", data);
export const getConductors  = ()     => API.get("/auth/conductors");

// ── Trip management ────────────────────────────────────────────────────────
export const startTrip = (data)   => API.post("/trip/start-trip", data);
export const endTrip   = (tripId) => API.post(`/trip/end-trip/${tripId}`);
export const exportTrip = (tripId) => API.get(`/trip/export/${tripId}`, { responseType: "blob" });

// ── GPS logging ────────────────────────────────────────────────────────────
export const logGPS = (data) => API.post("/log/", data);

// ── Analytics ──────────────────────────────────────────────────────────────
export const runAllAnalytics  = (tripId, eps = 50, minPts = 5) =>
  API.get(`/analytics/${tripId}/run-all?eps_m=${eps}&min_samples=${minPts}`);
export const runSensitivity   = (tripId) =>
  API.get(`/analytics/${tripId}/sensitivity`);
export const runOverlap       = (tripAId, tripBId, eps = 75, minPts = 20) =>
  API.get(`/analytics/overlap/${tripAId}/${tripBId}?eps_m=${eps}&min_samples=${minPts}`);
export const getRawLogs       = (tripId, quality = "all") =>
  API.get(`/analytics/${tripId}/logs?quality=${quality}`);

// ── Admin ──────────────────────────────────────────────────────────────────
export const getAdminTrips = () => API.get("/admin/trips");
export const getAdminStats        = () => API.get("/admin/stats");
export const getAggregateDashboard = () => API.get("/admin/aggregate");
export const deleteTrip    = (tripId) => API.delete(`/admin/trip/${tripId}`);
export const importTripCSV = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return API.post("/admin/import", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
  
// ── Stop Zones ─────────────────────────────────────────────────────────────
export const publishStopZones  = (routeId, direction) =>
  API.post(`/admin/route/${routeId}/publish-stops?direction=${encodeURIComponent(direction)}`);
export const getPublishedStops = (routeId, direction) =>
  API.get(`/admin/route/${routeId}/published-stops?direction=${encodeURIComponent(direction)}`);
export const getStopZonePreview = (routeId, direction) =>
  API.get(`/admin/route/${routeId}/preview-stops?direction=${encodeURIComponent(direction)}`);

export const getStopZoneRecommendations = (routeId, direction) =>
  API.get(`/stop-zones/recommendations?route_id=${encodeURIComponent(routeId)}&direction=${encodeURIComponent(direction)}`);

export const getActionItems = () => API.get("/admin/action-items");

// ── ML / Random Forest — router prefix is /api/clusters (not /clusters) ────
export const getMlStatus       = ()     => API.get("/api/clusters/ml-status");
export const runMlRandomForest = (body) => API.post("/api/clusters/ml-random-forest", body);

// ── Algorithm comparison (merged across all trips) ──────────────────────────
export const runMergedCompare = (tripIds, epsM = 50, minSamples = 5) =>
  API.get(`/analytics/merged/compare?trip_ids=${encodeURIComponent(tripIds.join(","))}&eps_m=${epsM}&min_samples=${minSamples}`);

/**
 * Full analytical pipeline across several trips combined.
 *
 * This is the manuscript-faithful corridor aggregation: every figure it
 * returns is computed PER GPS LOG RECORD and then aggregated, which is the
 * method described in sections 3.10.3 to 3.10.5. It reports the three-way
 * GPS quality split, per-record demand tiers, per-record load factor by
 * operating period, the per-record time distribution, and the DBSCAN
 * clusters, plus source_trips and total_logs as denominators.
 *
 * Prefer this over /admin/aggregate for any figure an inspector reads as a
 * corridor statistic. /admin/aggregate bins whole trips — one period from
 * the trip's start hour, one tier from the trip's maximum occupancy — so its
 * distributions are trip counts, not record counts, and cannot be compared
 * with the manuscript's tables.
 *
 * The backend caps this at 50 trip ids per call.
 */
export const MERGED_TRIP_LIMIT = 50;

export const runMergedAll = (tripIds, epsM = 50, minSamples = 5) =>
  API.get(`/analytics/merged/run-all?trip_ids=${encodeURIComponent(tripIds.join(","))}&eps_m=${epsM}&min_samples=${minSamples}`);

// ── Per-trip research endpoints ──────────────────────────────────────────────
export const getTripPipeline    = (tripId)                        => API.get(`/analytics/${encodeURIComponent(tripId)}/pipeline`);
export const getTripSensitivity = (tripId)                        => API.get(`/analytics/${encodeURIComponent(tripId)}/sensitivity`);
export const getTripEvaluate    = (tripId, epsM = 50, minSamples = 5) =>
  API.get(`/analytics/${encodeURIComponent(tripId)}/evaluate?eps_m=${epsM}&min_samples=${minSamples}`);

export default API;
