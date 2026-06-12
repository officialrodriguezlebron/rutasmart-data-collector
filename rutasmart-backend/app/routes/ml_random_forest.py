"""
ml_random_forest.py
===================
STEP 4 — FastAPI endpoint for the Random Forest stop classifier.

POST /api/clusters/ml-random-forest

Pipeline per request:
  1. Fetch GPS logs for the requested trip(s) / direction
  2. Run Vanilla DBSCAN (eps=50 m, min_samples=5) to detect cluster candidates
  3. For each cluster centroid extract 5 RF features:
       latitude, longitude, hour_of_day, direction, distance_to_nearest_stop
  4. Classify with Random Forest — keep only clusters where is_stop = 1
  5. Return filtered clusters in the standard DBSCANResult-compatible shape

The response is drop-in compatible with existing DBSCAN endpoints; frontend
requires zero changes (extra JSON fields are silently ignored).

Model file  : rutasmart-backend/models/rf_model.pkl
Ground truth: rutasmart-backend/data/ground_truth_stops_*.csv

DO NOT modify or import anything from algorithms.py except GPSPoint and
run_dbscan — existing Vanilla DBSCAN must remain untouched.
"""

import logging
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_BACKEND_ROOT   = Path(__file__).resolve().parents[2]
_MODEL_PATH     = _BACKEND_ROOT / "models" / "rf_model.pkl"
_DATA_DIR       = _BACKEND_ROOT / "data"
_EARTH_RADIUS_M = 6_371_000.0
_PHT_OFFSET     = timedelta(hours=8)

# Vanilla DBSCAN defaults — identical to analytics_routes.py
_EPS_M       = 50.0
_MIN_SAMPLES = 5

# Period → representative PHT hour mapping (matches categorise_time() bands)
_PERIOD_HOUR = {
    "Morning Peak":   7,
    "Midday":        12,
    "Afternoon Peak": 17,
    "Off-Peak":      20,
}

# ── Lazy-loaded singletons ────────────────────────────────────────────────────

_rf_model:  Optional[object] = None
_gt_fwd_rad: Optional[np.ndarray] = None
_gt_ret_rad: Optional[np.ndarray] = None


def _ensure_model() -> None:
    global _rf_model
    if _rf_model is not None:
        return
    if not _MODEL_PATH.exists():
        raise FileNotFoundError(
            "ML model not trained yet. Run train_pipeline.py first."
        )
    try:
        _rf_model = joblib.load(_MODEL_PATH)
        logger.info("RF model loaded from %s", _MODEL_PATH)
    except Exception as exc:
        raise RuntimeError(f"Failed to load RF model: {exc}") from exc


def _ensure_ground_truth() -> None:
    global _gt_fwd_rad, _gt_ret_rad
    if _gt_fwd_rad is not None:
        return
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS
    coords = np.array([(lat, lon) for _, lat, lon in GROUND_TRUTH_STOPS], dtype=float)
    rad = np.radians(coords)
    _gt_fwd_rad = rad  # both directions use the same 70 physical stops
    _gt_ret_rad = rad
    logger.info("Ground truth loaded: %d stops (canonical list)", len(GROUND_TRUTH_STOPS))


def _nearest_stop_dist(lat: float, lon: float, stops_rad: np.ndarray) -> float:
    """Vectorised Haversine: metres to nearest stop. Returns 9999 if no stops."""
    if stops_rad.shape[0] == 0:
        return 9999.0
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    dlat = stops_rad[:, 0] - lat1
    dlon = stops_rad[:, 1] - lon1
    a = (
        np.sin(dlat / 2) ** 2
        + math.cos(lat1) * np.cos(stops_rad[:, 0]) * np.sin(dlon / 2) ** 2
    )
    return float(np.min(_EARTH_RADIUS_M * 2 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))))


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RFRequest(BaseModel):
    trip_id:   Optional[str] = None
    direction: Optional[str] = None   # MALANDAY-RECTO | RECTO-MALANDAY


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
    avg_velocity_ms: float = 0.0
    cluster_type:    str   = "TRUE_STOP"
    rf_confidence:   float = 0.0      # P(is_stop=1) from RF — bonus field


class RFResult(BaseModel):
    """Drop-in compatible with DBSCANResult; extra fields ignored by frontend."""
    trip_id:         str
    clusters:        List[_StopClusterOut]
    noise_ratio:     float
    eps_m:           float
    min_samples:     int
    total_input:     int
    dbscan_input:    int
    noise_points:    int
    moving_excluded: int   = 0
    variant:         str   = "ml-random-forest"
    rf_clusters_in:  int   = 0    # DBSCAN clusters before RF filter
    rf_clusters_out: int   = 0    # clusters kept after RF filter


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/clusters", tags=["ML-Random-Forest"])


@router.post("/ml-random-forest", response_model=RFResult)
def run_ml_random_forest(body: RFRequest) -> RFResult:
    """
    Random Forest stop classifier — 4th algorithm variant.

    Runs Vanilla DBSCAN to detect spatial clusters, then uses the trained
    Random Forest to keep only clusters that are genuine bus stops.
    Supply trip_id for single-trip analysis, direction for all COMPLETED
    trips in one corridor, or omit both for all COMPLETED trips.
    """
    # ── Load artefacts (lazy, cached after first call) ────────────────────────
    try:
        _ensure_model()
        _ensure_ground_truth()
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    from app.database import SessionLocal
    from app.models.gps_log import GPSLog
    from app.models.trip import Trip, TripStatusEnum
    from app.analytics.algorithms import GPSPoint, run_dbscan

    db = SessionLocal()
    try:
        trips_q = db.query(Trip).filter(Trip.status == TripStatusEnum.COMPLETED)
        if body.trip_id:
            trips_q = trips_q.filter(Trip.trip_id == body.trip_id)
        elif body.direction in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
            trips_q = trips_q.filter(Trip.direction == body.direction)
        trips = trips_q.all()

        if not trips:
            raise HTTPException(status_code=404, detail="No COMPLETED trips found for the given filter.")

        cap       = trips[0].official_capacity or 26
        direction = trips[0].direction

        # ── Pool GPS points ───────────────────────────────────────────────────
        all_points: List[GPSPoint] = []
        for trip in trips:
            logs = db.query(GPSLog).filter(GPSLog.trip_id == trip.trip_id).all()
            for log in logs:
                all_points.append(GPSPoint(
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
                ))

        if not all_points:
            raise HTTPException(status_code=404, detail="No GPS logs found for selected trips.")

        # ── Vanilla DBSCAN ────────────────────────────────────────────────────
        dbscan_res = run_dbscan(all_points, cap, eps_m=_EPS_M, min_samples=_MIN_SAMPLES)
        raw_clusters = dbscan_res["clusters"]
        rf_clusters_in = len(raw_clusters)

        trip_id_out = body.trip_id or f"pooled:{direction}"

        if not raw_clusters:
            return RFResult(
                trip_id=trip_id_out,
                clusters=[],
                noise_ratio=dbscan_res["noise_ratio"],
                eps_m=_EPS_M,
                min_samples=_MIN_SAMPLES,
                total_input=dbscan_res["total_input"],
                dbscan_input=dbscan_res["dbscan_input"],
                noise_points=dbscan_res["noise_points"],
                moving_excluded=dbscan_res.get("moving_excluded", 0),
            )

        # ── Select ground truth array for this direction ──────────────────────
        gt_rad   = _gt_fwd_rad if direction == "MALANDAY-RECTO" else _gt_ret_rad
        dir_enc  = 0 if direction == "MALANDAY-RECTO" else 1

        # ── Build RF feature matrix — one row per cluster centroid ────────────
        feature_rows: List[List[float]] = []
        for c in raw_clusters:
            hour     = _PERIOD_HOUR.get(c.peak_period, 8)
            dist_m   = _nearest_stop_dist(c.centroid_lat, c.centroid_lon, gt_rad)
            feature_rows.append([c.centroid_lat, c.centroid_lon, hour, dir_enc, dist_m])

        X = np.array(feature_rows, dtype=float)

        # ── RF inference ──────────────────────────────────────────────────────
        try:
            preds  = _rf_model.predict(X)
            probas = _rf_model.predict_proba(X)[:, 1]
        except Exception as exc:
            logger.error("RF prediction failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"RF prediction error: {exc}")

        # ── Keep only is_stop = 1 clusters ────────────────────────────────────
        valid: List[_StopClusterOut] = []
        for c, pred, prob in zip(raw_clusters, preds, probas):
            if pred == 1:
                valid.append(_StopClusterOut(
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
                    rf_confidence=round(float(prob), 4),
                ))

        return RFResult(
            trip_id=trip_id_out,
            clusters=valid,
            noise_ratio=dbscan_res["noise_ratio"],
            eps_m=_EPS_M,
            min_samples=_MIN_SAMPLES,
            total_input=dbscan_res["total_input"],
            dbscan_input=dbscan_res["dbscan_input"],
            noise_points=dbscan_res["noise_points"],
            moving_excluded=dbscan_res.get("moving_excluded", 0),
            rf_clusters_in=rf_clusters_in,
            rf_clusters_out=len(valid),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ml-random-forest endpoint error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")
    finally:
        db.close()


@router.get("/ml-status", tags=["ML-Random-Forest"])
def get_ml_status() -> Dict[str, Any]:
    """
    Returns training status and key metrics for the Random Forest model.
    Reads data/evaluation_report.txt for metrics; uses model file mtime
    as the training timestamp.
    """
    _EVAL_REPORT = _BACKEND_ROOT / "data" / "evaluation_report.txt"
    _FEAT_IMP    = _BACKEND_ROOT / "data" / "feature_importance.csv"

    if not _MODEL_PATH.exists():
        return {"trained": False, "message": "Model not yet trained. Run the ML pipeline first."}

    trained_at = datetime.utcfromtimestamp(_MODEL_PATH.stat().st_mtime).isoformat() + "Z"

    metrics: Dict[str, Any] = {}
    if _EVAL_REPORT.exists():
        try:
            import re
            text = _EVAL_REPORT.read_text(encoding="utf-8")
            def _extract(pattern: str) -> Optional[str]:
                m = re.search(pattern, text)
                return m.group(1).strip() if m else None

            metrics["accuracy_pct"]   = _extract(r"Accuracy\s*:\s*([\d.]+)%")
            metrics["f1_weighted"]    = _extract(r"Weighted F1\s*:\s*([\d.]+)")
            metrics["f1_stop"]        = _extract(r"Class 1 \(stop\).*?F1=([\d.]+)")
            metrics["smote_applied"]  = "YES" in text
            n_train = _extract(r"Training samples\s*:\s*([\d,]+)")
            n_test  = _extract(r"Test samples\s*:\s*([\d,]+)")
            metrics["training_samples"] = n_train
            metrics["test_samples"]     = n_test
        except Exception:
            pass

    feat_imp: List[Dict] = []
    if _FEAT_IMP.exists():
        try:
            import csv as _csv
            with open(_FEAT_IMP, newline="", encoding="utf-8") as fh:
                for row in _csv.DictReader(fh):
                    feat_imp.append({"feature": row["feature"], "importance": float(row["importance"])})
        except Exception:
            pass

    return {
        "trained":      True,
        "trained_at":   trained_at,
        "model_path":   str(_MODEL_PATH),
        "metrics":      metrics,
        "feature_importance": feat_imp,
    }
