"""
train_pipeline.py
=================
STEP 5 — Single entry point for the RutaSmart Random Forest training pipeline.

Orchestrates three stages in order:
  1. geocode_stops.py     — geocode ground truth stops via Nominatim (~3 min)
  2. label_gps_logs.py   — auto-label GPS logs; detects class imbalance
  3. train_random_forest.py — train RF with SMOTE + class_weight='balanced'

Error handling:
  - Nominatim failures  → individual stops skipped, logged to geocode_failures.csv
  - DB connection fail  → exits with clear error message
  - Empty labeled data  → exits with clear error message
  - SMOTE import error  → falls back to class_weight='balanced' only, prints warning

Usage:
    DATABASE_URL=<postgresql://...> python -m app.analytics.train_pipeline
    DATABASE_URL=<url>              python app/analytics/train_pipeline.py
"""

import logging
import os
import sys
from pathlib import Path

# Make app importable when run as a plain script (not a module)
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_BORDER = "═" * 40


def main() -> None:
    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL environment variable is not set.")
        print("Usage: DATABASE_URL=<postgresql://...> python -m app.analytics.train_pipeline")
        sys.exit(1)

    print(_BORDER)
    print("  RutaSmart — ML Training Pipeline")
    print(_BORDER)

    # ── STEP 1: Geocode stops ─────────────────────────────────────────────────
    print("\n[1/3] Geocoding ground truth stops via Nominatim…")
    print("      (User-Agent: RutaSmart-Thesis/1.0 | ~3 min, 1 req/s)")
    try:
        from app.analytics.geocode_stops import run_geocoding, FORWARD_STOPS, RETURN_STOPS
        n_fwd, n_ret, n_fail = run_geocoding()
        print(f"\n      Forward : {n_fwd}/{len(FORWARD_STOPS)} geocoded")
        print(f"      Return  : {n_ret}/{len(RETURN_STOPS)} geocoded")
        if n_fail:
            print(f"      Failed  : {n_fail} → data/geocode_failures.csv (fill manually)")
        if n_fwd == 0 and n_ret == 0:
            print("      ✗  No stops geocoded. Check network / Nominatim availability.")
            sys.exit(1)
    except OSError as exc:
        print(f"      ✗  Could not write CSV files: {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Geocoding failed: {exc}")
        logger.exception("Geocoding error")
        sys.exit(1)

    # ── STEP 2: Label GPS logs ────────────────────────────────────────────────
    print(f"\n[2/3] Labeling GPS logs from database…")
    try:
        from app.analytics.label_gps_logs import label_logs
        total, n_stop, n_not_stop, smote_flag = label_logs()
        stop_pct = n_stop / total * 100 if total else 0.0
        print(f"      Total    : {total:,} logs")
        print(f"      Stop (1) : {n_stop:,} ({stop_pct:.1f}%)")
        print(f"      Not stop : {n_not_stop:,} ({100 - stop_pct:.1f}%)")
        if smote_flag:
            print(f"      ⚠  Stop class < 10% — SMOTE will be applied in Step 3")
        if total == 0:
            print("      ✗  Labeled dataset is empty — cannot train model.")
            sys.exit(1)
    except RuntimeError as exc:
        print(f"      ✗  {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Labeling failed: {exc}")
        logger.exception("Labeling error")
        sys.exit(1)

    # ── STEP 3: Train Random Forest ───────────────────────────────────────────
    print(f"\n[3/3] Training Random Forest classifier…")
    if smote_flag:
        print(f"      Applying SMOTE to training set (stop% < 10%)…")
    try:
        from app.analytics.train_random_forest import train_model, _MODEL_PKL, _EVAL_REPORT_TXT
        metrics = train_model()
        print(f"      Trained on {metrics['n_train']:,} samples  (test: {metrics['n_test']:,})")
        if smote_flag:
            applied_str = "YES" if metrics["smote_applied"] else "NO (imbalanced-learn not installed)"
            print(f"      SMOTE applied : {applied_str}")
    except RuntimeError as exc:
        print(f"      ✗  {exc}")
        sys.exit(1)
    except Exception as exc:
        print(f"      ✗  Training failed: {exc}")
        logger.exception("Training error")
        sys.exit(1)

    # ── Final summary ─────────────────────────────────────────────────────────
    cm = metrics["confusion_matrix"]
    print(f"\n{_BORDER}")
    print("  RUTASMART ML TRAINING COMPLETE")
    print(_BORDER)
    print(f"\nGround truth stops geocoded:")
    print(f"  Forward : {n_fwd} / {len(FORWARD_STOPS)}")
    print(f"  Return  : {n_ret} / {len(RETURN_STOPS)}")
    if n_fail:
        print(f"  Failed  : {n_fail}  (see geocode_failures.csv)")

    stop_pct = n_stop / total * 100 if total else 0.0
    print(f"\nGPS logs labeled:")
    print(f"  Total      : {total:,}")
    print(f"  Stop (1)   : {n_stop:,} ({stop_pct:.1f}%)")
    print(f"  Not stop(0): {n_not_stop:,} ({100 - stop_pct:.1f}%)")
    print(f"  SMOTE applied : {'YES' if metrics['smote_applied'] else 'NO'}")

    print(f"\nRandom Forest Results:")
    print(f"  Accuracy             : {metrics['accuracy'] * 100:.2f}%")
    print(f"  F1 Score (stop class): {metrics['f1_1']:.4f}")
    print(f"  Weighted F1          : {metrics['f1_weighted']:.4f}")
    print(f"  Confusion Matrix     : [[{cm[0][0]} {cm[0][1]}][{cm[1][0]} {cm[1][1]}]]")

    print(f"\nModel saved          : {_MODEL_PKL}")
    print(f"Feature importance   : data/feature_importance.csv")
    print(f"Evaluation report    : {_EVAL_REPORT_TXT}")
    print(f"\n{_BORDER}")


if __name__ == "__main__":
    main()
