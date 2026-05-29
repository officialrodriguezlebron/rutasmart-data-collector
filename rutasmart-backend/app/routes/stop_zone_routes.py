# FILE: rutasmart-backend/app/routes/stop_zone_routes.py
# New file — create this in the routes folder

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime

from app.database import get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.published_stop_zone import PublishedStopZone
from app.analytics.algorithms import GPSPoint, run_dbscan

router = APIRouter()

TIER_COLOR = {
    "Normal":   "#2e7d32",
    "Moderate": "#f9a825",
    "High":     "#ef6c00",
    "Critical": "#c62828",
}


def _get_completed_trips(route_id: str, db: Session):
    """Fetch all completed trips for a route, handling MR-001 variants."""
    normalized = route_id.strip().upper().replace(" ", "")
    if normalized in ("MR-001", "MR001", "MR_001"):
        return (
            db.query(Trip)
            .filter(
                Trip.status == TripStatusEnum.COMPLETED,
                func.replace(
                    func.replace(func.upper(Trip.route_id), "_", ""), "-", ""
                ).in_(["MR001"])
            )
            .all()
        )
    return (
        db.query(Trip)
        .filter(Trip.route_id == route_id, Trip.status == TripStatusEnum.COMPLETED)
        .all()
    )


# ── Admin: publish stop zones for a route ────────────────────────────────────

@router.post("/admin/route/{route_id}/publish-stops", tags=["Admin"])
def publish_stop_zones(route_id: str, db: Session = Depends(get_db)):
    """
    Admin endpoint — runs DBSCAN across ALL completed trips on the route,
    validates the clusters, and atomically replaces the published_stop_zones
    table for this route.

    Uses thesis-validated parameters: ε = 15 m, minPts = 10.
    Only TRUE_STOP clusters are published — traffic queues and moving
    segments are excluded so passengers only see genuine boarding zones.
    """
    trips = _get_completed_trips(route_id, db)
    if not trips:
        raise HTTPException(
            status_code=404,
            detail=f"No completed trips found for route {route_id}. "
                   "Complete and end at least one recorded trip before publishing."
        )

    # ── Pool GPS logs from all trips ─────────────────────────────────────────
    all_points = []
    cap = 26

    for trip in trips:
        cap = trip.official_capacity or 26
        logs = (
            db.query(GPSLog)
            .filter(
                GPSLog.trip_id == trip.trip_id,
                GPSLog.gps_quality_flag.in_([
                    GPSQualityEnum.GOOD,
                    GPSQualityEnum.ACCEPTABLE,
                ])
            )
            .all()
        )
        for log in logs:
            all_points.append(GPSPoint(
                log_id=str(log.log_id),
                trip_id=trip.trip_id,
                latitude=log.latitude,
                longitude=log.longitude,
                accuracy=log.accuracy,
                occupancy_count=log.occupancy_count,
                timestamp=log.timestamp,
                gps_quality_flag=str(
                    log.gps_quality_flag.value
                    if hasattr(log.gps_quality_flag, "value")
                    else log.gps_quality_flag
                ),
            ))

    if not all_points:
        raise HTTPException(
            status_code=422,
            detail="Trips found but no GOOD or ACCEPTABLE GPS logs after quality filtering."
        )

    # ── Run DBSCAN with thesis parameters ────────────────────────────────────
    result = run_dbscan(all_points, cap, eps_m=15.0, min_samples=10)
    clusters = result.get("clusters", [])

    if not clusters:
        raise HTTPException(
            status_code=422,
            detail="DBSCAN found no clusters in the pooled GPS data. "
                   "Try importing more completed trip data before publishing."
        )

    # ── Filter to TRUE_STOP only ──────────────────────────────────────────────
    stop_clusters = [
        c for c in clusters
        if getattr(c, "cluster_type", "TRUE_STOP") == "TRUE_STOP"
    ]

    if not stop_clusters:
        stop_clusters = clusters  # fallback: use all if none are TRUE_STOP typed

    # Sort by activity — busiest first
    stop_clusters.sort(key=lambda c: c.point_count, reverse=True)

    now = datetime.utcnow()

    # ── Atomic replace: delete old, insert new ────────────────────────────────
    db.query(PublishedStopZone).filter(
        PublishedStopZone.route_id == route_id
    ).delete()

    for rank, c in enumerate(stop_clusters, start=1):
        tier  = getattr(c, "demand_tier", "Normal")
        color = TIER_COLOR.get(tier, "#1565c0")
        db.add(PublishedStopZone(
            route_id        = route_id,
            cluster_id      = int(c.cluster_id),
            lat             = round(c.centroid_lat, 7),
            lon             = round(c.centroid_lon, 7),
            point_count     = int(c.point_count),
            demand_tier     = tier,
            avg_occupancy   = round(c.avg_occupancy, 1),
            peak_period     = getattr(c, "peak_period", "—"),
            load_factor_pct = round(getattr(c, "load_factor_pct", 0), 1),
            color           = color,
            rank            = int(rank),
            published_at    = now,
            trips_analyzed  = len(trips),
            logs_analyzed   = len(all_points),
        ))

    db.commit()

    return {
        "published":        True,
        "route_id":         route_id,
        "stop_zones":       len(stop_clusters),
        "trips_analyzed":   len(trips),
        "logs_analyzed":    len(all_points),
        "published_at":     now.isoformat() + "Z",
        "message": (
            f"Successfully published {len(stop_clusters)} stop zones "
            f"from {len(trips)} trips ({len(all_points)} GPS logs). "
            "The public passenger map has been updated."
        ),
    }


# ── Admin: view current published stop zones ─────────────────────────────────

@router.get("/admin/route/{route_id}/published-stops", tags=["Admin"])
def get_published_stops_admin(route_id: str, db: Session = Depends(get_db)):
    """Admin view of currently published stop zones for a route."""
    zones = (
        db.query(PublishedStopZone)
        .filter(PublishedStopZone.route_id == route_id)
        .order_by(PublishedStopZone.rank)
        .all()
    )
    if not zones:
        return {
            "route_id":   route_id,
            "published":  False,
            "stop_zones": [],
            "message": "No stop zones published yet for this route.",
        }
    return {
        "route_id":         route_id,
        "published":        True,
        "published_at":     zones[0].published_at.isoformat() + "Z",
        "trips_analyzed":   zones[0].trips_analyzed,
        "logs_analyzed":    zones[0].logs_analyzed,
        "stop_zones":       [
            {
                "cluster_id":    z.cluster_id,
                "lat":           z.lat,
                "lon":           z.lon,
                "point_count":   z.point_count,
                "demand_tier":   z.demand_tier,
                "avg_occupancy": z.avg_occupancy,
                "peak_period":   z.peak_period,
                "load_factor_pct": z.load_factor_pct,
                "color":         z.color,
                "rank":          z.rank,
            }
            for z in zones
        ],
    }


# ── Public: read published stop zones (no auth, no DBSCAN on request) ────────

# Add this to stop_zone_routes.py — new public endpoint

@router.get("/public/route/{route_id}/path", tags=["Public"])
def get_route_path(route_id: str, db: Session = Depends(get_db)):
    """
    Returns the GPS track of the best completed trip as a polyline.
    Used by the passenger map to draw the road line from REAL field data.
    No routing engine — this is the actual path conductors drove.
    """
    trips = _get_completed_trips(route_id, db)
    if not trips:
        return {"route_id": route_id, "path": []}

    # Pick the trip with the most GOOD GPS logs — cleanest track
    best_trip = None
    best_count = 0
    for trip in trips:
        count = (
            db.query(GPSLog)
            .filter(
                GPSLog.trip_id == trip.trip_id,
                GPSLog.gps_quality_flag == GPSQualityEnum.GOOD,
            )
            .count()
        )
        if count > best_count:
            best_count = count
            best_trip = trip

    if not best_trip:
        return {"route_id": route_id, "path": []}

    logs = (
        db.query(GPSLog.latitude, GPSLog.longitude, GPSLog.timestamp)
        .filter(
            GPSLog.trip_id == best_trip.trip_id,
            GPSLog.gps_quality_flag == GPSQualityEnum.GOOD,
        )
        .order_by(GPSLog.timestamp)
        .all()
    )

    # Downsample: take every 3rd point to reduce payload
    # ~1500 GOOD logs → ~500 points still gives a smooth line
    path = [
        {"lat": round(log.latitude, 6), "lon": round(log.longitude, 6)}
        for i, log in enumerate(logs)
        if i % 3 == 0
    ]

    return {
        "route_id":   route_id,
        "trip_id":    best_trip.trip_id,
        "direction":  best_trip.direction,
        "point_count": len(path),
        "path": path,
    }

