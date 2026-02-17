import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { tripService } from "../services/tripService.js";
import "./SavedTrips.css";

function SavedTrips() {
  const navigate = useNavigate();

  const [trips, setTrips] = useState(() =>
    tripService.getAllTrips()
  );

  // ✅ Delete via service
  const handleDelete = (tripId) => {
    tripService.deleteTrip(tripId);
    setTrips(tripService.getAllTrips());
  };

  // ✅ Export logs per trip (correct architecture)
  const handleExport = (trip) => {
    if (!trip.logs || trip.logs.length === 0) {
      alert("No logs available.");
      return;
    }

    const headers = [
      "timestamp",
      "latitude",
      "longitude",
      "accuracy",
      "occupancy",
    ];

    const rows = trip.logs.map((log) =>
      [
        log.timestamp,
        log.latitude,
        log.longitude,
        log.accuracy,
        log.occupancy,
      ].join(",")
    );

    const csvContent =
      headers.join(",") + "\n" + rows.join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `trip_${trip.tripId}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="app-container">
      <div className="app-card">

        <div className="saved-header">
          <h2>Saved Trips</h2>
          <p className="sub-text">
            {trips.length} trip(s)
          </p>
        </div>

        {trips.length === 0 ? (
          <p className="empty-text">
            No saved trips yet.
          </p>
        ) : (
          <div className="trip-list">
            {trips.map((trip) => (
              <div
                key={trip.tripId}
                className="trip-item"
              >
                <div className="trip-main">
                  <p className="trip-id">
                    {trip.tripId}
                  </p>
                  <p className="trip-meta">
                    {trip.route}
                  </p>
                  <p className="trip-meta">
                    {new Date(
                      trip.endedAt
                    ).toLocaleDateString()}
                  </p>
                </div>

                <div className="trip-stats">
                  <span>
                    Occ: {trip.finalOccupancy}
                  </span>
                  <span>
                    Logs: {trip.logs?.length || 0}
                  </span>
                </div>

                <div className="trip-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      handleExport(trip)
                    }
                  >
                    Export
                  </button>

                  <button
                    className="btn btn-danger"
                    onClick={() =>
                      handleDelete(trip.tripId)
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn-secondary full"
          onClick={() => navigate("/")}
        >
          Back to Dashboard
        </button>

      </div>
    </div>
  );
}

export default SavedTrips;
