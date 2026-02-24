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
      navigate("/", { replace: true });
    }
  }, [activeTrip, navigate]);

  const QUEUE_KEY = activeTrip
    ? `gps_offline_queue_${activeTrip.tripId}`
    : null;

  // ==========================
  // State
  // ==========================

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

  // ==========================
  // Refs — everything the interval
  // needs lives in refs so the
  // interval never needs to restart
  // ==========================

  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);
  const latestGpsRef = useRef(gpsData);
  const latestOccupancyRef = useRef(initialOccupancy);
  const logsSentRef = useRef(0);
  const isFlushing = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    latestGpsRef.current = gpsData;
  }, [gpsData]);

  useEffect(() => {
    latestOccupancyRef.current = occupancy;
  }, [occupancy]);

  // ==========================
  // Debug helper
  // ==========================

  const addDebug = (msg) => {
    const time = new Date().toLocaleTimeString();
    setDebugLog((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 20));
  };

  // ==========================
  // Queue Utilities
  // All use QUEUE_KEY directly
  // from closure — no useCallback
  // so interval never restarts
  // ==========================

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

  // ==========================
  // Flush Queue
  // Tries to send all queued logs
  // regardless of navigator.onLine
  // ==========================

  const flushQueue = async () => {
    if (isFlushing.current) return;
    const queue = getQueue();
    if (queue.length === 0) return;

    isFlushing.current = true;
    addDebug(`Flushing ${queue.length} queued logs...`);

    const remaining = [];

    for (const log of queue) {
      try {
        await logGPS(log);
        logsSentRef.current += 1;
        setLogsSent(logsSentRef.current);
        addDebug(`Flushed 1 queued log. Total sent: ${logsSentRef.current}`);
      } catch (err) {
        remaining.push(log);
        addDebug(`Flush failed: ${err?.message || "unknown error"}`);
      }
    }

    saveQueue(remaining);
    isFlushing.current = false;
  };

  // Initialize queue count on mount
  useEffect(() => {
    if (QUEUE_KEY) {
      setQueueCount(getQueue().length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================
  // GPS Watcher
  // ==========================

  useEffect(() => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setGpsData({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
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

  // ==========================
  // Online / Offline Handling
  // ==========================

  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);
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

  // ==========================
  // Logger Interval
  //
  // KEY FIX: Empty dependency array
  // so this interval is created ONCE
  // and never restarted. All values
  // come from refs, not state.
  //
  // KEY FIX: We attempt to send
  // directly first. If it fails for
  // ANY reason (timeout, server error,
  // weak signal), we queue it.
  // Then we ALWAYS try to flush the
  // queue afterward — not just on
  // success.
  // ==========================

  useEffect(() => {
    if (!activeTrip) return;

    addDebug("Interval started");

    intervalRef.current = setInterval(async () => {
      const gps = latestGpsRef.current;
      const occ = latestOccupancyRef.current;

      // Skip if GPS not ready yet
      if (gps.latitude === null || gps.accuracy === null) {
        addDebug("Skipped — GPS not ready");
        return;
      }

      const payload = {
        trip_id: activeTrip.tripId,
        device_id: deviceId,
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        occupancy_count: occ,
      };

      // Always try to send directly first
      try {
        tripService.addLog({
          timestamp: new Date().toISOString(),
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy,
          occupancy: payload.occupancy_count,
        });

        await logGPS(payload);
        logsSentRef.current += 1;
        setLogsSent(logsSentRef.current);
        addDebug(`Log sent. Total: ${logsSentRef.current}`);
      } catch (err) {
        // Direct send failed — queue it
        addDebug(`Direct send failed (${err?.message || "error"}) — queuing`);
        addToQueue(payload);
      }

      // ALWAYS try to flush queue after each attempt
      // whether the direct send succeeded or not
      await flushQueue();
    }, 3000);

    return () => {
      addDebug("Interval cleared");
      clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================
  // Boarding / Alighting
  // ==========================

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

  // ==========================
  // End Trip
  // ==========================

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
        logsSent: logsSentRef.current,
        queueRemaining: 0,
      });

      navigate("/summary", {
        replace: true,
        state: { trip: completedTrip },
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

        {/* Debug log — remove before final deployment */}
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
      </div>
    </div>
  );
}

export default Recording;
