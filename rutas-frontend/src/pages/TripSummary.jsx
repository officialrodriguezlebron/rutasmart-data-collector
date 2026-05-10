import { useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { tripService } from "../services/tripService";
import { exportTrip } from "../services/api";
import "./TripSummary.css";

function TripSummary() {
  const navigate = useNavigate();
  const location = useLocation();

  const summary = useMemo(() => {
    if (location.state?.trip) return location.state.trip;
    const trips = tripService.getAllTrips();
    if (!trips.length) return null;
    return trips[trips.length - 1];
  }, [location.state]);

  useEffect(() => {
    if (!summary) navigate("/dashboard", { replace: true });
  }, [summary, navigate]);

  if (!summary) return null;

  const isOverCapacity = summary.capacity > 0 && summary.finalOccupancy > summary.capacity;
  const logsSent = location.state?.logsSent ?? summary.logsSent ?? summary.logs?.length ?? 0;

  const handleExportCSV = async () => {
    if (!summary.tripId) { alert("No trip ID found."); return; }
    try {
      const response = await exportTrip(summary.tripId);
      const blob = new Blob([response.data], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href     = url;
      link.download = `trip_${summary.tripId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.detail || "Export failed. Make sure the trip is completed and has recorded logs.");
    }
  };

  return (
    <div className="app-container">
      <div className="app-card">

        <div className="summary-header">
          <h2>Trip Completed</h2>
          <p className="trip-id">{summary.tripId}</p>
        </div>

        <div className="summary-grid">
          <div><label>Route</label><p>{summary.route}</p></div>
          <div><label>Jeep Code</label><p>{summary.jeepCode}</p></div>
          <div><label>Capacity</label><p>{summary.capacity}</p></div>
          <div>
            <label>Final Occupancy</label>
            <p className={isOverCapacity ? "danger" : ""}>{summary.finalOccupancy}</p>
          </div>
          <div><label>Logs Recorded</label><p>{logsSent}</p></div>
          <div>
            <label>Ended At</label>
            <p>{summary.endedAt ? new Date(summary.endedAt).toLocaleString() : "N/A"}</p>
          </div>
        </div>

        <div className="summary-actions">
          <button className="btn btn-primary full" onClick={handleExportCSV}>
            Export CSV
          </button>
          <button className="btn btn-secondary full" onClick={() => navigate("/dashboard", { replace: true })}>
            Back to Dashboard
          </button>
        </div>

      </div>
    </div>
  );
}

export default TripSummary;
