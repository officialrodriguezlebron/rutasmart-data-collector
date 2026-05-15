import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { tripService } from "../services/tripService";
import { startTrip as startTripAPI } from "../services/api";
import "./TripSetup.css";

const DEVICE_KEY = "rutasmart_device_id";

// This system serves the Malanday–Recto corridor only.
// Route ID is fixed so the public dashboard always matches.
const FIXED_ROUTE_ID = "MR-001";

function TripSetup() {
  const navigate = useNavigate();

  const [direction,         setDirection]         = useState("MALANDAY-RECTO");
  const [jeepCode,          setJeepCode]          = useState("");
  const [capacity,          setCapacity]           = useState("26");
  const [startingOccupancy, setStartingOccupancy] = useState(0);
  const [error,             setError]             = useState("");
  const [loading,           setLoading]           = useState(false);

  const deviceId = localStorage.getItem(DEVICE_KEY) || "";

  const handleStartTrip = async () => {
    setError("");

    const cap = Number(capacity);
    const occ = Number(startingOccupancy);

    if (!jeepCode.trim()) { setError("Jeep Code is required."); return; }
    if (cap <= 0)          { setError("Capacity must be greater than 0."); return; }
    if (occ < 0)           { setError("Starting occupancy cannot be negative."); return; }
    if (occ > cap)         { setError("Starting occupancy cannot exceed capacity."); return; }
    if (!deviceId)         { setError("Device ID not found. Please reload the app."); return; }

    try {
      setLoading(true);
      const response = await startTripAPI({
        route_id:           FIXED_ROUTE_ID,
        direction,
        recorder_id:        deviceId,
        jeep_code:          jeepCode.trim().toUpperCase(),
        official_capacity:  cap,
        starting_occupancy: occ,
      });

      const backendTrip = response.data;

      tripService.startTrip({
        tripId:           backendTrip.trip_id,
        route:            FIXED_ROUTE_ID,
        direction,
        jeepCode:         jeepCode.trim().toUpperCase(),
        capacity:         cap,
        startingOccupancy: occ,
        liveOccupancy:    occ,
        startedAt:        backendTrip.start_time,
      });

      navigate("/record");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to start trip. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="app-card">
        <h2 style={{ textAlign: "center", marginBottom: 6 }}>Start New Trip</h2>
        <p style={{ textAlign: "center", fontSize: 13, color: "#888", marginBottom: 20 }}>
          Route: <strong>Malanday – Recto · MR-001</strong>
        </p>

        <div className="form">

          {/* Direction */}
          <div>
            <label>Direction *</label>
            <select className="input" value={direction}
              onChange={e => setDirection(e.target.value)}>
              <option value="MALANDAY-RECTO">Malanday → Recto</option>
              <option value="RECTO-MALANDAY">Recto → Malanday</option>
            </select>
          </div>

          {/* Jeep Code */}
          <div>
            <label>Jeep Code *</label>
            <input className="input" type="text"
              value={jeepCode}
              onChange={e => setJeepCode(e.target.value)}
              placeholder="e.g. JPN-003"
            />
          </div>

          {/* Official Capacity */}
          <div>
            <label>Official Capacity *</label>
            <input className="input" type="number" min="1"
              value={capacity}
              onChange={e => setCapacity(e.target.value < 0 ? 0 : e.target.value)}
              placeholder="e.g. 26"
            />
          </div>

          {/* Starting Occupancy */}
          <div>
            <label>Starting Occupancy</label>
            <input className="input" type="number" min="0"
              value={startingOccupancy}
              onChange={e => setStartingOccupancy(e.target.value < 0 ? 0 : e.target.value)}
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn-success full"
            onClick={handleStartTrip} disabled={loading}>
            {loading ? "Starting…" : "Start Trip"}
          </button>

          {deviceId && (
            <p style={{ textAlign: "center", fontSize: 11, color: "#aaa", marginTop: 10 }}>
              Device: <strong>{deviceId}</strong>
            </p>
          )}

        </div>
      </div>
    </div>
  );
}

export default TripSetup;
