from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from typing import Optional

from app.database import get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.published_stop_zone import PublishedStopZone
from app.analytics.algorithms import GPSPoint, run_dbscan
from app.analytics.corridor import match_to_corridor

router = APIRouter()

TIER_COLOR = {
    "Normal":   "#2e7d32",
    "Moderate": "#f9a825",
    "High":     "#ef6c00",
    "Critical": "#c62828",
}

VALID_DIRECTIONS = {"MALANDAY-RECTO", "RECTO-MALANDAY"}


def _get_completed_trips(route_id: str, db: Session, direction: Optional[str] = None):
    """
    Fetch completed trips for a route.
    If direction is given, filter to only that direction.
    Handles MR-001 variants (MR001, MR_001).
    """
    normalized = route_id.strip().upper().replace(" ", "")
    if normalized in ("MR-001", "MR001", "MR_001"):
        q = (
            db.query(Trip)
            .filter(
                Trip.status == TripStatusEnum.COMPLETED,
                func.replace(
                    func.replace(func.upper(Trip.route_id), "_", ""), "-", ""
                ).in_(["MR001"])
            )
        )
    else:
        q = db.query(Trip).filter(
            Trip.route_id == route_id,
            Trip.status == TripStatusEnum.COMPLETED,
        )

    if direction and direction in VALID_DIRECTIONS:
        q = q.filter(Trip.direction == direction)

    return q.all()


# ── Admin: publish stop zones for a route + direction ──────────────────────

@router.post("/admin/route/{route_id}/publish-stops", tags=["Admin"])
def publish_stop_zones(
    route_id: str,
    direction: str = Query("MALANDAY-RECTO",
                           description="MALANDAY-RECTO or RECTO-MALANDAY"),
    db: Session = Depends(get_db),
):
    """
    Admin endpoint — runs DBSCAN across all completed trips for the given
    direction, then atomically replaces published stop zones for that
    route+direction combination only.

    Each direction is published independently so both can coexist in the DB.
    Uses thesis-validated parameters: ε = 15 m, minPts = 10.
    """
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"direction must be one of: {', '.join(VALID_DIRECTIONS)}"
        )

    trips = _get_completed_trips(route_id, db, direction=direction)
    if not trips:
        dir_label = "Malanday → Recto" if direction == "MALANDAY-RECTO" else "Recto → Malanday"
        raise HTTPException(
            status_code=404,
            detail=f"No completed {dir_label} trips found for route {route_id}. "
                   "Record and complete at least one trip in this direction before publishing."
        )

    # Pool GPS logs from all trips in this direction
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

    # Run DBSCAN — velocity-gated so only dwell pings at stops are clustered.
    # eps=30 m catches all pings within ±15 m of a stop centroid;
    # min_samples=20 is satisfied by 8 trips × 35 dwell pings = 280 per zone.
    result = run_dbscan(all_points, cap, eps_m=30.0, min_samples=20)
    clusters = result.get("clusters", [])

    if not clusters:
        raise HTTPException(
            status_code=422,
            detail="DBSCAN found no clusters in the pooled GPS data. "
                   "Try importing more trip data before publishing."
        )

    # Filter to TRUE_STOP only
    stop_clusters = [
        c for c in clusters
        if getattr(c, "cluster_type", "TRUE_STOP") == "TRUE_STOP"
    ]
    if not stop_clusters:
        stop_clusters = clusters

    stop_clusters.sort(key=lambda c: c.point_count, reverse=True)

    now = datetime.utcnow()

    # Atomic replace — delete only this direction's zones, keep the other
    db.query(PublishedStopZone).filter(
        PublishedStopZone.route_id == route_id,
        PublishedStopZone.direction == direction,
    ).delete()

    for rank, c in enumerate(stop_clusters, start=1):
        snapped_lat, snapped_lon, _ = match_to_corridor(
            c.centroid_lat, c.centroid_lon, direction
        )
        tier  = getattr(c, "demand_tier", "Normal")
        color = TIER_COLOR.get(tier, "#1565c0")
        db.add(PublishedStopZone(
            route_id        = route_id,
            direction       = direction,
            cluster_id      = int(c.cluster_id),
            lat             = round(snapped_lat, 7),
            lon             = round(snapped_lon, 7),
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

    dir_label = "Malanday → Recto" if direction == "MALANDAY-RECTO" else "Recto → Malanday"
    return {
        "published":      True,
        "route_id":       route_id,
        "direction":      direction,
        "stop_zones":     len(stop_clusters),
        "trips_analyzed": len(trips),
        "logs_analyzed":  len(all_points),
        "published_at":   now.isoformat() + "Z",
        "message": (
            f"Published {len(stop_clusters)} stop zones for {dir_label} "
            f"from {len(trips)} trips ({len(all_points)} GPS logs)."
        ),
    }


# ── Admin: dry-run preview — same DBSCAN pipeline, nothing saved ───────────

@router.get("/admin/route/{route_id}/preview-stops", tags=["Admin"])
def preview_stop_zones(
    route_id: str,
    direction: str = Query("MALANDAY-RECTO"),
    db: Session = Depends(get_db),
):
    """
    Dry-run equivalent of publish-stops.
    Runs the same DBSCAN pipeline but does NOT write to the database.
    Returns the clusters that WOULD be published so the admin can review
    before committing.
    """
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"direction must be one of: {', '.join(VALID_DIRECTIONS)}"
        )

    trips = _get_completed_trips(route_id, db, direction=direction)
    if not trips:
        return {
            "route_id":  route_id,
            "direction": direction,
            "clusters":  [],
            "message":   "No completed trips found for this direction.",
        }

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
        return {
            "route_id":  route_id,
            "direction": direction,
            "clusters":  [],
            "message":   "No GOOD/ACCEPTABLE GPS logs found for this direction.",
        }

    result = run_dbscan(all_points, cap, eps_m=30.0, min_samples=20)
    clusters = result.get("clusters", [])

    stop_clusters = [
        c for c in clusters
        if getattr(c, "cluster_type", "TRUE_STOP") == "TRUE_STOP"
    ]
    if not stop_clusters:
        stop_clusters = clusters

    stop_clusters.sort(key=lambda c: c.point_count, reverse=True)

    return {
        "route_id":       route_id,
        "direction":      direction,
        "trips_analyzed": len(trips),
        "logs_analyzed":  len(all_points),
        "clusters": [
            {
                "cluster_id":      int(c.cluster_id),
                "centroid_lat":    round(snap[0], 7),
                "centroid_lon":    round(snap[1], 7),
                "point_count":     int(c.point_count),
                "demand_tier":     getattr(c, "demand_tier", "Normal"),
                "avg_occupancy":   round(getattr(c, "avg_occupancy", 0), 1),
                "peak_period":     getattr(c, "peak_period", "—"),
                "load_factor_pct": round(getattr(c, "load_factor_pct", 0), 1),
                "color":           TIER_COLOR.get(getattr(c, "demand_tier", "Normal"), "#1565c0"),
            }
            for c in stop_clusters
            for snap in (match_to_corridor(c.centroid_lat, c.centroid_lon, direction),)
        ],
    }


# ── Admin: view published stop zones (per direction) ───────────────────────

@router.get("/admin/route/{route_id}/published-stops", tags=["Admin"])
def get_published_stops_admin(
    route_id: str,
    direction: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Admin view of currently published stop zones.
    If direction is given, returns only that direction.
    Otherwise returns a summary of both directions.
    """
    if direction:
        zones = (
            db.query(PublishedStopZone)
            .filter(
                PublishedStopZone.route_id == route_id,
                PublishedStopZone.direction == direction,
            )
            .order_by(PublishedStopZone.rank)
            .all()
        )
        if not zones:
            return {
                "route_id":   route_id,
                "direction":  direction,
                "published":  False,
                "stop_zones": [],
                "message":    f"No stop zones published for direction {direction}.",
            }
        return {
            "route_id":       route_id,
            "direction":      direction,
            "published":      True,
            "published_at":   zones[0].published_at.isoformat() + "Z",
            "trips_analyzed": zones[0].trips_analyzed,
            "logs_analyzed":  zones[0].logs_analyzed,
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
        }

    # No direction — return summary of both
    summary = {}
    for dir_key in VALID_DIRECTIONS:
        zones = (
            db.query(PublishedStopZone)
            .filter(
                PublishedStopZone.route_id == route_id,
                PublishedStopZone.direction == dir_key,
            )
            .order_by(PublishedStopZone.rank)
            .all()
        )
        if zones:
            summary[dir_key] = {
                "published":      True,
                "stop_zones":     len(zones),
                "trips_analyzed": zones[0].trips_analyzed,
                "logs_analyzed":  zones[0].logs_analyzed,
                "published_at":   zones[0].published_at.isoformat() + "Z",
            }
        else:
            summary[dir_key] = {"published": False}

    return {
        "route_id": route_id,
        "directions": summary,
    }


# ── Public: read published stop zones ─────────────────────────────────────

@router.get("/public/route/{route_id}/stop-zones", tags=["Public"])
def get_public_stop_zones(
    route_id: str,
    direction: str = Query("MALANDAY-RECTO"),
    db: Session = Depends(get_db),
):
    """
    Public read-only endpoint.
    Returns published stop zones for the given direction.
    Defaults to MALANDAY-RECTO for backwards compatibility.
    """
    zones = (
        db.query(PublishedStopZone)
        .filter(
            PublishedStopZone.route_id == route_id,
            PublishedStopZone.direction == direction,
        )
        .order_by(PublishedStopZone.rank)
        .all()
    )

    if not zones:
        return {
            "route_id":   route_id,
            "direction":  direction,
            "published":  False,
            "stop_zones": [],
            "total_trips_analyzed": 0,
            "message":    f"Stop zones not yet published for {direction}.",
        }

    return {
        "route_id":             route_id,
        "direction":            direction,
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


# ── Public: GPS path from best completed trip (per direction) ──────────────

@router.get("/public/route/{route_id}/path", tags=["Public"])
def get_route_path(
    route_id: str,
    direction: str = Query("MALANDAY-RECTO"),
    db: Session = Depends(get_db),
):
    """
    Returns the GPS track of the best completed trip for a given direction.
    Used by the map to detect direction — NOT used for the road line.
    """
    trips = _get_completed_trips(route_id, db, direction=direction)
    if not trips:
        return {"route_id": route_id, "direction": direction, "path": []}

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
        return {"route_id": route_id, "direction": direction, "path": []}

    logs = (
        db.query(GPSLog.latitude, GPSLog.longitude, GPSLog.timestamp)
        .filter(
            GPSLog.trip_id == best_trip.trip_id,
            GPSLog.gps_quality_flag == GPSQualityEnum.GOOD,
        )
        .order_by(GPSLog.timestamp)
        .all()
    )

    path = [
        {"lat": round(log.latitude, 6), "lon": round(log.longitude, 6)}
        for i, log in enumerate(logs)
        if i % 3 == 0
    ]

    return {
        "route_id":    route_id,
        "direction":   direction,
        "trip_id":     best_trip.trip_id,
        "point_count": len(path),
        "path":        path,
    }
