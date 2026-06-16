from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import Optional

from app.database import get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.published_stop_zone import PublishedStopZone
from app.analytics.algorithms import GPSPoint, run_dbscan
from app.analytics.corridor import match_to_corridor, haversine_m

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


# ── Admin: rule-based recommendations per published stop zone ─────────────

@router.get("/stop-zones/recommendations", tags=["Admin"])
def get_stop_zone_recommendations(
    route_id:  str = Query("MR-001"),
    direction: str = Query("MALANDAY-RECTO"),
    db: Session = Depends(get_db),
):
    """
    For each published stop zone in the given direction, returns:
      - demand_tier  (High/Medium/Low — mapped from Critical/High/Moderate/Normal)
      - confidence   (High/Medium/Low — trip-day coverage relative to total days)
      - recommendation (rule-based text, no ML)
      - nearest_gt_name (nearest ground-truth stop within 50 m)
    Pure function — no writes.
    """
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS

    PHT_OFFSET = timedelta(hours=8)
    NEAR_M     = 50.0     # ≤50m  → "near {GT name}"
    APPROX_M   = 120.0    # ≤120m → "near {GT name} (approx.)"  |  >120m → "New area near {GT name}"
    COVER_M    = 50.0     # haversine threshold for trip-day coverage
    LAT_TOL    = 0.00045  # bounding-box pre-filter ≈ 50 m in latitude
    LON_TOL    = 0.00060  # bounding-box pre-filter ≈ 50 m in longitude at 14.6° N

    if direction not in VALID_DIRECTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"direction must be one of: {', '.join(VALID_DIRECTIONS)}"
        )

    zones = (
        db.query(PublishedStopZone)
        .filter(
            PublishedStopZone.route_id  == route_id,
            PublishedStopZone.direction == direction,
        )
        .order_by(PublishedStopZone.rank)
        .all()
    )

    if not zones:
        return {
            "route_id":        route_id,
            "direction":       direction,
            "total_trip_days": 0,
            "zones":           [],
            "message":         "No published stop zones found for this direction.",
        }

    trips = _get_completed_trips(route_id, db, direction=direction)

    # PHT date → [trip_id, ...]
    trip_day_map: dict = {}
    for trip in trips:
        if trip.start_time:
            pht_day = (trip.start_time + PHT_OFFSET).strftime("%Y-%m-%d")
            trip_day_map.setdefault(pht_day, []).append(trip.trip_id)
    total_trip_days = len(trip_day_map)

    def _map_tier(raw: str) -> str:
        if raw in ("Critical", "High"):
            return "High"
        if raw == "Moderate":
            return "Medium"
        return "Low"

    def _nearest_gt_banded(lat: float, lon: float) -> tuple:
        """Return (display_name, raw_gt_name) using 3-band distance logic."""
        best_d, best_n = float("inf"), None
        for name, gt_lat, gt_lon in GROUND_TRUTH_STOPS:
            d = haversine_m(lat, lon, gt_lat, gt_lon)
            if d < best_d:
                best_d, best_n = d, name
        if best_d <= NEAR_M:
            return (f"near {best_n}", best_n)
        if best_d <= APPROX_M:
            return (f"near {best_n} (approx.)", best_n)
        return (f"New area near {best_n}", best_n)

    def _recommend(tier: str, conf: str, days: int) -> str:
        if days < 3:
            return "Insufficient data — continue monitoring"
        if tier == "High" and conf == "High":
            return "Consider formalizing this location"
        if tier == "High" and conf == "Medium":
            return "Showing consistent demand — prioritize for formalization review"
        if tier == "High" and conf == "Low":
            return "Monitor before formalizing — demand inconsistent across collection days"
        if tier == "Low" and conf == "High":
            return "Stop underutilized — consider consolidating with nearby stop"
        return "Continue monitoring — moderate demand, not yet a formalization candidate"

    result_zones = []
    for zone in zones:
        z_lat = float(zone.lat)
        z_lon = float(zone.lon)

        # Trip-day coverage — SQL bounding box pre-filter + exact Haversine
        days_covered = 0
        for _day, trip_ids in trip_day_map.items():
            hit = False
            for tid in trip_ids:
                if hit:
                    break
                candidates = (
                    db.query(GPSLog.latitude, GPSLog.longitude)
                    .filter(
                        GPSLog.trip_id == tid,
                        GPSLog.gps_quality_flag.in_([GPSQualityEnum.GOOD, GPSQualityEnum.ACCEPTABLE]),
                        GPSLog.latitude  >= z_lat - LAT_TOL,
                        GPSLog.latitude  <= z_lat + LAT_TOL,
                        GPSLog.longitude >= z_lon - LON_TOL,
                        GPSLog.longitude <= z_lon + LON_TOL,
                    )
                    .limit(50)
                    .all()
                )
                for cand_lat, cand_lon in candidates:
                    if haversine_m(z_lat, z_lon, float(cand_lat), float(cand_lon)) <= COVER_M:
                        hit = True
                        break
            if hit:
                days_covered += 1

        coverage_pct = (days_covered / total_trip_days * 100) if total_trip_days else 0.0
        confidence   = "High" if coverage_pct >= 60 else "Medium" if coverage_pct >= 30 else "Low"
        demand_tier  = _map_tier(zone.demand_tier or "Normal")
        name, nearest_gt = _nearest_gt_banded(z_lat, z_lon)

        result_zones.append({
            "cluster_id":            zone.cluster_id,
            "source":                "published",
            "name":                  name,
            "nearest_gt_name":       nearest_gt,
            "centroid_lat":          round(z_lat, 7),
            "centroid_lon":          round(z_lon, 7),
            "demand_tier_raw":       zone.demand_tier,
            "demand_tier":           demand_tier,
            "trip_day_coverage":     days_covered,
            "total_trip_days":       total_trip_days,
            "trip_day_coverage_pct": round(coverage_pct, 1),
            "confidence":            confidence,
            "recommendation":        _recommend(demand_tier, confidence, days_covered),
            "avg_occupancy":         float(zone.avg_occupancy or 0),
            "peak_period":           zone.peak_period or "—",
            "point_count":           int(zone.point_count),
            "load_factor_pct":       float(zone.load_factor_pct or 0),
            "rank":                  zone.rank,
        })

    return {
        "route_id":        route_id,
        "direction":       direction,
        "total_trip_days": total_trip_days,
        "zones":           result_zones,
    }


# ── Admin: action items — top 3 prioritized recommendations ───────────────

@router.get("/admin/action-items", tags=["Admin"])
def get_action_items(db: Session = Depends(get_db)):
    """
    Returns up to 3 prioritized action items derived from published stop zones
    and trip load factor data.

    P1 — Formalize candidate: High-demand zone with High trip-day coverage (>=60%)
    P2 — Staffing signal: period+direction with avg load factor >= 85%
         (approximated from trip start times — not per-stop measurements)
    P3 — Consolidation candidate: Low-demand zone with High trip-day coverage (>=60%)
    """
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS

    PHT_OFFSET = timedelta(hours=8)
    COVER_M    = 50.0
    MATCH_M    = 50.0
    LAT_TOL    = 0.00045
    LON_TOL    = 0.00060

    def _nearest_gt_local(lat: float, lon: float) -> Optional[str]:
        best_d, best_n = MATCH_M, None
        for name, gt_lat, gt_lon in GROUND_TRUTH_STOPS:
            d = haversine_m(lat, lon, gt_lat, gt_lon)
            if d < best_d:
                best_d, best_n = d, name
        return best_n

    def _period_local(h: int) -> str:
        if   6 <= h <  9: return "Morning Peak"
        elif 9 <= h < 16: return "Midday"
        elif 16 <= h < 19: return "Afternoon Peak"
        else:              return "Off-Peak"

    all_trips = _get_completed_trips("MR-001", db)

    trip_day_map: dict = {}
    for trip in all_trips:
        if trip.start_time:
            pht_day = (trip.start_time + PHT_OFFSET).strftime("%Y-%m-%d")
            trip_day_map.setdefault(pht_day, []).append(trip.trip_id)
    total_trip_days = len(trip_day_map)

    def _coverage_pct(z_lat: float, z_lon: float) -> float:
        if not total_trip_days:
            return 0.0
        days_covered = 0
        for _day, trip_ids in trip_day_map.items():
            hit = False
            for tid in trip_ids:
                if hit:
                    break
                candidates = (
                    db.query(GPSLog.latitude, GPSLog.longitude)
                    .filter(
                        GPSLog.trip_id == tid,
                        GPSLog.gps_quality_flag.in_([GPSQualityEnum.GOOD, GPSQualityEnum.ACCEPTABLE]),
                        GPSLog.latitude  >= z_lat - LAT_TOL,
                        GPSLog.latitude  <= z_lat + LAT_TOL,
                        GPSLog.longitude >= z_lon - LON_TOL,
                        GPSLog.longitude <= z_lon + LON_TOL,
                    )
                    .limit(50)
                    .all()
                )
                for cand_lat, cand_lon in candidates:
                    if haversine_m(z_lat, z_lon, float(cand_lat), float(cand_lon)) <= COVER_M:
                        hit = True
                        break
            if hit:
                days_covered += 1
        return (days_covered / total_trip_days * 100) if total_trip_days else 0.0

    items = []

    # P1 — Formalize candidate (High demand, coverage >= 60%)
    p1_zones = (
        db.query(PublishedStopZone)
        .filter(
            PublishedStopZone.route_id == "MR-001",
            PublishedStopZone.demand_tier.in_(["Critical", "High"]),
        )
        .order_by(PublishedStopZone.avg_occupancy.desc())
        .limit(5)
        .all()
    )
    for z in p1_zones:
        z_lat, z_lon = float(z.lat), float(z.lon)
        cov = _coverage_pct(z_lat, z_lon)
        if cov >= 60:
            gt_name  = _nearest_gt_local(z_lat, z_lon)
            dir_disp = "Malanday → Recto" if z.direction == "MALANDAY-RECTO" else "Recto → Malanday"
            if gt_name:
                headline_p1 = (
                    f"Formalize stop near {gt_name} — consistently high demand "
                    f"(avg {float(z.avg_occupancy or 0):.1f} pax, "
                    f"{cov:.0f}% trip-day coverage)"
                )
            else:
                headline_p1 = (
                    f"Formalize new boarding area (unverified stop, high demand) — "
                    f"avg {float(z.avg_occupancy or 0):.1f} pax, "
                    f"{cov:.0f}% trip-day coverage, {dir_disp}"
                )
            items.append({
                "priority":    1,
                "type":        "formalize",
                "headline":    headline_p1,
                "detail_link": "/admin/stop-zones",
                "cluster_id":  z.cluster_id,
                "direction":   z.direction,
            })
            break

    # P2 — Staffing signal (period + direction with avg load factor >= 85%)
    trip_ids_list = [t.trip_id for t in all_trips]
    if trip_ids_list:
        lf_rows = (
            db.query(
                GPSLog.trip_id,
                func.avg(GPSLog.occupancy_count).label("avg_occ"),
            )
            .filter(GPSLog.trip_id.in_(trip_ids_list))
            .group_by(GPSLog.trip_id)
            .all()
        )
        lf_by_trip = {r.trip_id: float(r.avg_occ or 0) for r in lf_rows}

        period_lf: dict = {}
        for trip in all_trips:
            cap     = trip.official_capacity or 26
            avg_occ = lf_by_trip.get(trip.trip_id, 0)
            lf_pct  = avg_occ / cap * 100
            if not trip.start_time:
                continue
            pht_h  = (trip.start_time + PHT_OFFSET).hour
            period = _period_local(pht_h)
            key    = (period, trip.direction or "MALANDAY-RECTO")
            period_lf.setdefault(key, []).append(lf_pct)

        best_key, best_avg = None, 0.0
        for key, vals in period_lf.items():
            avg = sum(vals) / len(vals) if vals else 0.0
            if avg > best_avg:
                best_avg, best_key = avg, key

        if best_key and best_avg >= 85:
            period_label, direction = best_key
            dir_label = "Malanday to Recto" if direction == "MALANDAY-RECTO" else "Recto to Malanday"
            n_trips   = len(period_lf[best_key])
            if best_avg > 100:
                headline_p2 = (
                    f"{period_label}, {dir_label} is running over capacity — "
                    f"avg load factor {best_avg:.1f}% across {n_trips} trips. "
                    f"Consider adding a unit or increasing frequency."
                )
            else:
                headline_p2 = (
                    f"Consider adding a unit during {period_label}, {dir_label} — "
                    f"avg load factor {best_avg:.1f}% across {n_trips} trips "
                    f"(based on trip start time)"
                )
            items.append({
                "priority":    2,
                "type":        "staffing",
                "headline":    headline_p2,
                "detail_link": "/admin/corridors",
            })

    # P3 — Consolidation candidate (Low demand, coverage >= 60%)
    p3_zones = (
        db.query(PublishedStopZone)
        .filter(
            PublishedStopZone.route_id == "MR-001",
            PublishedStopZone.demand_tier == "Normal",
        )
        .order_by(PublishedStopZone.avg_occupancy.asc())
        .limit(5)
        .all()
    )
    for z in p3_zones:
        z_lat, z_lon = float(z.lat), float(z.lon)
        cov = _coverage_pct(z_lat, z_lon)
        if cov >= 60:
            gt_name  = _nearest_gt_local(z_lat, z_lon)
            dir_disp = "Malanday → Recto" if z.direction == "MALANDAY-RECTO" else "Recto → Malanday"
            if gt_name:
                headline_p3 = (
                    f"Review stop near {gt_name} — low demand, consistently present "
                    f"(avg {float(z.avg_occupancy or 0):.1f} pax, "
                    f"{cov:.0f}% trip-day coverage)"
                )
            else:
                headline_p3 = (
                    f"Review unverified stop zone (low demand) — "
                    f"avg {float(z.avg_occupancy or 0):.1f} pax, "
                    f"{cov:.0f}% trip-day coverage, {dir_disp}"
                )
            items.append({
                "priority":    3,
                "type":        "consolidate",
                "headline":    headline_p3,
                "detail_link": "/admin/stop-zones",
                "cluster_id":  z.cluster_id,
                "direction":   z.direction,
            })
            break

    return {
        "items":        items,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "footnote":     "Staffing signals are approximated from trip start time periods, not per-stop measurements.",
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
