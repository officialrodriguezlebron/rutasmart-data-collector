"""
label_gps_logs.py
=================
STEP 2 of the RutaSmart Random Forest training pipeline.

Loads GPS logs from PostgreSQL, joins each log with its trip direction,
computes Haversine distance to the nearest ground truth stop of the same
direction, and writes a labeled feature CSV for RF training.

Label rule:
    is_stop = 1  if distance_to_nearest_stop <= 50 m
    is_stop = 0  otherwise

Class imbalance detection:
    If stop (1) class is less than 10% of total, SMOTE is recommended.
    The function returns a smote_flag that train_random_forest.py acts on.

Features written:
    latitude, longitude, hour_of_day (PHT), direction (0/1),
    distance_to_nearest_stop, nearest_stop_name, is_stop

Usage:
    DATABASE_URL=<url> python -m app.analytics.label_gps_logs

Output:
    data/labeled_gps_logs.csv
"""

import csv
import logging
import math
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Tuple

import numpy as np

from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS
from app.analytics.corridor import EARTH_RADIUS_M as _EARTH_RADIUS_M

logger = logging.getLogger(__name__)

_BACKEND_ROOT      = Path(__file__).resolve().parents[2]
_DATA_DIR          = _BACKEND_ROOT / "data"
_LABELED_CSV       = _DATA_DIR / "labeled_gps_logs.csv"
_LABEL_THRESHOLD_M = 50.0
_PHT_OFFSET        = timedelta(hours=8)
_SMOTE_THRESHOLD   = 0.10   # recommend SMOTE when stop% < 10%

FEATURE_COLS = [
    "latitude",
    "longitude",
    "hour_of_day",
    "direction",
    "distance_to_nearest_stop",
    "nearest_stop_name",
    "is_stop",
]


# ── Ground truth loading ──────────────────────────────────────────────────────

def load_ground_truth() -> Tuple[
    Tuple[np.ndarray, List[str]],
    Tuple[np.ndarray, List[str]],
]:
    """
    Build (coords_rad, names) arrays from the canonical GROUND_TRUTH_STOPS list
    in cluster_evaluation.py.  Both directions use the same 70-stop list since
    boarding/alighting occurs at the same physical locations on both corridors.
    """
    coords = np.array([(lat, lon) for _, lat, lon in GROUND_TRUTH_STOPS], dtype=float)
    names  = [name for name, _, _ in GROUND_TRUTH_STOPS]
    coords_rad = np.radians(coords)
    logger.info("Ground truth loaded: %d stops (canonical list)", len(names))
    shared = (coords_rad, names)
    return shared, shared


# ── Vectorised Haversine ──────────────────────────────────────────────────────

def _nearest_stop_info(
    lat: float,
    lon: float,
    stops_rad: np.ndarray,
    stops_names: List[str],
) -> Tuple[float, str]:
    """
    Return (distance_m, stop_name) for the nearest stop in stops_rad.
    Uses numpy vectorisation — one call computes distances to all stops.
    Returns (9999.0, '') when no stops are available.
    """
    if stops_rad.shape[0] == 0:
        return 9999.0, ""
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    dlat = stops_rad[:, 0] - lat1
    dlon = stops_rad[:, 1] - lon1
    a = (
        np.sin(dlat / 2) ** 2
        + math.cos(lat1) * np.cos(stops_rad[:, 0]) * np.sin(dlon / 2) ** 2
    )
    dists = _EARTH_RADIUS_M * 2 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))
    idx   = int(np.argmin(dists))
    return float(dists[idx]), stops_names[idx] if idx < len(stops_names) else ""


# ── Main labeling function ────────────────────────────────────────────────────

def label_logs() -> Tuple[int, int, int, bool]:
    """
    Query COMPLETED trip GPS logs from DB, compute features and labels,
    write labeled_gps_logs.csv, and check class balance.

    Returns (total_rows, n_stop, n_not_stop, smote_flag).
    smote_flag is True when stop% < 10% (SMOTE recommended).
    Raises RuntimeError on DB error, missing env var, or empty results.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Export it before running the labeler."
        )

    (fwd_rad, fwd_names), (ret_rad, ret_names) = load_ground_truth()
    if fwd_rad.shape[0] == 0:
        raise RuntimeError("GROUND_TRUTH_STOPS is empty — check cluster_evaluation.py")

    try:
        from app.database import SessionLocal
        from app.models.gps_log import GPSLog
        from app.models.trip import Trip, TripStatusEnum
    except ImportError as exc:
        raise RuntimeError(f"Cannot import DB modules: {exc}") from exc

    db = SessionLocal()
    try:
        rows = (
            db.query(
                GPSLog.latitude,
                GPSLog.longitude,
                GPSLog.timestamp,
                Trip.direction,
            )
            .join(Trip, GPSLog.trip_id == Trip.trip_id)
            .filter(Trip.status == TripStatusEnum.COMPLETED)
            .all()
        )
    except Exception as exc:
        raise RuntimeError(f"Database query failed: {exc}") from exc
    finally:
        db.close()

    if not rows:
        raise RuntimeError("No GPS logs found for COMPLETED trips.")

    direction_stops = {
        "MALANDAY-RECTO": (fwd_rad, fwd_names),
        "RECTO-MALANDAY": (ret_rad, ret_names),
    }

    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    total = n_stop = n_not_stop = 0

    try:
        with open(_LABELED_CSV, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=FEATURE_COLS)
            writer.writeheader()

            for lat, lon, ts, direction in rows:
                try:
                    lat_f    = float(lat)
                    lon_f    = float(lon)
                    pht_hour = (ts + _PHT_OFFSET).hour if isinstance(ts, datetime) else 0
                    dir_enc  = 0 if direction == "MALANDAY-RECTO" else 1

                    stops_rad, stops_names = direction_stops.get(
                        direction, (np.empty((0, 2)), [])
                    )
                    dist_m, stop_name = _nearest_stop_info(lat_f, lon_f, stops_rad, stops_names)
                    is_stop = 1 if dist_m <= _LABEL_THRESHOLD_M else 0

                    writer.writerow({
                        "latitude":                lat_f,
                        "longitude":               lon_f,
                        "hour_of_day":             pht_hour,
                        "direction":               dir_enc,
                        "distance_to_nearest_stop": round(dist_m, 4),
                        "nearest_stop_name":       stop_name,
                        "is_stop":                 is_stop,
                    })
                    total     += 1
                    n_stop    += is_stop
                    n_not_stop += 1 - is_stop

                except Exception as exc:
                    logger.debug("Skipping row due to error: %s", exc)
    except OSError as exc:
        raise RuntimeError(f"Cannot write {_LABELED_CSV}: {exc}") from exc

    stop_ratio  = n_stop / total if total else 0.0
    smote_flag  = stop_ratio < _SMOTE_THRESHOLD

    logger.info(
        "Labeled %d logs → stop=1: %d (%.1f%%)  not-stop=0: %d  smote=%s",
        total, n_stop, stop_ratio * 100, n_not_stop, smote_flag,
    )
    return total, n_stop, n_not_stop, smote_flag


# ── Standalone entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
    print("RutaSmart — GPS Log Labeler")
    try:
        total, n_stop, n_not, smote_flag = label_logs()
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    ratio = n_stop / total * 100 if total else 0.0
    print(f"\nTotal GPS logs           : {total:,}")
    print(f"Labeled stop (1)         : {n_stop:,} ({ratio:.1f}%)")
    print(f"Labeled not stop (0)     : {n_not:,} ({100 - ratio:.1f}%)")
    print(f"Class imbalance flag     : {'YES' if smote_flag else 'NO'}")
    print(f"SMOTE recommended        : {'YES' if smote_flag else 'NO'}")
    if smote_flag:
        print("  ⚠  Stop class < 10% — SMOTE will be applied during RF training.")
    print(f"Output → {_LABELED_CSV}")
