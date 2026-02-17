import { useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { tripService } from "../services/tripService";
import "./TripSummary.css";

function TripSummary() {
  const navigate = useNavigate();
  const location = useLocation();

  /* ===========================
     Get Summary (Safe)
  ============================ */

  const summary = useMemo(() => {
    // 1️⃣ Prefer navigation state
    if (location.state?.trip) {
      return location.state.trip;
    }

    // 2️⃣ Fallback to last saved trip
    const trips = tripService.getAllTrips();
    if (!trips.length) return null;

    return trips[trips.length - 1];
  }, [location.state]);

  /* ===========================
     Redirect if Missing
  ============================ */

  useEffect(() => {
    if (!summary) {
      navigate("/", { replace: true });
    }
  }, [summary, navigate]);

  if (!summary) return null;

  /* ===========================
     Capacity Check
  ============================ */

  const isOverCapacity =
    summary.capacity > 0 &&
    summary.finalOccupancy > summary.capacity;

  /* ===========================
     CSV Export (FIXED)
  ============================ */

  const handleExportCSV = () => {
    const logs = summary.logs || [];

    if (!logs.length) {
      alert("No logs found for this trip.");
      return;
    }

    const headers = [
      "timestamp",
      "latitude",
      "longitude",
      "accuracy",
      "occupancy",
    ];

    const rows = logs.map((log) => {
      const occupancy =
        log.occupancy_count ?? log.occupancy ?? 0;

      return [
        log.timestamp,
        log.latitude,
        log.longitude,
        log.accuracy,
        occupancy,
      ].join(",");
    });

    const csvContent =
      headers.join(",") + "\n" + rows.join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `trip_${summary.tripId}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  /* ===========================
     UI
  ============================ */

  return (
    <div className="app-container">
      <div className="app-card">

        <div className="summary-header">
          <h2>Trip Completed</h2>
          <p className="trip-id">{summary.tripId}</p>
        </div>

        <div className="summary-grid">

          <div>
            <label>Route</label>
            <p>{summary.route}</p>
          </div>

          <div>
            <label>Jeep Code</label>
            <p>{summary.jeepCode}</p>
          </div>

          <div>
            <label>Capacity</label>
            <p>{summary.capacity}</p>
          </div>

          <div>
            <label>Final Occupancy</label>
            <p className={isOverCapacity ? "danger" : ""}>
              {summary.finalOccupancy}
            </p>
          </div>

          <div>
            <label>Logs Recorded</label>
            <p>{summary.logs?.length || 0}</p>
          </div>

          <div>
            <label>Ended At</label>
            <p>
              {summary.endedAt
                ? new Date(summary.endedAt).toLocaleString()
                : "N/A"}
            </p>
          </div>

        </div>

        <div className="summary-actions">

          <button
            className="btn btn-primary full"
            onClick={handleExportCSV}
          >
            Export CSV
          </button>

          <button
            className="btn btn-secondary full"
            onClick={() =>
              navigate("/", { replace: true })
            }
          >
            Back to Dashboard
          </button>

        </div>

      </div>
    </div>
  );
}

export default TripSummary;
