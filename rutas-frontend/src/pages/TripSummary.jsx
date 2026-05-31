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

        {/* Corridor info card */}
        <div style={{
          background: "rgba(21,101,192,0.08)",
          border: "1px solid rgba(21,101,192,0.22)",
          borderRadius: 12,
          padding: "14px 16px",
          margin: "16px 0 8px",
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: "#1565c0", marginBottom: 6 }}>
            Passenger Map Updated
          </div>
          <p style={{ margin: "0 0 10px", color: "#555" }}>
            Your trip data will be included in the next admin publish.
            Passengers can view boarding and alighting stops at:
          </p>
          <a
            href="/route/MR-001"
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              background: "#1565c0",
              color: "#fff",
              borderRadius: 8,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            View public stop zone map →
          </a>
          <div style={{ marginTop: 10, fontSize: 11, color: "#999" }}>
            {summary?.direction === "RECTO-MALANDAY"
              ? "Return corridor (Recto → Malanday) will be applied"
              : "Forward corridor (Malanday → Recto) will be applied"}
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
