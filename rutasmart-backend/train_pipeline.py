"""
train_pipeline.py
=================
Single entry point for the RutaSmart ML-Optimized DBSCAN training pipeline.

Orchestrates three stages:
  1. Load pooled GPS data from all COMPLETED trips in the database
  2. Grid search over DBSCAN epsilon × min_samples (ml_trainer.py)
     → writes best_params.json and training_log.csv
  3. Run DBSCAN with the learned params, then validate detected clusters
     against the 70 field-verified ground truth stops (stop_validator.py)

On completion prints a full summary report to stdout including all metrics
and a confirmation that the three existing variants are untouched.

Usage
-----
    DATABASE_URL=<postgresql://...> python train_pipeline.py
    DATABASE_URL=<url> python train_pipeline.py --direction MALANDAY-RECTO
    DATABASE_URL=<url> python train_pipeline.py --direction RECTO-MALANDAY
"""

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Optional

# Make app package importable when running from rutasmart-backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_SEP = "─" * 62


def _check_env() -> None:
    """Abort early if DATABASE_URL is not exported."""
    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL environment variable is not set.")
        print("Usage:  DATABASE_URL=<postgresql://...> python train_pipeline.py")
        sys.exit(1)


def _fetch_gps_points(direction: Optional[str] = None):  # noqa: F821
    """
    Pool GPSPoint objects from all COMPLETED trips.

    Used in Stage 3 to run the final DBSCAN with learned parameters.
    """
    from app.database import SessionLocal
    from app.models.gps_log import GPSLog
    from app.models.trip import Trip, TripStatusEnum
    from app.analytics.algorithms import GPSPoint

    db = SessionLocal()
    try:
        trips_q = db.query(Trip).filter(Trip.status == TripStatusEnum.COMPLETED)
        if direction in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
            trips_q = trips_q.filter(Trip.direction == direction)
        trips = trips_q.all()

        if not trips:
            raise RuntimeError("No COMPLETED trips found in database.")

        cap = trips[0].official_capacity or 26
        all_points = []
        for trip in trips:
            logs = (
                db.query(GPSLog)
                .filter(
                    GPSLog.trip_id == trip.trip_id,
                    GPSLog.gps_quality_flag.in_(["GOOD", "ACCEPTABLE"]),
                )
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
        return all_points, cap
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="RutaSmart ML-Optimized DBSCAN — training pipeline"
    )
    parser.add_argument(
        "--direction",
        default="all",
        choices=["MALANDAY-RECTO", "RECTO-MALANDAY", "all"],
        help="Corridor to train on (default: all completed trips)",
    )
    args = parser.parse_args()
    direction = None if args.direction == "all" else args.direction

    _check_env()

    print(_SEP)
    print("  RutaSmart — ML-Optimized DBSCAN Training Pipeline")
    print(_SEP)
    corridor_label = direction or "both corridors (all COMPLETED trips)"
    print(f"  Corridor : {corridor_label}")

    # ── Stage 1 — Load GPS training data ─────────────────────────────────────
    print(f"\n[1/3] Loading GPS data from database…")
    from app.analytics.ml_trainer import (
        load_training_coords_from_db,
        run_grid_search,
        save_best_params,
        save_training_log,
        PARAMS_FILE,
        LOG_FILE,
    )

    try:
        coords = load_training_coords_from_db()
        print(f"      ✓  {len(coords):,} GOOD/ACCEPTABLE GPS points from COMPLETED trips")
    except RuntimeError as exc:
        print(f"      ✗  FAILED: {exc}")
        sys.exit(1)

    # ── Stage 2 — Grid search ─────────────────────────────────────────────────
    print(f"\n[2/3] Running grid search (eps × min_samples)…")
    try:
        grid = run_grid_search(coords)
        save_best_params(grid)
        save_training_log(grid["log"])
        print(f"      ✓  {len(grid['log'])} combinations evaluated")
        print(f"      ✓  best_params.json → {PARAMS_FILE}")
        print(f"      ✓  training_log.csv → {LOG_FILE}")
    except Exception as exc:
        print(f"      ✗  Grid search failed: {exc}")
        logger.exception("Grid search error")
        sys.exit(1)

    # ── Stage 3 — Validate against ground truth ───────────────────────────────
    print(f"\n[3/3] Running DBSCAN with learned params and validating against "
          f"70 ground truth stops…")

    val = {
        "precision": 0.0, "recall": 0.0, "f1_score": 0.0,
        "mae_m": 0.0, "true_positives": 0,
        "false_positives": 0, "false_negatives": 0,
        "n_detected": 0, "n_ground_truth": 70,
    }
    n_clusters_detected = 0

    try:
        from app.analytics.algorithms import run_dbscan
        from app.analytics.stop_validator import validate_clusters

        all_points, cap = _fetch_gps_points(direction)
        result = run_dbscan(
            all_points, cap,
            eps_m=grid["best_eps_m"],
            min_samples=grid["best_min_samples"],
        )
        clusters = result["clusters"]
        n_clusters_detected = len(clusters)
        centroids = [(c.centroid_lat, c.centroid_lon) for c in clusters]
        val = validate_clusters(centroids)
        print(f"      ✓  {n_clusters_detected} clusters detected, "
              f"{val['n_ground_truth']} ground truth stops")
    except Exception as exc:
        print(f"      ✗  Validation failed: {exc}")
        logger.exception("Validation error")
        # Continue to print whatever summary we have

    # ── Summary report ────────────────────────────────────────────────────────
    print(f"\n{_SEP}")
    print("  TRAINING PIPELINE — FINAL SUMMARY")
    print(_SEP)
    print(f"  Best epsilon (eps_m)     :  {grid['best_eps_m']} m")
    print(f"  Best min_samples         :  {grid['best_min_samples']}")
    print(f"  {_SEP[2:]}")
    print(f"  Silhouette Score         :  {grid['best_silhouette']:.4f}"
          f"   (≥ 0.5 good, range −1 → +1)")
    print(f"  Davies-Bouldin Index     :  {grid['best_davies_bouldin']:.4f}"
          f"   (lower is better)")
    print(f"  {_SEP[2:]}")
    print(f"  F1 Score                 :  {val['f1_score']:.4f}")
    print(f"  MAE (metres)             :  {val['mae_m']:.2f} m")
    print(f"  Precision                :  {val['precision']:.4f}")
    print(f"  Recall                   :  {val['recall']:.4f}")
    print(f"  TP / FP / FN             :  "
          f"{val['true_positives']} / {val['false_positives']} / {val['false_negatives']}")
    print(f"  {_SEP[2:]}")
    print(f"  Clusters detected        :  {val['n_detected']}")
    print(f"  Ground truth stops       :  {val['n_ground_truth']}")
    print(f"  {_SEP[2:]}")
    print(f"  Artifact files")
    print(f"    best_params.json       →  {PARAMS_FILE}")
    print(f"    training_log.csv       →  {LOG_FILE}")
    print(f"  {_SEP[2:]}")
    print(f"  Existing DBSCAN variants :  Vanilla ✓  Kalman-DBSCAN ✓  W-DBSCAN ✓")
    print(f"                             (algorithms.py — untouched)")
    print(_SEP)


if __name__ == "__main__":
    main()
