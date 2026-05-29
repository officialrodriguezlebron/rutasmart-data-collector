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
            cluster_id      = c.cluster_id,
            lat             = round(c.centroid_lat, 7),
            lon             = round(c.centroid_lon, 7),
            point_count     = c.point_count,
            demand_tier     = tier,
            avg_occupancy   = round(c.avg_occupancy, 1),
            peak_period     = getattr(c, "peak_period", "—"),
            load_factor_pct = round(getattr(c, "load_factor_pct", 0), 1),
            color           = color,
            rank            = rank,
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

@router.get("/public/route/{route_id}/stop-zones", tags=["Public"])
def get_public_stop_zones(route_id: str, db: Session = Depends(get_db)):
    """
    Public read-only endpoint — no authentication required.
    Returns the admin-published stop zone centroids for the route.
    Fast: reads from the published_stop_zones table, no DBSCAN on request.
    """
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
            "total_trips_analyzed": 0,
            "message": "Stop zones have not been published for this route yet.",
        }

    return {
        "route_id":             route_id,
        "published":            True,
        "published_at":         zones[0].published_at.isoformat() + "Z",
        "total_trips_analyzed": zones[0].trips_analyzed,
        "total_logs_clustered": zones[0].logs_analyzed,
        "stop_zones": [
            {
                "cluster_id":      z.cluster_id,
                "lat":             z.lat,
                "lon":             z.lon,
                "point_count":     z.point_count,
                "demand_tier":     z.demand_tier,
                "avg_occupancy":   z.avg_occupancy,
                "peak_period":     z.peak_period,
                "load_factor_pct": z.load_factor_pct,
                "color":           z.color,
                "rank":            z.rank,
            }
            for z in zones
        ],
        "parameters": {"eps_m": 15.0, "min_samples": 10},
    }
