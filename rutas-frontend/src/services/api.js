import axios from "axios";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: {
    // API key sent on every request — set VITE_API_KEY in .env
    // Matches RUTASMART_API_KEY on the backend
    "X-API-Key": import.meta.env.VITE_API_KEY || "",
  },
});

// ── Auth ───────────────────────────────────────────────────────────────────
export const loginAdmin    = (data) => API.post("/auth/login/admin", data);
export const loginConductor = (data) => API.post("/auth/login/conductor", data);
export const seedUsers     = ()     => API.post("/auth/seed");

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

// ── Admin ──────────────────────────────────────────────────────────────────
export const getAdminTrips = () => API.get("/admin/trips");
export const getAdminStats = () => API.get("/admin/stats");

export default API;
