"""
train_pipeline.py
=================
STEP 5 — Single entry point for the RutaSmart Random Forest training pipeline.

Orchestrates three stages in order:
  1. geocode_stops.py     — geocode ground truth stops via Nominatim
  2. label_gps_logs.py   — auto-label GPS logs with Haversine proximity
  3. train_random_forest.py — train and save RandomForestClassifier

Error handling:
  - Nominatim failures: individual stops are skipped and logged to geocode_failures.csv
  - DB connection failure: exits with clear error message
  - Empty labeled dataset: exits with clear error message

Usage:
    DATABASE_URL=<postgresql://...> python -m app.analytics.train_pipeline
    DATABASE_URL=<url> python app/analytics/train_pipeline.py
"""

import logging
import os
import sys
from pathlib import Path

# Make app importable when run as a plain script (not module)
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_SEP = "─" * 62


def main() -> None:
    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL environment variable is not set.")
        print("Usage: DATABASE_URL=<postgresql://...> python -m app.analytics.train_pipeline")
        sys.exit(1)

    print(_SEP)
    print("  RutaSmart — Random Forest Training Pipeline")
    print(_SEP)

    # ── STEP 1: Geocode stops ─────────────────────────────────────────────────
    print("\n[1/3] Geocoding ground truth stops via Nominatim…")
    print("      (this takes ~3 minutes — 1 request/second policy)")
    try:
        from app.analytics.geocode_stops import run_geocoding, FORWARD_STOPS, RETURN_STOPS
        n_fwd, n_ret, n_fail = run_geocoding()
        print(f"\n      ✓  Forward: {n_fwd}/{len(FORWARD_STOPS)} stops geocoded")
        print(f"      ✓  Return : {n_ret}/{len(RETURN_STOPS)} stops geocoded")
        if n_fail:
            print(f"      ⚠  {n_fail} failures → data/geocode_failures.csv (fill manually)")
        if n_fwd == 0 and n_ret == 0:
            print("      ✗  No stops geocoded. Check network / Nominatim availability.")
            print("         You can manually populate data/ground_truth_stops_*.csv and re-run.")
            sys.exit(1)
    except OSError as exc:
        print(f"      ✗  Could not write CSV files: {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Geocoding failed unexpectedly: {exc}")
        logger.exception("Geocoding error")
        sys.exit(1)

    # ── STEP 2: Label GPS logs ────────────────────────────────────────────────
    print(f"\n[2/3] Labeling GPS logs from database…")
    try:
        from app.analytics.label_gps_logs import label_logs
        total, n_stop, n_not_stop = label_logs()
        ratio_pct = n_stop / total * 100 if total else 0.0
        print(f"      ✓  {total:,} logs labeled  "
              f"(stop=1: {n_stop:,}  not-stop=0: {n_not_stop:,}  stop%: {ratio_pct:.1f}%)")
        if total == 0:
            print("      ✗  Labeled dataset is empty — cannot train model.")
            sys.exit(1)
    except RuntimeError as exc:
        print(f"      ✗  {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Labeling failed unexpectedly: {exc}")
        logger.exception("Labeling error")
        sys.exit(1)

    # ── STEP 3: Train Random Forest ───────────────────────────────────────────
    print(f"\n[3/3] Training Random Forest classifier…")
    try:
        from app.analytics.train_random_forest import train_model, _MODEL_PKL
        metrics = train_model()
        print(f"      ✓  Trained on {metrics['n_train']:,} samples  "
              f"(test set: {metrics['n_test']:,})")
    except RuntimeError as exc:
        print(f"      ✗  {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Training failed unexpectedly: {exc}")
        logger.exception("Training error")
        sys.exit(1)

    # ── Final summary ─────────────────────────────────────────────────────────
    print(f"\n{_SEP}")
    print("  TRAINING PIPELINE — FINAL SUMMARY")
    print(_SEP)
    print(f"  Ground truth stops geocoded  :  {n_fwd} forward / {n_ret} return")
    print(f"  GPS logs labeled             :  {total:,} total "
          f"({n_stop:,} stops / {n_not_stop:,} non-stops)")
    print(f"  {_SEP[2:]}")
    print(f"  Random Forest Accuracy       :  {metrics['accuracy']:.4f}")
    print(f"  Precision                    :  {metrics['precision']:.4f}")
    print(f"  Recall                       :  {metrics['recall']:.4f}")
    print(f"  F1 Score                     :  {metrics['f1']:.4f}")
    print(f"  {_SEP[2:]}")
    print(f"  Model saved to               :  {_MODEL_PKL}")
    print(f"  {_SEP[2:]}")
    print(f"  Existing Vanilla DBSCAN      :  ✓ untouched (algorithms.py)")
    print(_SEP)


if __name__ == "__main__":
    main()
