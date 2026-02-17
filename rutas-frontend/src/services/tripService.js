const STORAGE_KEY = "trips";
const ACTIVE_KEY = "active_trip";

/* ===========================
   Safe JSON Helpers
=========================== */

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    console.warn("Corrupted localStorage detected. Resetting.");
    return fallback;
  }
}

function safeGet(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  return safeParse(raw, fallback);
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.error("Failed to save to localStorage.");
  }
}

/* ===========================
   Trip Service
=========================== */

export const tripService = {

  /* ---------------------------
     All Trips
  --------------------------- */

  getAllTrips() {
    const trips = safeGet(STORAGE_KEY, []);
    return Array.isArray(trips) ? trips : [];
  },

  saveAllTrips(trips) {
    if (!Array.isArray(trips)) return;
    safeSet(STORAGE_KEY, trips);
  },

  /* ---------------------------
     Active Trip
  --------------------------- */

  startTrip(tripData) {
    if (!tripData) return null;

    const activeTrip = {
      ...tripData,
      startedAt: Date.now(),
      logs: [],
    };

    safeSet(ACTIVE_KEY, activeTrip);
    return activeTrip;
  },

  getActiveTrip() {
    const active = safeGet(ACTIVE_KEY, null);

    if (!active || typeof active !== "object") {
      return null;
    }

    return active;
  },

  updateActiveTrip(updatedFields) {
    const active = this.getActiveTrip();
    if (!active) return null;

    const updated = {
      ...active,
      ...updatedFields,
    };

    safeSet(ACTIVE_KEY, updated);
    return updated;
  },

  addLog(log) {
    const active = this.getActiveTrip();
    if (!active) return;

    if (!Array.isArray(active.logs)) {
      active.logs = [];
    }

    active.logs.push(log);
    safeSet(ACTIVE_KEY, active);
  },

  /* ---------------------------
     End Trip
  --------------------------- */

  endTrip(finalData) {
    const active = this.getActiveTrip();
    if (!active) return null;

    const trips = this.getAllTrips();

    const completedTrip = {
      ...active,
      ...finalData,
      endedAt: Date.now(),
    };

    trips.push(completedTrip);
    this.saveAllTrips(trips);

    localStorage.removeItem(ACTIVE_KEY);

    return completedTrip;
  },

  /* ---------------------------
     Delete Trip
  --------------------------- */

  deleteTrip(tripId) {
  const trips = this.getAllTrips();

  const updatedTrips = trips.filter((t) => {
    if (!t.tripId) return true;
    return String(t.tripId) !== String(tripId);
  });

  this.saveAllTrips(updatedTrips);
}
,


  /* ---------------------------
     Utilities
  --------------------------- */

  hasActiveTrip() {
    return !!this.getActiveTrip();
  },

  clearAllTrips() {
    localStorage.removeItem(STORAGE_KEY);
  },

  clearActiveTrip() {
    localStorage.removeItem(ACTIVE_KEY);
  }

};
