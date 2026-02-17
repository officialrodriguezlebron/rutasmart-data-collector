import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { tripService } from "../services/tripService";
import "./Dashboard.css";

const DEVICE_KEY = "rutasmart_device_id";

function generateDeviceId() {
  return "RS-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

function getOrCreateDeviceId() {
  let storedId = localStorage.getItem(DEVICE_KEY);

  if (!storedId) {
    storedId = generateDeviceId();
    localStorage.setItem(DEVICE_KEY, storedId);
  }

  return storedId;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const hasActiveTrip = tripService.hasActiveTrip();

  // ✅ Lazy initialization (NO setState inside effect)
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div className="app-container">
      <div className="app-card">

        {/* HEADER */}
        <div className="header">
          <h1>RutaSmart</h1>
          <p className="subtitle">Trip Monitoring System</p>
        </div>

        {/* STATUS */}
        <div className="status-row">
          <span className={`status-badge ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>

        {/* DEVICE ID */}
        <div className="device-id">
          <span className="device-label">Device ID:</span>
          <span className="device-value">{deviceId}</span>
        </div>

        {/* ACTION BUTTONS */}
        <div className="actions">
          {hasActiveTrip ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate("/record")}
            >
              Continue Active Trip
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => navigate("/trip-setup")}
            >
              Start New Trip
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => navigate("/saved-trips")}
          >
            View Saved Trips
          </button>
        </div>

        {/* STATS */}
        <div className="stats">
          <div className="stat-card">
            <div className="stat-label">Active Trip</div>
            <div className="stat-value">
              {hasActiveTrip ? "Running" : "None"}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
