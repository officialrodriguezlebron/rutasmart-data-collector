"""
train_random_forest.py
======================
STEP 3 of the RutaSmart Random Forest training pipeline.

Loads labeled_gps_logs.csv, trains a RandomForestClassifier to predict
whether a GPS point is at a known stop (is_stop=1) or not (is_stop=0),
evaluates on a held-out 20% test split, and persists artefacts.

Features: latitude, longitude, hour_of_day, direction, distance_to_nearest_stop
Target:   is_stop (0 / 1)

Outputs:
    models/rf_model.pkl         serialised classifier (joblib)
    data/feature_importance.csv feature ranking

Usage:
    python -m app.analytics.train_random_forest
"""

import csv
import logging
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR     = _BACKEND_ROOT / "data"
_MODELS_DIR   = _BACKEND_ROOT / "models"
_LABELED_CSV  = _DATA_DIR    / "labeled_gps_logs.csv"
_MODEL_PKL    = _MODELS_DIR  / "rf_model.pkl"
_FEAT_IMP_CSV = _DATA_DIR    / "feature_importance.csv"

FEATURE_COLS = [
    "latitude",
    "longitude",
    "hour_of_day",
    "direction",
    "distance_to_nearest_stop",
]
TARGET_COL = "is_stop"


def train_model() -> Dict:
    """
    Load labeled data, train Random Forest, evaluate on the test split,
    and persist model + feature importance files.

    Returns a dict with keys:
        accuracy, precision, recall, f1, confusion_matrix, report,
        feat_imp, n_train, n_test, n_stop, n_not_stop

    Raises RuntimeError on missing/empty data or file-write failure.
    """
    if not _LABELED_CSV.exists():
        raise RuntimeError(
            f"Labeled dataset not found: {_LABELED_CSV}\n"
            "Run label_gps_logs.py first."
        )

    try:
        df = pd.read_csv(_LABELED_CSV)
    except Exception as exc:
        raise RuntimeError(f"Cannot read {_LABELED_CSV}: {exc}") from exc

    if df.empty:
        raise RuntimeError("labeled_gps_logs.csv is empty — nothing to train on.")

    missing = [c for c in FEATURE_COLS + [TARGET_COL] if c not in df.columns]
    if missing:
        raise RuntimeError(f"Labeled CSV is missing columns: {missing}")

    df = df.dropna(subset=FEATURE_COLS + [TARGET_COL])
    if df.empty:
        raise RuntimeError("No rows remain after dropping NaN values.")

    X = df[FEATURE_COLS].values.astype(float)
    y = df[TARGET_COL].values.astype(int)

    n_pos = int(y.sum())
    n_neg = int(len(y) - n_pos)

    if n_pos == 0:
        raise RuntimeError(
            "All labels are 0 — no stop samples found. "
            "Check that ground_truth_stops_*.csv files are populated."
        )
    if n_neg == 0:
        raise RuntimeError("All labels are 1 — labeling step produced invalid output.")

    logger.info("Dataset: %d rows  stop=1: %d  not-stop=0: %d", len(y), n_pos, n_neg)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.2,
        stratify=y,
        random_state=42,
    )

    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    clf.fit(X_train, y_train)
    logger.info("Trained RandomForestClassifier on %d samples", len(X_train))

    y_pred    = clf.predict(X_test)
    accuracy  = float(accuracy_score(y_test, y_pred))
    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall    = float(recall_score(y_test, y_pred, zero_division=0))
    f1        = float(f1_score(y_test, y_pred, zero_division=0))
    cm        = confusion_matrix(y_test, y_pred).tolist()
    report    = classification_report(y_test, y_pred, target_names=["not-stop", "stop"])

    feat_imp: List[Tuple[str, float]] = sorted(
        zip(FEATURE_COLS, clf.feature_importances_.tolist()),
        key=lambda x: x[1],
        reverse=True,
    )

    # ── Persist model ─────────────────────────────────────────────────────────
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        joblib.dump(clf, _MODEL_PKL)
        logger.info("Model saved → %s", _MODEL_PKL)
    except OSError as exc:
        raise RuntimeError(f"Cannot save model to {_MODEL_PKL}: {exc}") from exc

    # ── Persist feature importance ────────────────────────────────────────────
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(_FEAT_IMP_CSV, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=["feature", "importance"])
            writer.writeheader()
            for feat, imp in feat_imp:
                writer.writerow({"feature": feat, "importance": round(imp, 6)})
        logger.info("Feature importance saved → %s", _FEAT_IMP_CSV)
    except OSError as exc:
        logger.warning("Could not save feature importance: %s", exc)

    return {
        "accuracy":         accuracy,
        "precision":        precision,
        "recall":           recall,
        "f1":               f1,
        "confusion_matrix": cm,
        "report":           report,
        "feat_imp":         feat_imp,
        "n_train":          len(X_train),
        "n_test":           len(X_test),
        "n_stop":           n_pos,
        "n_not_stop":       n_neg,
    }


# ── Standalone entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
    print("RutaSmart — Random Forest Trainer")
    try:
        m = train_model()
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    print(f"\nTraining samples : {m['n_train']:,}  |  Test samples : {m['n_test']:,}")
    print(f"Accuracy         : {m['accuracy']:.4f}")
    print(f"Precision        : {m['precision']:.4f}")
    print(f"Recall           : {m['recall']:.4f}")
    print(f"F1 Score         : {m['f1']:.4f}")
    print(f"\nConfusion Matrix :\n  {m['confusion_matrix']}")
    print(f"\nClassification Report:\n{m['report']}")
    print("\nFeature Importance:")
    for feat, imp in m["feat_imp"]:
        bar = "█" * max(1, int(imp * 40))
        print(f"  {feat:<35} {imp:.4f}  {bar}")
    print(f"\nModel saved         → {_MODEL_PKL}")
    print(f"Feature importance  → {_FEAT_IMP_CSV}")
