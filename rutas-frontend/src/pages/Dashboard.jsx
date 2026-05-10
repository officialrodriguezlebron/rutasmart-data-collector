import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { tripService } from "../services/tripService";
import { authService } from "../services/authService";
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
  const navigate      = useNavigate();
  const hasActiveTrip = tripService.hasActiveTrip();
  const user          = authService.getUser();

  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleLogout = () => {
    authService.clearSession();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-container">
      <div className="app-card">

        {/* Header */}
        <div className="header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>RutaSmart</h1>
            <p className="subtitle">Trip Monitoring System</p>
          </div>
          <button
            onClick={handleLogout}
            style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8,
                     padding: "6px 12px", fontSize: 12, color: "#888", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>

        {/* Conductor info */}
        {user && (
          <div className="device-id" style={{ marginTop: 12 }}>
            <span className="device-label">Conductor</span>
            <span className="device-value">{user.display_name}</span>
          </div>
        )}
        {user?.jeep_code && (
          <div className="device-id">
            <span className="device-label">Assigned Jeep</span>
            <span className="device-value">{user.jeep_code}</span>
          </div>
        )}

        {/* Status */}
        <div className="status-row">
          <span className={`status-badge ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>

        {/* Device ID */}
        <div className="device-id">
          <span className="device-label">Device ID</span>
          <span className="device-value">{deviceId}</span>
        </div>

        {/* Actions */}
        <div className="actions">
          {hasActiveTrip ? (
            <button className="btn btn-primary" onClick={() => navigate("/record")}>
              Continue Active Trip
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate("/trip-setup")}>
              Start New Trip
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => navigate("/saved-trips")}>
            View Saved Trips
          </button>
        </div>

        {/* Stats */}
        <div className="stats">
          <div className="stat-card">
            <div className="stat-label">Active Trip</div>
            <div className="stat-value">{hasActiveTrip ? "Running" : "None"}</div>
          </div>
        </div>

      </div>
    </div>
  );
}
