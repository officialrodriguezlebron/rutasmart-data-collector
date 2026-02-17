import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { tripService } from "../services/tripService";
import { startTrip as startTripAPI } from "../services/api";
import "./tripsetup.css";

function TripSetup() {
  const navigate = useNavigate();

  const [routeId, setRouteId] = useState("");
  const [direction, setDirection] = useState("MALANDAY-RECTO");
  const [jeepCode, setJeepCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [startingOccupancy, setStartingOccupancy] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const DEVICE_KEY = "rutasmart_device_id";

  const [deviceId] = useState(() => {
    return localStorage.getItem(DEVICE_KEY) || "";
  });

  const handleStartTrip = async () => {
    setError("");

    const cap = Number(capacity);
    const occ = Number(startingOccupancy);

    if (!routeId || !jeepCode || !capacity) {
      setError("Please fill all required fields.");
      return;
    }

    if (cap <= 0) {
      setError("Capacity must be greater than 0.");
      return;
    }

    if (occ < 0) {
      setError("Starting occupancy cannot be negative.");
      return;
    }

    if (occ > cap) {
      setError("Starting occupancy cannot exceed capacity.");
      return;
    }

    if (!deviceId) {
      setError("Device ID not found. Please reload the app.");
      return;
    }

    try {
      setLoading(true);

      // 🔥 CALL BACKEND
      const response = await startTripAPI({
        route_id: routeId,
        direction: direction,
        recorder_id: deviceId,
        jeep_code: jeepCode,
        official_capacity: cap,
        starting_occupancy: occ,
      });

      const backendTrip = response.data;

      // 🔥 SAVE ACTIVE TRIP LOCALLY USING BACKEND trip_id
      tripService.startTrip({
        tripId: backendTrip.trip_id, // CRITICAL
        route: routeId,
        direction,
        jeepCode,
        capacity: cap,
        startingOccupancy: occ,
        liveOccupancy: occ,
        startedAt: backendTrip.start_time,
      });

      navigate("/record");
    } catch (err) {
      console.error(err);

      if (err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to start trip. Check backend connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="app-card">
        <h2 style={{ textAlign: "center", marginBottom: "20px" }}>
          Start New Trip
        </h2>

        <div className="form">
          <div>
            <label>Route ID *</label>
            <input
              className="input"
              type="text"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              placeholder="e.g., R-MR-01"
            />
          </div>

          <div>
            <label>Direction *</label>
            <select
              className="input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="MALANDAY-RECTO">
                Malanday → Recto
              </option>
              <option value="RECTO-MALANDAY">
                Recto → Malanday
              </option>
            </select>
          </div>

          <div>
            <label>Jeep Code *</label>
            <input
              className="input"
              type="text"
              value={jeepCode}
              onChange={(e) => setJeepCode(e.target.value)}
              placeholder="e.g., JEEP-23"
            />
          </div>

          <div>
            <label>Official Capacity *</label>
            <input
              className="input"
              type="number"
              min="1"
              value={capacity}
              onChange={(e) =>
                setCapacity(e.target.value < 0 ? 0 : e.target.value)
              }
              placeholder="e.g., 20"
            />
          </div>

          <div>
            <label>Starting Occupancy</label>
            <input
              className="input"
              type="number"
              min="0"
              value={startingOccupancy}
              onChange={(e) =>
                setStartingOccupancy(
                  e.target.value < 0 ? 0 : e.target.value
                )
              }
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button
            className="btn btn-success full"
            onClick={handleStartTrip}
            disabled={loading}
          >
            {loading ? "Starting..." : "Start Trip"}
          </button>

          {deviceId && (
            <p
              style={{
                textAlign: "center",
                fontSize: "12px",
                color: "#777",
                marginTop: "10px",
              }}
            >
              Device ID: <strong>{deviceId}</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default TripSetup;
