"""
RutaSmart Analytics API Routes
================================
All endpoints require a completed trip_id.
POOR logs are filtered inside run_dbscan(); all other features use full logs.

Endpoints
---------
GET /analytics/{trip_id}/quality      GPS quality breakdown
GET /analytics/{trip_id}/dbscan       DBSCAN cluster detection
GET /analytics/{trip_id}/load-factor  Load factor by period
GET /analytics/{trip_id}/demand       Demand intensity distribution
GET /analytics/{trip_id}/time         Time period distribution
GET /analytics/{trip_id}/run-all      All four features in one call
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog
from app.analytics.algorithms import (
    GPSPoint,
    run_dbscan,
    run_overlap_dbscan,
    run_sensitivity_analysis,
    gps_quality_summary,
    load_factor_by_period,
    trip_load_factor_summary,
    classify_demand_distribution,
    time_period_distribution,
)
from app.analytics.schemas import (
    DBSCANResult,
    GPSQualityResult,
    LoadFactorResult,
    DemandResult,
    TimeResult,
    FullAnalyticsResult,
    StopClusterOut,
    PeriodStat,
    TierCount,
    PeriodCount,
    SensitivityResult,
    SensitivityRow,
    OverlapResult,
    OverlapSegment,
)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _get_completed_trip(trip_id: str, db: Session) -> Trip:
    """Fetch trip, raise 404/409 if missing or not completed."""
    trip = db.query(Trip).filter(Trip.trip_id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status != TripStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Analytics only available on COMPLETED trips"
        )
    return trip


def _fetch_points(trip_id: str, db: Session) -> list[GPSPoint]:
    """Load all GPS logs for a trip and convert to GPSPoint dataclasses."""
    logs = (
        db.query(GPSLog)
        .filter(GPSLog.trip_id == trip_id)
        .order_by(GPSLog.timestamp.asc())
        .all()
    )
    return [
        GPSPoint(
            log_id=log.log_id,
            latitude=log.latitude,
            longitude=log.longitude,
            accuracy=log.accuracy,
            gps_quality_flag=str(log.gps_quality_flag.value
                                  if hasattr(log.gps_quality_flag, "value")
                                  else log.gps_quality_flag),
            occupancy_count=log.occupancy_count,
            timestamp=log.timestamp,
            trip_id=log.trip_id,
        )
        for log in logs
    ]


# ── 1. GPS Quality ─────────────────────────────────────────────────────────────

@router.get("/{trip_id}/quality", response_model=GPSQualityResult)
def get_gps_quality(trip_id: str, db: Session = Depends(get_db)):
    """
    GPS quality breakdown: GOOD / ACCEPTABLE / POOR counts and percentages.
    Also reports how many logs are eligible for DBSCAN vs. excluded.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    summary = gps_quality_summary(points)
    return GPSQualityResult(trip_id=trip_id, **summary)


# ── 2. DBSCAN Stop Cluster Detection ──────────────────────────────────────────

@router.get("/{trip_id}/dbscan", response_model=DBSCANResult)
def get_dbscan_clusters(
    trip_id: str,
    eps_m: float = Query(default=50.0, gt=0, le=500,
                         description="Cluster radius in metres"),
    min_samples: int = Query(default=5, ge=2, le=50,
                             description="Minimum points per cluster"),
    db: Session = Depends(get_db),
):
    """
    Run DBSCAN stop-cluster detection on GOOD+ACCEPTABLE GPS logs.

    POOR logs (accuracy > 50m) are excluded from spatial clustering
    because their positional error exceeds epsilon, making them
    unreliable for cluster assignment.

    Default parameters match the thesis blueprint: eps=50m, minPts=5.
    Adjust via query string for sensitivity analysis.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    result = run_dbscan(points, trip.official_capacity, eps_m, min_samples)

    clusters_out = [
        StopClusterOut(
            cluster_id=c.cluster_id,
            centroid_lat=c.centroid_lat,
            centroid_lon=c.centroid_lon,
            point_count=c.point_count,
            avg_occupancy=c.avg_occupancy,
            max_occupancy=c.max_occupancy,
            demand_tier=c.demand_tier,
            peak_period=c.peak_period,
            load_factor_pct=c.load_factor_pct,
            noise_ratio_pct=c.noise_ratio_pct,
            avg_velocity_ms=c.avg_velocity_ms,
            cluster_type=c.cluster_type,
        )
        for c in result["clusters"]
    ]

    return DBSCANResult(
        trip_id=trip_id,
        clusters=clusters_out,
        noise_ratio=result["noise_ratio"],
        eps_m=result["eps_m"],
        min_samples=result["min_samples"],
        total_input=result["total_input"],
        dbscan_input=result["dbscan_input"],
        noise_points=result["noise_points"],
    )


# ── 3. Load Factor ─────────────────────────────────────────────────────────────

@router.get("/{trip_id}/load-factor", response_model=LoadFactorResult)
def get_load_factor(trip_id: str, db: Session = Depends(get_db)):
    """
    Load factor (occupancy / capacity × 100) broken down by time period.
    POOR logs are INCLUDED — occupancy data is valid regardless of GPS accuracy.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    overall = trip_load_factor_summary(points, trip.official_capacity)
    by_period_raw = load_factor_by_period(points, trip.official_capacity)

    by_period = {
        period: PeriodStat(**stats)
        for period, stats in by_period_raw.items()
    }

    return LoadFactorResult(
        trip_id=trip_id,
        official_capacity=trip.official_capacity,
        overall=overall,
        by_period=by_period,
    )


# ── 4. Demand Intensity ────────────────────────────────────────────────────────

@router.get("/{trip_id}/demand", response_model=DemandResult)
def get_demand(trip_id: str, db: Session = Depends(get_db)):
    """
    Demand intensity distribution across Normal / Moderate / High / Critical.
    Based on occupancy vs. official capacity. Includes POOR logs.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    dist_raw = classify_demand_distribution(points, trip.official_capacity)
    distribution = {
        tier: TierCount(**data)
        for tier, data in dist_raw.items()
    }

    return DemandResult(trip_id=trip_id, distribution=distribution)


# ── 5. Time Period Distribution ────────────────────────────────────────────────

@router.get("/{trip_id}/time", response_model=TimeResult)
def get_time_distribution(trip_id: str, db: Session = Depends(get_db)):
    """
    Log count per time period: Morning Peak / Midday / Afternoon Peak / Off-Peak.
    """
    _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    dist_raw = time_period_distribution(points)
    distribution = {
        period: PeriodCount(**data)
        for period, data in dist_raw.items()
    }

    return TimeResult(trip_id=trip_id, distribution=distribution)


@router.get("/{trip_id}/sensitivity", response_model=SensitivityResult)
def get_sensitivity_analysis(
    trip_id: str,
    db: Session = Depends(get_db),
):
    """
    Grid search over eps × minPts for Task A (stop cluster detection).

    Runs DBSCAN across eps = [30, 40, 50, 60, 75, 100] m and
    minPts = [3, 5, 8, 10], returning for each cell:
      - cluster_count, noise_points, avg_cluster_size
      - centroid_spread_m (stability proxy)
      - true_stop_count, creeping_queue_count, moving_count

    Use this to justify eps=50 / minPts=5 as the recommended parameters
    in your thesis Chapter 4 and defense sensitivity analysis.

    Parameter justification embedded in response as 'recommended' field.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    rows_raw = run_sensitivity_analysis(points, trip.official_capacity)
    rows = [SensitivityRow(**r) for r in rows_raw]

    # Highlight the recommended cell with justification
    recommended = {
        "eps_m":       50,
        "min_samples": 5,
        "justification": [
            "eps=50m matches ACCEPTABLE GPS accuracy threshold (coherent filter boundary)",
            "At 30km/h, 2 consecutive moving logs span ~50m — barely neighbors, not clusters",
            "Closest Malanday-Recto stops ~80m apart — safe margin from accidental merging",
            "minPts=5 requires only 15s dwell — captures quick boarding stops",
            "After 18% POOR filtering, a 30s stop still yields ~8 clean logs > minPts=5",
        ],
    }

    return SensitivityResult(trip_id=trip_id, rows=rows, recommended=recommended)


@router.get("/overlap/{trip_a_id}/{trip_b_id}", response_model=OverlapResult)
def get_route_overlap(
    trip_a_id: str,
    trip_b_id: str,
    eps_m: float = Query(default=75.0, gt=0, le=500,
                         description="Overlap radius in metres (Task B: 75m recommended)"),
    min_samples: int = Query(default=20, ge=2, le=100,
                             description="Min logs for sustained overlap (≥100m road segment)"),
    db: Session = Depends(get_db),
):
    """
    Detect shared road segments between two completed trips (Task B).

    Uses DIFFERENT parameters from Task A (stop detection):
      eps=75m   — wider to tolerate GPS noise + lane width + cross-track error
      minPts=20 — requires ≥100m of sustained co-presence to call it overlap

    Both trips must be COMPLETED.
    Clusters where both trips contribute ≥ minPts/2 points are overlap segments.
    """
    # Both trips must exist and be completed
    trip_a = _get_completed_trip(trip_a_id, db)
    trip_b = _get_completed_trip(trip_b_id, db)

    points_a = _fetch_points(trip_a_id, db)
    points_b = _fetch_points(trip_b_id, db)

    if not points_a:
        raise HTTPException(status_code=404, detail=f"No GPS logs for trip {trip_a_id}")
    if not points_b:
        raise HTTPException(status_code=404, detail=f"No GPS logs for trip {trip_b_id}")

    result = run_overlap_dbscan(points_a, points_b, eps_m, min_samples)

    def to_segment(s: dict) -> OverlapSegment:
        return OverlapSegment(**s)

    return OverlapResult(
        trip_a_id=trip_a_id,
        trip_b_id=trip_b_id,
        overlap_segments=[to_segment(s) for s in result["overlap_segments"]],
        trip_a_only=[to_segment(s) for s in result["trip_a_only"]],
        trip_b_only=[to_segment(s) for s in result["trip_b_only"]],
        eps_m=result["eps_m"],
        min_samples=result["min_samples"],
        total_a=result["total_a"],
        total_b=result["total_b"],
    )


# ── 6. Full Analytics Run ──────────────────────────────────────────────────────

@router.get("/{trip_id}/run-all", response_model=FullAnalyticsResult)
def run_all_analytics(
    trip_id: str,
    eps_m: float = Query(default=50.0, gt=0, le=500),
    min_samples: int = Query(default=5, ge=2, le=50),
    db: Session = Depends(get_db),
):
    """
    Run all four analytical features in a single call.
    This is the primary endpoint for the Admin/Analyst dashboard.

    Returns GPS quality summary, DBSCAN clusters, load factor by period,
    demand intensity distribution, and time period distribution.
    """
    trip = _get_completed_trip(trip_id, db)
    points = _fetch_points(trip_id, db)

    if not points:
        raise HTTPException(status_code=404, detail="No GPS logs for this trip")

    # ── GPS quality ──────────────────────────────────────────────────────────
    quality_raw = gps_quality_summary(points)
    gps_quality = GPSQualityResult(trip_id=trip_id, **quality_raw)

    # ── DBSCAN ───────────────────────────────────────────────────────────────
    dbscan_raw = run_dbscan(points, trip.official_capacity, eps_m, min_samples)
    clusters_out = [StopClusterOut(**{
        "cluster_id":      c.cluster_id,
        "centroid_lat":    c.centroid_lat,
        "centroid_lon":    c.centroid_lon,
        "point_count":     c.point_count,
        "avg_occupancy":   c.avg_occupancy,
        "max_occupancy":   c.max_occupancy,
        "demand_tier":     c.demand_tier,
        "peak_period":     c.peak_period,
        "load_factor_pct": c.load_factor_pct,
        "noise_ratio_pct": c.noise_ratio_pct,
    }) for c in dbscan_raw["clusters"]]

    dbscan = DBSCANResult(
        trip_id=trip_id,
        clusters=clusters_out,
        noise_ratio=dbscan_raw["noise_ratio"],
        eps_m=dbscan_raw["eps_m"],
        min_samples=dbscan_raw["min_samples"],
        total_input=dbscan_raw["total_input"],
        dbscan_input=dbscan_raw["dbscan_input"],
        noise_points=dbscan_raw["noise_points"],
    )

    # ── Load factor ──────────────────────────────────────────────────────────
    overall = trip_load_factor_summary(points, trip.official_capacity)
    by_period = {
        period: PeriodStat(**stats)
        for period, stats in load_factor_by_period(
            points, trip.official_capacity
        ).items()
    }
    load_factor = LoadFactorResult(
        trip_id=trip_id,
        official_capacity=trip.official_capacity,
        overall=overall,
        by_period=by_period,
    )

    # ── Demand ───────────────────────────────────────────────────────────────
    demand = DemandResult(
        trip_id=trip_id,
        distribution={
            tier: TierCount(**data)
            for tier, data in classify_demand_distribution(
                points, trip.official_capacity
            ).items()
        },
    )

    # ── Time distribution ────────────────────────────────────────────────────
    time_dist = TimeResult(
        trip_id=trip_id,
        distribution={
            period: PeriodCount(**data)
            for period, data in time_period_distribution(points).items()
        },
    )

    return FullAnalyticsResult(
        trip_id=trip_id,
        gps_quality=gps_quality,
        dbscan=dbscan,
        load_factor=load_factor,
        demand=demand,
        time_dist=time_dist,
    )
