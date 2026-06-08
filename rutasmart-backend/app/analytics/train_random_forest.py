"""
train_random_forest.py
======================
STEP 3 of the RutaSmart Random Forest training pipeline.

Loads labeled_gps_logs.csv, trains a RandomForestClassifier with class imbalance
handling, evaluates per-class metrics, and persists artefacts.

Class imbalance strategy:
  - Always use class_weight='balanced' (weights inversely proportional to class freq)
  - If stop (1) class < 10% of training set → apply SMOTE to training set only
    (imbalanced-learn); falls back gracefully if library is not installed
  - Stratified 80/20 train/test split preserves the natural class ratio in both sets

Features: latitude, longitude, hour_of_day, direction, distance_to_nearest_stop
Target:   is_stop (0 / 1)

Outputs:
    models/rf_model.pkl         serialised classifier (joblib)
    data/feature_importance.csv feature ranking
    data/evaluation_report.txt  full per-class evaluation report

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

_BACKEND_ROOT    = Path(__file__).resolve().parents[2]
_DATA_DIR        = _BACKEND_ROOT / "data"
_MODELS_DIR      = _BACKEND_ROOT / "models"
_LABELED_CSV     = _DATA_DIR    / "labeled_gps_logs.csv"
_MODEL_PKL       = _MODELS_DIR  / "rf_model.pkl"
_FEAT_IMP_CSV    = _DATA_DIR    / "feature_importance.csv"
_EVAL_REPORT_TXT = _DATA_DIR    / "evaluation_report.txt"

FEATURE_COLS = [
    "latitude",
    "longitude",
    "hour_of_day",
    "direction",
    "distance_to_nearest_stop",
]
TARGET_COL       = "is_stop"
_SMOTE_THRESHOLD = 0.10   # apply SMOTE when stop% < 10%


def _try_smote(
    X_train: np.ndarray,
    y_train: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, bool]:
    """
    Attempt SMOTE oversampling on the training set.

    Returns (X_resampled, y_resampled, smote_applied).
    Falls back to (X_train, y_train, False) if imbalanced-learn is not installed.
    SMOTE is NEVER applied to the test set.
    """
    try:
        from imblearn.over_sampling import SMOTE
        smote = SMOTE(random_state=42)
        X_res, y_res = smote.fit_resample(X_train, y_train)
        logger.info(
            "SMOTE applied: %d → %d training samples",
            len(X_train), len(X_res),
        )
        return X_res, y_res, True
    except ImportError:
        logger.warning(
            "imbalanced-learn not installed — SMOTE skipped; "
            "using class_weight='balanced' only."
        )
        print(
            "WARNING: imbalanced-learn not installed. SMOTE skipped.\n"
            "         Install with: pip install imbalanced-learn\n"
            "         Falling back to class_weight='balanced' only."
        )
        return X_train, y_train, False
    except Exception as exc:
        logger.warning("SMOTE failed (%s) — falling back to class_weight only.", exc)
        return X_train, y_train, False


def train_model() -> Dict:
    """
    Load labeled data, train Random Forest with imbalance handling,
    evaluate per-class metrics, and persist all artefacts.

    Returns a metrics dict with keys:
        accuracy, precision_0, recall_0, f1_0,
        precision_1, recall_1, f1_1,
        f1_weighted, confusion_matrix, report,
        feat_imp, n_train, n_test, n_stop, n_not_stop,
        smote_applied, smote_flag

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
            "Check that ground_truth_stops_*.csv files are populated and correct."
        )
    if n_neg == 0:
        raise RuntimeError("All labels are 1 — labeling step produced invalid output.")

    stop_ratio = n_pos / len(y)
    smote_flag = stop_ratio < _SMOTE_THRESHOLD
    logger.info(
        "Dataset: %d rows  stop=1: %d (%.1f%%)  not-stop=0: %d  smote_flag=%s",
        len(y), n_pos, stop_ratio * 100, n_neg, smote_flag,
    )

    # ── Stratified 80/20 split ────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.2,
        stratify=y,
        random_state=42,
    )

    # ── SMOTE (training set only) ─────────────────────────────────────────────
    smote_applied = False
    if smote_flag:
        X_train, y_train, smote_applied = _try_smote(X_train, y_train)

    # ── Train ─────────────────────────────────────────────────────────────────
    clf = RandomForestClassifier(
        n_estimators=100,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)
    logger.info("RandomForestClassifier trained on %d samples", len(X_train))

    # ── Evaluate on untouched test set ────────────────────────────────────────
    y_pred = clf.predict(X_test)

    accuracy   = float(accuracy_score(y_test, y_pred))
    prec_0     = float(precision_score(y_test, y_pred, pos_label=0, zero_division=0))
    rec_0      = float(recall_score(y_test, y_pred,    pos_label=0, zero_division=0))
    f1_0       = float(f1_score(y_test, y_pred,        pos_label=0, zero_division=0))
    prec_1     = float(precision_score(y_test, y_pred, pos_label=1, zero_division=0))
    rec_1      = float(recall_score(y_test, y_pred,    pos_label=1, zero_division=0))
    f1_1       = float(f1_score(y_test, y_pred,        pos_label=1, zero_division=0))
    f1_wtd     = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
    cm         = confusion_matrix(y_test, y_pred).tolist()
    report_str = classification_report(
        y_test, y_pred,
        target_names=["not-stop (0)", "stop (1)"],
    )

    feat_imp: List[Tuple[str, float]] = sorted(
        zip(FEATURE_COLS, clf.feature_importances_.tolist()),
        key=lambda x: x[1],
        reverse=True,
    )

    # ── Console output ────────────────────────────────────────────────────────
    print("\n=== RANDOM FOREST EVALUATION ===")
    print(f"Accuracy : {accuracy * 100:.2f}%")
    print(f"\nClass 0 (not stop) : P={prec_0:.4f}  R={rec_0:.4f}  F1={f1_0:.4f}")
    print(f"Class 1 (stop)     : P={prec_1:.4f}  R={rec_1:.4f}  F1={f1_1:.4f}")
    print(f"Weighted F1        : {f1_wtd:.4f}")
    print(f"\nConfusion Matrix:")
    print(f"  [[TN={cm[0][0]:>6}  FP={cm[0][1]:>6}]")
    print(f"   [FN={cm[1][0]:>6}  TP={cm[1][1]:>6}]]")
    print("\nFeature Importance:")
    for rank, (feat, imp) in enumerate(feat_imp, 1):
        bar = "█" * max(1, int(imp * 40))
        print(f"  {rank}. {feat:<35} {imp:.4f}  {bar}")

    # ── Build evaluation report text ──────────────────────────────────────────
    eval_text_lines = [
        "=== RUTASMART RANDOM FOREST EVALUATION REPORT ===",
        f"Training samples : {len(X_train):,}",
        f"Test samples     : {len(X_test):,}",
        f"SMOTE applied    : {'YES' if smote_applied else 'NO'}",
        f"class_weight     : balanced",
        "",
        f"Accuracy         : {accuracy * 100:.2f}%",
        "",
        "Per-class metrics:",
        f"  Class 0 (not stop) : Precision={prec_0:.4f}  Recall={rec_0:.4f}  F1={f1_0:.4f}",
        f"  Class 1 (stop)     : Precision={prec_1:.4f}  Recall={rec_1:.4f}  F1={f1_1:.4f}",
        f"  Weighted F1        : {f1_wtd:.4f}",
        "",
        "Confusion Matrix (rows=actual, cols=predicted):",
        f"  [[TN={cm[0][0]}  FP={cm[0][1]}]",
        f"   [FN={cm[1][0]}  TP={cm[1][1]}]]",
        "",
        "Full Classification Report:",
        report_str,
        "",
        "Feature Importance:",
    ]
    for rank, (feat, imp) in enumerate(feat_imp, 1):
        eval_text_lines.append(f"  {rank}. {feat}: {imp:.6f}")

    eval_text = "\n".join(eval_text_lines)

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

    # ── Persist evaluation report ─────────────────────────────────────────────
    try:
        with open(_EVAL_REPORT_TXT, "w", encoding="utf-8") as fh:
            fh.write(eval_text)
        logger.info("Evaluation report saved → %s", _EVAL_REPORT_TXT)
    except OSError as exc:
        logger.warning("Could not save evaluation report: %s", exc)

    return {
        "accuracy":         accuracy,
        "precision_0":      prec_0,
        "recall_0":         rec_0,
        "f1_0":             f1_0,
        "precision_1":      prec_1,
        "recall_1":         rec_1,
        "f1_1":             f1_1,
        "f1_weighted":      f1_wtd,
        "confusion_matrix": cm,
        "report":           report_str,
        "feat_imp":         feat_imp,
        "n_train":          len(X_train),
        "n_test":           len(X_test),
        "n_stop":           n_pos,
        "n_not_stop":       n_neg,
        "smote_applied":    smote_applied,
        "smote_flag":       smote_flag,
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

    print(f"\nModel saved         → {_MODEL_PKL}")
    print(f"Feature importance  → {_FEAT_IMP_CSV}")
    print(f"Evaluation report   → {_EVAL_REPORT_TXT}")
