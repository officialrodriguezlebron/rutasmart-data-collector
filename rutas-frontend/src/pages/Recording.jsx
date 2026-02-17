import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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

  const QUEUE_KEY = useMemo(() => {
    return activeTrip ? `gps_offline_queue_${activeTrip.tripId}` : null;
  }, [activeTrip]);

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

  // ==========================
  // Queue Utilities (Memoized)
  // ==========================

  const getQueue = useCallback(() => {
    if (!QUEUE_KEY) return [];
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch {
      return [];
    }
  }, [QUEUE_KEY]);

  const saveQueue = useCallback(
    (queue) => {
      if (!QUEUE_KEY) return;
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    },
    [QUEUE_KEY]
  );

  const clearQueue = useCallback(() => {
    if (!QUEUE_KEY) return;
    localStorage.removeItem(QUEUE_KEY);
  }, [QUEUE_KEY]);

  const addToQueue = useCallback(
    (log) => {
      const queue = getQueue();
      queue.push(log);
      saveQueue(queue);
      setQueueCount(queue.length);
    },
    [getQueue, saveQueue]
  );

  const flushQueue = useCallback(async () => {
    const queue = getQueue();
    if (queue.length === 0) return;

    const remaining = [];

    for (const log of queue) {
      try {
        await logGPS(log);
        setLogsSent((prev) => prev + 1);
      } catch {
        remaining.push(log);
      }
    }

    saveQueue(remaining);
    setQueueCount(remaining.length);
  }, [getQueue, saveQueue]);

  // Initialize queue count safely
  useEffect(() => {
    if (QUEUE_KEY) {
      setQueueCount(getQueue().length);
    }
  }, [QUEUE_KEY, getQueue]);

  useEffect(() => {
    latestGpsRef.current = gpsData;
  }, [gpsData]);

  useEffect(() => {
    latestOccupancyRef.current = occupancy;
  }, [occupancy]);

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
      () => {
        setGpsData((prev) => ({
          ...prev,
          status: "GPS Error",
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
      await flushQueue();
    };

    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue]);

  // ==========================
  // Logger Interval
  // ==========================

  useEffect(() => {
    if (!activeTrip) return;

    intervalRef.current = setInterval(async () => {
      const gps = latestGpsRef.current;
      const occ = latestOccupancyRef.current;

      if (gps.latitude !== null && gps.accuracy !== null) {
        const payload = {
          trip_id: activeTrip.tripId,
          device_id: deviceId,
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: gps.accuracy,
          occupancy_count: occ,
        };

        try {
          if (navigator.onLine) {
            tripService.addLog({
              timestamp: new Date().toISOString(),
              latitude: payload.latitude,
              longitude: payload.longitude,
              accuracy: payload.accuracy,
              occupancy: payload.occupancy_count,
            });

            await logGPS(payload);
            setLogsSent((prev) => prev + 1);

            await flushQueue();
          } else {
            throw new Error("Offline");
          }
        } catch {
          addToQueue(payload);
        }
      }
    }, 3000);

    return () => clearInterval(intervalRef.current);
  }, [activeTrip, deviceId, flushQueue, addToQueue]);

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

      await flushQueue();
      clearQueue();

      try {
        await endTripAPI(activeTrip.tripId);
      } catch {
        console.warn("Backend endTrip failed.");
      }

      const completedTrip = tripService.endTrip({
        finalOccupancy: occupancy,
        logsSent,
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
    activeTrip.capacity > 0 &&
    occupancy > activeTrip.capacity;

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
            <span className="status-badge queue">
              Queue: {queueCount}
            </span>
          )}
        </div>

        <div className="occupancy-display">
          <p className="capacity-label">
            Capacity: {activeTrip.capacity}
          </p>

          <h1 className={isOverloaded ? "over" : ""}>
            {occupancy}
          </h1>

          {isOverloaded && <p className="over-text">OVER CAPACITY</p>}
        </div>

        <div className="gps-card">
          <p>Status: {gpsData.status}</p>
          <p>
            Accuracy:
            {gpsData.accuracy
              ? ` ${gpsData.accuracy.toFixed(1)}m`
              : " -"}
          </p>
          <p>Logs Sent: {logsSent}</p>
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
      </div>
    </div>
  );
}

export default Recording;
