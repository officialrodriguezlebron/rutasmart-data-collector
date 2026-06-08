"""
ml_optimized_dbscan.py
======================
ML-Optimized DBSCAN — 4th clustering variant for RutaSmart.

Mirrors the structure of the three existing variants (Vanilla DBSCAN,
Kalman-smoothed DBSCAN, W-DBSCAN) without modifying any of them.

On first request the module loads epsilon and min_samples from
best_params.json produced by the training pipeline (ml_trainer.py).
If the file is absent or malformed the variant falls back to the same
defaults used by Vanilla DBSCAN (eps=50 m, min_samples=5), so the
endpoint is always safe to call even before training has been run.

Exposes
-------
    POST /api/clusters/ml-optimized

Request body (JSON)
-------------------
    {
        "trip_id":   "<uuid-string>",      # optional — single trip
        "direction": "MALANDAY-RECTO"      # optional — all trips in corridor
    }
    Omit both to run on all COMPLETED trips across both directions.

Response shape
--------------
    Same fields as DBSCANResult from the existing endpoints, plus:
        variant       : "ml-optimized"
        params_source : "trained" | "default"
        n_clusters    : int
    Frontend consumers can drop-in this endpoint without any changes.
"""

import json
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Fallback defaults (identical to Vanilla DBSCAN) ──────────────────────────
_DEFAULT_EPS_M       = 50.0
_DEFAULT_MIN_SAMPLES = 5

# ── Artifact path — backend root, next to train_pipeline.py ──────────────────
_PARAMS_FILE = Path(__file__).resolve().parents[2] / "best_params.json"


def _load_params() -> tuple[float, int]:
    """
    Load (eps_m, min_samples) from best_params.json.

    Always returns a valid pair — falls back to Vanilla DBSCAN defaults
    if the file does not exist or cannot be parsed.
    """
    try:
        with open(_PARAMS_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        eps_m       = float(data["eps_m"])
        min_samples = int(data["min_samples"])
        logger.info(
            "ML-Optimized DBSCAN: loaded eps_m=%.0f min_samples=%d from %s",
            eps_m, min_samples, _PARAMS_FILE.name,
        )
        return eps_m, min_samples
    except FileNotFoundError:
        logger.warning("best_params.json not found — using Vanilla defaults (eps=50 m, min_samples=5).")
        return _DEFAULT_EPS_M, _DEFAULT_MIN_SAMPLES
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("best_params.json malformed (%s) — using Vanilla defaults.", exc)
        return _DEFAULT_EPS_M, _DEFAULT_MIN_SAMPLES


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class MLDBSCANRequest(BaseModel):
    """Request body for POST /api/clusters/ml-optimized."""
    trip_id:   Optional[str] = None
    direction: Optional[str] = None   # MALANDAY-RECTO | RECTO-MALANDAY | None


class _StopClusterOut(BaseModel):
    cluster_id:      int
    centroid_lat:    float
    centroid_lon:    float
    point_count:     int
    avg_occupancy:   float
    max_occupancy:   int
    demand_tier:     str
    peak_period:     str
    load_factor_pct: float
    noise_ratio_pct: float
    avg_velocity_ms: float
    cluster_type:    str


class MLDBSCANResult(BaseModel):
    """Response — same core fields as DBSCANResult plus variant metadata."""
    variant:         str              # always "ml-optimized"
    params_source:   str              # "trained" | "default"
    trip_id:         Optional[str]
    direction:       Optional[str]
    eps_m:           float
    min_samples:     int
    clusters:        List[_StopClusterOut]
    n_clusters:      int
    noise_ratio:     float
    total_input:     int
    dbscan_input:    int
    noise_points:    int
    moving_excluded: int


# ─────────────────────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/clusters", tags=["ML-Optimized DBSCAN"])


@router.post("/ml-optimized", response_model=MLDBSCANResult)
def run_ml_optimized_dbscan(body: MLDBSCANRequest) -> MLDBSCANResult:
    """
    ML-Optimized DBSCAN — 4th algorithm variant.

    Uses epsilon and min_samples learned by the training pipeline
    (train_pipeline.py → ml_trainer.py grid search) rather than
    manually tuned values. Falls back to Vanilla defaults if no training
    artifact exists.

    Supply `trip_id` for single-trip clustering, `direction` for all
    pooled trips in one corridor, or omit both for all COMPLETED trips.
    """
    from app.database import SessionLocal
    from app.models.gps_log import GPSLog
    from app.models.trip import Trip, TripStatusEnum
    from app.analytics.algorithms import GPSPoint, run_dbscan

    eps_m, min_samples = _load_params()
    params_source = "trained" if _PARAMS_FILE.exists() else "default"

    db = SessionLocal()
    try:
        # ── Fetch matching trips ──────────────────────────────────────────────
        trips_q = db.query(Trip).filter(Trip.status == TripStatusEnum.COMPLETED)

        if body.trip_id:
            trips_q = trips_q.filter(Trip.trip_id == body.trip_id)
        elif body.direction in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
            trips_q = trips_q.filter(Trip.direction == body.direction)

        trips = trips_q.all()
        if not trips:
            raise HTTPException(
                status_code=404,
                detail="No COMPLETED trips found for the given filter.",
            )

        cap = trips[0].official_capacity or 26

        # ── Pool GPS points from selected trips ───────────────────────────────
        all_points: List[GPSPoint] = []
        for trip in trips:
            logs = (
                db.query(GPSLog)
                .filter(GPSLog.trip_id == trip.trip_id)
                .all()
            )
            for log in logs:
                all_points.append(
                    GPSPoint(
                        log_id=str(log.log_id),
                        trip_id=log.trip_id,
                        latitude=float(log.latitude),
                        longitude=float(log.longitude),
                        accuracy=float(log.accuracy),
                        gps_quality_flag=str(
                            log.gps_quality_flag.value
                            if hasattr(log.gps_quality_flag, "value")
                            else log.gps_quality_flag
                        ),
                        occupancy_count=int(log.occupancy_count),
                        timestamp=log.timestamp,
                    )
                )

        if not all_points:
            raise HTTPException(status_code=404, detail="No GPS logs found for selected trips.")

        # ── Run ML-Optimized DBSCAN ───────────────────────────────────────────
        # Calls the unmodified run_dbscan() from algorithms.py — the existing
        # Vanilla / Kalman / W-DBSCAN variants are not touched.
        result = run_dbscan(all_points, cap, eps_m=eps_m, min_samples=min_samples)

        clusters_out = [
            _StopClusterOut(
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

        return MLDBSCANResult(
            variant=        "ml-optimized",
            params_source=  params_source,
            trip_id=        body.trip_id,
            direction=      body.direction,
            eps_m=          eps_m,
            min_samples=    min_samples,
            clusters=       clusters_out,
            n_clusters=     len(clusters_out),
            noise_ratio=    result["noise_ratio"],
            total_input=    result["total_input"],
            dbscan_input=   result["dbscan_input"],
            noise_points=   result["noise_points"],
            moving_excluded=result.get("moving_excluded", 0),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ML-Optimized DBSCAN endpoint error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Clustering failed: {exc}")
    finally:
        db.close()
