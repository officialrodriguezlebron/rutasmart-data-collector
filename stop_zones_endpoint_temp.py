# ── ADD THIS ENDPOINT TO main.py ──────────────────────────────────────────────
# Place it directly after the existing /public/route/{route_id} endpoint.
# No new imports needed — all imports are already at the top of main.py.

@app.get("/public/route/{route_id}/stop-zones", tags=["Public"])
def get_public_stop_zones(route_id: str, db: Session = Depends(get_db)):
    """
    Public read-only endpoint — no authentication required.
    Returns aggregated stop zone centroids across ALL completed trips
    on the given route, ranked by GPS log density.

    Used by the passenger-facing stop zone map on the public dashboard.
    Only TRUE_STOP clusters are returned — CREEPING_QUEUE and MOVING
    clusters are excluded because passengers should wait at genuine
    boarding zones, not traffic congestion points.
    """
    from app.models.trip import TripStatusEnum
    from app.analytics.algorithms import GPSPoint, run_dbscan
    from app.models.gps_log import GPSLog, GPSQualityEnum
    from sqlalchemy import func
    import math

    # ── Fetch all completed trips for this route ───────────────────────────
    normalized = route_id.strip().upper().replace(" ", "")
    if normalized in ("MR-001", "MR001", "MR_001"):
        trips = (
            db.query(Trip)
            .filter(
                Trip.status == TripStatusEnum.COMPLETED,
                func.replace(func.replace(func.upper(Trip.route_id), "_", ""), "-", "").in_(["MR001"])
            )
            .all()
        )
    else:
        trips = (
            db.query(Trip)
            .filter(Trip.route_id == route_id, Trip.status == TripStatusEnum.COMPLETED)
            .all()
        )

    if not trips:
        return {
            "route_id": route_id,
            "stop_zones": [],
            "total_trips_analyzed": 0,
            "message": "No completed trips found for this route yet.",
        }

    # ── Gather all GOOD + ACCEPTABLE logs across all trips ────────────────
    all_points = []
    cap = 26  # default

    for trip in trips:
        cap = trip.official_capacity or 26
        logs = (
            db.query(GPSLog)
            .filter(
                GPSLog.trip_id == trip.trip_id,
                GPSLog.gps_quality_flag.in_([GPSQualityEnum.GOOD, GPSQualityEnum.ACCEPTABLE]),
            )
            .all()
        )
        for log in logs:
            all_points.append(GPSPoint(
                latitude=log.latitude,
                longitude=log.longitude,
                accuracy=log.accuracy,
                occupancy=log.occupancy_count,
                timestamp=log.timestamp,
                gps_quality=str(log.gps_quality_flag.value
                                if hasattr(log.gps_quality_flag, "value")
                                else log.gps_quality_flag),
            ))

    if not all_points:
        return {
            "route_id": route_id,
            "stop_zones": [],
            "total_trips_analyzed": len(trips),
            "message": "Trips found but no eligible GPS logs after quality filtering.",
        }

    # ── Run DBSCAN with thesis-validated parameters ────────────────────────
    # ε=15m, minPts=10 — selected via k-distance analysis in the study.
    result = run_dbscan(all_points, cap, eps_m=15.0, min_samples=10)
    clusters = result.get("clusters", [])

    # ── Filter to TRUE_STOP only and rank by point_count ──────────────────
    stop_zones = []
    for c in clusters:
        if getattr(c, "cluster_type", "TRUE_STOP") != "TRUE_STOP":
            continue

        # Demand tier → colour for the frontend marker
        tier = getattr(c, "demand_tier", "Normal")
        color_map = {
            "Normal":   "#2e7d32",
            "Moderate": "#f9a825",
            "High":     "#ef6c00",
            "Critical": "#c62828",
        }
        color = color_map.get(tier, "#1565c0")

        # Normalize point_count to 1–5 for marker sizing on the frontend
        point_count = getattr(c, "point_count", 1)

        stop_zones.append({
            "cluster_id":   getattr(c, "cluster_id", 0),
            "lat":          round(getattr(c, "centroid_lat", 0), 7),
            "lon":          round(getattr(c, "centroid_lon", 0), 7),
            "point_count":  point_count,
            "demand_tier":  tier,
            "color":        color,
            "avg_occupancy": round(getattr(c, "avg_occupancy", 0), 1),
            "peak_period":  getattr(c, "peak_period", "—"),
            "load_factor_pct": round(getattr(c, "load_factor_pct", 0), 1),
        })

    # Sort by activity (highest point_count = busiest stop = show first)
    stop_zones.sort(key=lambda z: z["point_count"], reverse=True)

    # Rank 1 = busiest, for the frontend to show a "BUSIEST" badge
    for i, z in enumerate(stop_zones):
        z["rank"] = i + 1

    return {
        "route_id":             route_id,
        "stop_zones":           stop_zones,
        "total_trips_analyzed": len(trips),
        "total_logs_clustered": len(all_points),
        "parameters":           {"eps_m": 15.0, "min_samples": 10},
    }
