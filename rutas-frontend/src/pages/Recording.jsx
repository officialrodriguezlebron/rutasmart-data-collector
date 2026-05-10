import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { logGPS, endTrip as endTripAPI } from "../services/api";
import { tripService } from "../services/tripService.js";
import "./Recording.css";

function Recording() {
  const navigate = useNavigate();
  const activeTrip = tripService.getActiveTrip();
  const deviceId = localStorage.getItem("rutasmart_device_id");

  useEffect(() => {
    if (!activeTrip) {
      navigate("/dashboard", { replace: true });
    }
  }, [activeTrip, navigate]);

  const QUEUE_KEY = activeTrip
    ? `gps_offline_queue_${activeTrip.tripId}`
    : null;


  const initialOccupancy =
    activeTrip?.liveOccupancy ??
    activeTrip?.startingOccupancy ??
    activeTrip?.occupancy ??
    0;

  const [occupancy, setOccupancy] = useState(initialOccupancy);
  const [logsSent, setLogsSent] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [debugLog, setDebugLog] = useState([]);

  const [gpsData, setGpsData] = useState({
    latitude: null,
    longitude: null,
    accuracy: null,
    status: navigator.geolocation
      ? "Waiting for GPS..."
      : "Geolocation not supported",
  });

  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);
  const latestGpsRef = useRef(gpsData);
  const latestOccupancyRef = useRef(initialOccupancy);
  const logsSentRef = useRef(0);
  const isFlushing = useRef(false);
  const wakeLockRef = useRef(null);   // Screen Wake Lock sentinel

  // ── Wake Lock support detection ──────────────────────────────────────────
  // "wakeLock" = API supported and lock acquired
  // "unsupported" = browser doesn't support Wake Lock (iOS < 16.4 in browser)
  // "failed" = supported but acquisition failed (permissions, battery saver)
  const [wakeLockStatus, setWakeLockStatus] = useState("pending");

  // ── KPI instrumentation refs ─────────────────────────────────────────────
  // clientSeqRef: increments by 1 for every payload the interval constructs,
  //   regardless of network state. Gaps in the DB sequence = confirmed lost
  //   logs (KPI #5).
  const clientSeqRef = useRef(0);

  // onlineEventAtRef: set to Date.now() ISO string when the browser fires the
  //   'online' event. Attached to the first log after reconnect so the backend
  //   can compute flush latency (KPI #6). Cleared after first use.
  const onlineEventAtRef = useRef(null);

  // ── Screen Wake Lock ──────────────────────────────────────────────────────
  // Requests the Wake Lock API to prevent the screen from sleeping during
  // an active recording session. Without this, iOS/Android may suspend
  // JavaScript execution when the screen locks, stopping GPS logging.
  //
  // Support matrix:
  //   Android Chrome/Firefox/Samsung : ✅ Full support
  //   iOS Safari 16.4+ (PWA mode)    : ✅ Supported
  //   iOS Safari < 16.4              : ❌ Not supported — user must keep screen on
  //
  // Re-acquisition on visibilitychange handles the case where the conductor
  // briefly switches apps and comes back — the lock is automatically restored.
  useEffect(() => {
    let cancelled = false;

    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator)) {
        setWakeLockStatus("unsupported");
        return;
      }
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        if (!cancelled) setWakeLockStatus("wakeLock");

        wakeLockRef.current.addEventListener("release", () => {
          if (!cancelled) setWakeLockStatus("released");
        });
      } catch {
        if (!cancelled) setWakeLockStatus("failed");
      }
    };

    // Re-acquire when the page becomes visible again (conductor switches back)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        acquireWakeLock();
      }
    };

    acquireWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Release the lock when the recording screen unmounts (trip ended)
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    latestGpsRef.current = gpsData;
  }, [gpsData]);

  useEffect(() => {
    latestOccupancyRef.current = occupancy;
  }, [occupancy]);

  const addDebug = (msg) => {
    const time = new Date().toLocaleTimeString();
    setDebugLog((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 20));
  };

  const getQueue = () => {
    if (!QUEUE_KEY) return [];
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch {
      return [];
    }
  };

  const saveQueue = (queue) => {
    if (!QUEUE_KEY) return;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    setQueueCount(queue.length);
  };

  const clearQueue = () => {
    if (!QUEUE_KEY) return;
    localStorage.removeItem(QUEUE_KEY);
    setQueueCount(0);
  };

  const addToQueue = (log) => {
    const queue = getQueue();
    queue.push(log);
    saveQueue(queue);
    addDebug(`Queued. Queue size: ${queue.length}`);
  };

  const flushQueue = async () => {
    if (isFlushing.current) return;
    const snapshot = getQueue();          // snapshot length at flush start
    if (snapshot.length === 0) return;

    isFlushing.current = true;
    addDebug(`Flushing ${snapshot.length} queued logs...`);

    const failed = [];

    for (const log of snapshot) {
      // Attach the reconnect event timestamp to the first log of this flush,
      // then clear it so subsequent logs in the same flush don't carry it.
      const logWithOnline = onlineEventAtRef.current
        ? { ...log, client_online_event_at: onlineEventAtRef.current }
        : log;
      if (onlineEventAtRef.current) onlineEventAtRef.current = null;

      try {
        await logGPS(logWithOnline);
        logsSentRef.current += 1;
        setLogsSent(logsSentRef.current);
        addDebug(`Flushed 1 queued log. Total sent: ${logsSentRef.current}`);
      } catch (err) {
        failed.push(log);               // keep original (without online stamp)
        addDebug(`Flush failed: ${err?.message || "unknown error"}`);
      }
    }

    // Race-condition fix: re-read queue and keep anything added DURING the
    // flush (new offline failures) plus whatever we couldn't send.
    const current = getQueue();
    const addedDuringFlush = current.slice(snapshot.length);
    saveQueue([...failed, ...addedDuringFlush]);

    isFlushing.current = false;
  };

  useEffect(() => {
    if (QUEUE_KEY) {
      setQueueCount(getQueue().length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setGpsData({
          latitude:  position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy:  position.coords.accuracy,
          // GeolocationPosition.timestamp is epoch-ms — store it so every
          // payload can carry the exact fix time (KPI #7 inter-arrival jitter)
          fixTimestamp: position.timestamp,
          status: "Active",
        });
      },
      (err) => {
        setGpsData((prev) => ({
          ...prev,
          status: `GPS Error: ${err.message}`,
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);
      // Record the exact moment the browser came back online. This ISO string
      // will be attached to the first log flushed after reconnect so the
      // backend can compute flush latency (KPI #6).
      onlineEventAtRef.current = new Date().toISOString();
      addDebug("Back online — flushing queue");
      await flushQueue();
    };

    const goOffline = () => {
      setIsOnline(false);
      addDebug("Went offline");
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeTrip) return;

    addDebug("Interval started");

    intervalRef.current = setInterval(async () => {
      const gps = latestGpsRef.current;
      const occ = latestOccupancyRef.current;

      if (gps.latitude === null || gps.accuracy === null) {
        addDebug("Skipped — GPS not ready");
        return;
      }

      // Increment sequence counter BEFORE building the payload so the very
      // first log is seq=1. Gaps in the DB sequence confirm lost logs (KPI #5).
      clientSeqRef.current += 1;

      const payload = {
        trip_id:        activeTrip.tripId,
        device_id:      deviceId,
        latitude:       gps.latitude,
        longitude:      gps.longitude,
        accuracy:       gps.accuracy,
        occupancy_count: occ,
        // KPI instrumentation — all three fields
        gps_timestamp:  gps.fixTimestamp ?? null,   // epoch-ms from Geolocation API (KPI #7)
        client_seq:     clientSeqRef.current,        // sequence number (KPI #5)
        client_online_event_at: null,                // set on first post-reconnect flush only
      };

      try {
        await logGPS(payload);
        logsSentRef.current += 1;
        setLogsSent(logsSentRef.current);
        addDebug(`Log sent. seq=${clientSeqRef.current} total=${logsSentRef.current}`);
      } catch (err) {
        // Direct send failed — queue it (offline queue is the only localStorage
        // write for GPS data; tripService.addLog removed to avoid quota bloat)
        addDebug(`Direct send failed (${err?.message || "error"}) — queuing`);
        addToQueue(payload);
      }

      await flushQueue();
    }, 3000);

    return () => {
      addDebug("Interval cleared");
      clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBoard = () => {
    setOccupancy((prev) => {
      const newValue = prev + 1;
      tripService.updateActiveTrip({ liveOccupancy: newValue });
      return newValue;
    });
  };

  const handleAlight = () => {
    setOccupancy((prev) => {
      const newValue = prev > 0 ? prev - 1 : 0;
      tripService.updateActiveTrip({ liveOccupancy: newValue });
      return newValue;
    });
  };

  const handleEndTrip = async () => {
    if (!activeTrip) return;

    const confirmEnd = window.confirm(
      "Are you sure you want to end this trip?"
    );
    if (!confirmEnd) return;

    try {
      clearInterval(intervalRef.current);

      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }

      // Capture BEFORE any async calls — ref survives but want a stable snapshot
      const finalLogsSent = logsSentRef.current;

      addDebug("Trip ending — final flush...");
      await flushQueue();
      clearQueue();

      try {
        await endTripAPI(activeTrip.tripId);
      } catch {
        console.warn("Backend endTrip failed — continuing anyway.");
      }

      const completedTrip = tripService.endTrip({
        finalOccupancy: occupancy,
        logsSent: finalLogsSent,
        queueRemaining: 0,
      });

      navigate("/summary", {
        replace: true,
        state: { trip: completedTrip, logsSent: finalLogsSent },
      });
    } catch (err) {
      console.error(err);
      alert("Failed to end trip properly.");
    }
  };

  if (!activeTrip) return null;

  const isOverloaded =
    activeTrip.capacity > 0 && occupancy > activeTrip.capacity;

  return (
    <div className="app-container">
      <div className="app-card">
        <div className="record-header">
          <h2>Recording Trip</h2>
          <p className="trip-id">{activeTrip.tripId}</p>
        </div>

        <div className="status-row">
          <span className={`status-badge ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "Online" : "Offline"}
          </span>

          {queueCount > 0 && (
            <span className="status-badge queue">Queue: {queueCount}</span>
          )}
        </div>

        {/* Wake Lock status banner */}
        {wakeLockStatus === "unsupported" && (
          <div className="wakelock-banner wakelock-warn">
            ⚠ Screen lock not supported on this device. Keep screen on and
            app open during the entire trip to prevent GPS logging from stopping.
          </div>
        )}
        {wakeLockStatus === "failed" && (
          <div className="wakelock-banner wakelock-warn">
            ⚠ Could not prevent screen sleep. Keep the screen on during recording.
          </div>
        )}
        {wakeLockStatus === "released" && (
          <div className="wakelock-banner wakelock-warn">
            ⚠ Screen lock was released. Tap here to re-activate.
          </div>
        )}
        {wakeLockStatus === "wakeLock" && (
          <div className="wakelock-banner wakelock-ok">
            🔒 Screen will stay on during recording
          </div>
        )}

        <div className="occupancy-display">
          <p className="capacity-label">Capacity: {activeTrip.capacity}</p>

          <h1 className={isOverloaded ? "over" : ""}>{occupancy}</h1>

          {isOverloaded && <p className="over-text">OVER CAPACITY</p>}
        </div>

        <div className="gps-card">
          <p>Status: {gpsData.status}</p>
          <p>
            Accuracy:
            {gpsData.accuracy ? ` ${gpsData.accuracy.toFixed(1)}m` : " -"}
          </p>
          <p>Logs Sent: {logsSent}</p>
          <p>Queue: {queueCount}</p>
        </div>

        <div className="control-row">
          <button className="btn btn-success" onClick={handleBoard}>
            + Boarding
          </button>

          <button className="btn btn-secondary" onClick={handleAlight}>
            - Alighting
          </button>
        </div>

        <button onClick={handleEndTrip} className="btn btn-danger full">
          End Trip
        </button>

        {/* Debug log — dev builds only, hidden in production */}
        {import.meta.env.DEV && (
          <div
            style={{
              marginTop: "16px",
              background: "#f0f0f0",
              borderRadius: "10px",
              padding: "10px",
              fontSize: "11px",
              fontFamily: "monospace",
              maxHeight: "160px",
              overflowY: "auto",
              color: "#333",
            }}
          >
            <strong>Debug Log</strong>
            {debugLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Recording;
