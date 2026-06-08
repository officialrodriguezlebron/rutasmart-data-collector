"""
ml_trainer.py
=============
Grid-search trainer for the RutaSmart ML-Optimized DBSCAN variant.

Searches over DBSCAN epsilon × min_samples parameter space, scores each
combination with Silhouette Score (haversine) and Davies-Bouldin Index,
then persists the winner to best_params.json and logs every trial to
training_log.csv for reproducibility.

This module is purely additive — it never modifies the three existing
DBSCAN variants (Vanilla, Kalman-smoothed, W-DBSCAN) in algorithms.py.

Typical usage
-------------
    # Standalone (from rutasmart-backend/)
    DATABASE_URL=<url> python -m app.analytics.ml_trainer

    # Imported by train_pipeline.py
    from app.analytics.ml_trainer import load_training_coords_from_db, run_grid_search
"""

import csv
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.cluster import DBSCAN as SKLearnDBSCAN
from sklearn.metrics import davies_bouldin_score, silhouette_score

logger = logging.getLogger(__name__)

EARTH_RADIUS_M = 6_371_000

# ── Grid search space ─────────────────────────────────────────────────────────
# eps range 0.0001–0.001 degrees ≈ 11–111 metres (WGS-84, 14° N latitude)
EPS_M_GRID: List[float] = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100]
MIN_SAMPLES_GRID: List[int] = [3, 4, 5, 6, 7, 8, 9, 10]

# ── Output paths (backend root — next to train_pipeline.py) ──────────────────
_BACKEND_ROOT = Path(__file__).resolve().parents[2]   # rutasmart-backend/
PARAMS_FILE   = _BACKEND_ROOT / "best_params.json"
LOG_FILE      = _BACKEND_ROOT / "training_log.csv"


# ─────────────────────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────────────────────

def load_training_coords_from_db() -> List[Tuple[float, float]]:
    """
    Pool GOOD/ACCEPTABLE GPS coordinates from all COMPLETED trips in the DB.

    Returns
    -------
    List of (latitude, longitude) tuples.

    Raises
    ------
    RuntimeError
        If DATABASE_URL is not set, the connection fails, or no data exists.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Export it before running the trainer."
        )

    try:
        from app.database import SessionLocal
        from app.models.gps_log import GPSLog
        from app.models.trip import Trip, TripStatusEnum
    except ImportError as exc:
        raise RuntimeError(f"Cannot import DB modules: {exc}") from exc

    db = SessionLocal()
    try:
        trip_ids: List[str] = [
            row.trip_id
            for row in db.query(Trip.trip_id)
            .filter(Trip.status == TripStatusEnum.COMPLETED)
            .all()
        ]
        if not trip_ids:
            raise RuntimeError("No COMPLETED trips found in database.")

        logs = (
            db.query(GPSLog.latitude, GPSLog.longitude)
            .filter(
                GPSLog.trip_id.in_(trip_ids),
                GPSLog.gps_quality_flag.in_(["GOOD", "ACCEPTABLE"]),
            )
            .all()
        )
        if not logs:
            raise RuntimeError("No GOOD/ACCEPTABLE GPS logs found for completed trips.")

        return [(float(r.latitude), float(r.longitude)) for r in logs]
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Scoring helpers
# ─────────────────────────────────────────────────────────────────────────────

def _score_labelling(
    coords_rad: np.ndarray,
    coords_deg: np.ndarray,
    labels: np.ndarray,
) -> Tuple[float, float]:
    """
    Compute Silhouette Score (haversine) and Davies-Bouldin Index (euclidean)
    for one DBSCAN labelling.

    Returns
    -------
    (silhouette, davies_bouldin) — silhouette ∈ [-1, 1] (higher better);
    davies_bouldin ≥ 0 (lower better).
    Returns (-1.0, 99.0) for degenerate results (< 2 clusters or < 2 points).
    """
    non_noise = labels != -1
    unique    = set(labels[non_noise])

    if len(unique) < 2 or non_noise.sum() < 2:
        return -1.0, 99.0

    X_rad = coords_rad[non_noise]
    X_deg = coords_deg[non_noise]
    y     = labels[non_noise]

    try:
        sil = float(
            silhouette_score(
                X_rad, y,
                metric="haversine",
                sample_size=min(5_000, int(non_noise.sum())),
                random_state=42,
            )
        )
    except Exception as exc:
        logger.debug("silhouette_score failed: %s", exc)
        sil = -1.0

    try:
        # Davies-Bouldin uses Euclidean; acceptable for a small geographic area
        db_idx = float(davies_bouldin_score(X_deg, y))
    except Exception as exc:
        logger.debug("davies_bouldin_score failed: %s", exc)
        db_idx = 99.0

    return sil, db_idx


# ─────────────────────────────────────────────────────────────────────────────
# Grid search
# ─────────────────────────────────────────────────────────────────────────────

def run_grid_search(
    coords: List[Tuple[float, float]],
    eps_grid: Optional[List[float]] = None,
    min_samples_grid: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Grid search over DBSCAN epsilon × min_samples combinations.

    The composite score used for ranking is:
        composite = silhouette − 0.3 × min(davies_bouldin, 10.0)
    which rewards tight cluster cohesion (silhouette) while penalising
    poor inter-cluster separation (davies_bouldin).

    Parameters
    ----------
    coords            : (lat, lon) coordinate list from load_training_coords_from_db()
    eps_grid          : eps values in metres; defaults to EPS_M_GRID
    min_samples_grid  : min_samples values; defaults to MIN_SAMPLES_GRID

    Returns
    -------
    Dict containing best_eps_m, best_min_samples, best_silhouette,
    best_davies_bouldin, best_composite, and log (list of all trial dicts).

    Raises
    ------
    ValueError : if coords is empty
    """
    if not coords:
        raise ValueError("coords list is empty — nothing to train on.")

    eps_grid         = eps_grid         or EPS_M_GRID
    min_samples_grid = min_samples_grid or MIN_SAMPLES_GRID

    coords_arr = np.array(coords, dtype=float)
    coords_rad = np.radians(coords_arr)

    log: List[Dict[str, Any]] = []
    best_composite = -float("inf")
    best: Dict[str, Any] = {
        "best_eps_m":            eps_grid[0],
        "best_min_samples":      min_samples_grid[0],
        "best_silhouette":       -1.0,
        "best_davies_bouldin":   99.0,
        "best_composite":        -float("inf"),
    }

    total = len(eps_grid) * len(min_samples_grid)
    logger.info("Starting grid search: %d combinations", total)

    for trial, (eps_m, min_s) in enumerate(
        (e, m) for e in eps_grid for m in min_samples_grid
    ):
        logger.info("[%d/%d] eps_m=%.0f  min_samples=%d", trial + 1, total, eps_m, min_s)

        try:
            eps_rad = eps_m / EARTH_RADIUS_M
            db_clf  = SKLearnDBSCAN(
                eps=eps_rad,
                min_samples=min_s,
                metric="haversine",
                algorithm="ball_tree",
                n_jobs=-1,
            )
            labels = db_clf.fit_predict(coords_rad)
        except Exception as exc:
            logger.warning("DBSCAN failed eps_m=%s min_s=%s: %s", eps_m, min_s, exc)
            log.append({
                "eps_m": eps_m, "eps_deg": round(eps_m / 111_320, 6),
                "min_samples": min_s, "n_clusters": 0,
                "n_noise": len(coords), "noise_ratio": 1.0,
                "silhouette": -1.0, "davies_bouldin": 99.0,
                "composite": -float("inf"), "error": str(exc),
            })
            continue

        unique      = set(labels) - {-1}
        n_clusters  = len(unique)
        n_noise     = int(np.sum(labels == -1))
        noise_ratio = round(n_noise / len(labels), 4)

        sil, db_idx = _score_labelling(coords_rad, coords_arr, labels)
        composite   = sil - 0.3 * min(db_idx, 10.0)

        entry: Dict[str, Any] = {
            "eps_m":          eps_m,
            "eps_deg":        round(eps_m / 111_320, 6),
            "min_samples":    min_s,
            "n_clusters":     n_clusters,
            "n_noise":        n_noise,
            "noise_ratio":    noise_ratio,
            "silhouette":     round(sil, 4),
            "davies_bouldin": round(db_idx, 4),
            "composite":      round(composite, 4),
        }
        log.append(entry)

        if composite > best_composite:
            best_composite = composite
            best = {
                "best_eps_m":          eps_m,
                "best_min_samples":    min_s,
                "best_silhouette":     round(sil, 4),
                "best_davies_bouldin": round(db_idx, 4),
                "best_composite":      round(composite, 4),
            }

    logger.info(
        "Grid search complete. Best: eps_m=%.0f  min_samples=%d  "
        "silhouette=%.4f  davies_bouldin=%.4f",
        best["best_eps_m"], best["best_min_samples"],
        best["best_silhouette"], best["best_davies_bouldin"],
    )

    best["log"] = log
    return best


# ─────────────────────────────────────────────────────────────────────────────
# Persistence helpers
# ─────────────────────────────────────────────────────────────────────────────

def save_best_params(best: Dict[str, Any]) -> None:
    """
    Persist best epsilon and min_samples to best_params.json.

    Raises OSError if the file cannot be written.
    """
    payload = {
        "eps_m":                best["best_eps_m"],
        "min_samples":          best["best_min_samples"],
        "silhouette_score":     best.get("best_silhouette", -1.0),
        "davies_bouldin_index": best.get("best_davies_bouldin", 99.0),
        "composite_score":      best.get("best_composite", -float("inf")),
        "trained_on":           "pooled_completed_trips",
    }
    try:
        PARAMS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PARAMS_FILE, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        logger.info("Saved best_params.json → %s", PARAMS_FILE)
    except OSError as exc:
        logger.error("Failed to write best_params.json: %s", exc)
        raise


def save_training_log(log: List[Dict[str, Any]]) -> None:
    """
    Write every grid-search trial to training_log.csv for offline review.

    Raises OSError if the file cannot be written.
    """
    if not log:
        return
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        fieldnames = list(log[0].keys())
        with open(LOG_FILE, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(log)
        logger.info("Saved training_log.csv → %s  (%d rows)", LOG_FILE, len(log))
    except OSError as exc:
        logger.error("Failed to write training_log.csv: %s", exc)
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
    )

    print("RutaSmart ML Trainer — loading GPS data from DB…")
    try:
        gps_coords = load_training_coords_from_db()
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    print(f"Loaded {len(gps_coords):,} GPS points. Running grid search…")
    grid_result = run_grid_search(gps_coords)
    save_best_params(grid_result)
    save_training_log(grid_result["log"])

    print(
        f"\nBest  eps_m={grid_result['best_eps_m']}  "
        f"min_samples={grid_result['best_min_samples']}"
    )
    print(f"  Silhouette:      {grid_result['best_silhouette']}")
    print(f"  Davies-Bouldin:  {grid_result['best_davies_bouldin']}")
    print(f"  Composite:       {grid_result['best_composite']}")
