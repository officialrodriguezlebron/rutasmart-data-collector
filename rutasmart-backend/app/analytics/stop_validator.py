"""
stop_validator.py
=================
Ground truth validation for RutaSmart DBSCAN cluster output.

Matches detected stop clusters against the 70 field-verified stops on the
Malanday–Recto corridor using Haversine distance (no external libraries).
Applies a 50-metre matching threshold to classify clusters as:

  True Positive  (TP) — cluster centroid within 50 m of a ground truth stop
  False Positive (FP) — cluster with no nearby ground truth stop
  False Negative (FN) — ground truth stop with no nearby cluster

Computes:
  Precision = TP / (TP + FP)
  Recall    = TP / (TP + FN)
  F1        = 2 × Precision × Recall / (Precision + Recall)
  MAE       = mean Haversine offset from each detected centroid to its
              nearest ground truth stop, in metres

Typical usage
-------------
    from app.analytics.stop_validator import validate_clusters
    metrics = validate_clusters([(lat1, lon1), (lat2, lon2), ...])

    # Standalone smoke-test
    python -m app.analytics.stop_validator
"""

import math
from typing import Any, Dict, List, Optional, Tuple

EARTH_RADIUS_M    = 6_371_000
MATCH_THRESHOLD_M = 50.0   # metres — centroid must be within this to count as TP

# Import ground truth from the existing evaluation module (read-only — not modified)
try:
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS
except ImportError:
    # Allows the module to be imported in environments where the full app
    # package is unavailable; caller must supply ground_truth explicitly.
    GROUND_TRUTH_STOPS: List[Tuple[str, float, float]] = []


# ─────────────────────────────────────────────────────────────────────────────
# Haversine — no external library dependency
# ─────────────────────────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Great-circle distance in metres between two WGS-84 coordinates.

    Uses the same formula as haversine_distance() in algorithms.py —
    reproduced here so stop_validator.py has zero internal imports
    and can be run standalone.
    """
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return EARTH_RADIUS_M * 2 * math.asin(math.sqrt(a))


def _nearest_stop(
    clat: float,
    clon: float,
    ground_truth: List[Tuple[str, float, float]],
) -> Tuple[str, float, float, float]:
    """
    Find the ground truth stop closest to (clat, clon).

    Returns (stop_name, gt_lat, gt_lon, distance_m).
    """
    best_name = best_lat = best_lon = ""
    best_dist = float("inf")
    for name, gt_lat, gt_lon in ground_truth:
        d = _haversine_m(clat, clon, gt_lat, gt_lon)
        if d < best_dist:
            best_name, best_lat, best_lon, best_dist = name, gt_lat, gt_lon, d
    return best_name, best_lat, best_lon, best_dist   # type: ignore[return-value]


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def validate_clusters(
    centroids: List[Tuple[float, float]],
    ground_truth: Optional[List[Tuple[str, float, float]]] = None,
    threshold_m: float = MATCH_THRESHOLD_M,
) -> Dict[str, Any]:
    """
    Validate detected cluster centroids against ground truth stops.

    Each cluster is matched to its nearest ground truth stop via Haversine.
    A cluster is a True Positive only if the offset ≤ threshold_m AND
    the ground truth stop has not already been claimed by a closer cluster.
    Unclaimed ground truth stops become False Negatives.

    Parameters
    ----------
    centroids    : [(lat, lon), …] for every detected cluster centroid
    ground_truth : [(name, lat, lon), …] — defaults to GROUND_TRUTH_STOPS
    threshold_m  : match radius in metres (default 50 m)

    Returns
    -------
    Dict with keys:
        precision, recall, f1_score, mae_m,
        true_positives, false_positives, false_negatives,
        n_detected, n_ground_truth,
        matches  — per-cluster detail list
    """
    gt = ground_truth if ground_truth is not None else GROUND_TRUTH_STOPS

    empty_base = {
        "threshold_m":     threshold_m,
        "n_detected":      len(centroids),
        "n_ground_truth":  len(gt),
        "matches":         [],
    }

    if not centroids:
        return {**empty_base,
                "precision": 0.0, "recall": 0.0, "f1_score": 0.0,
                "mae_m": 0.0, "true_positives": 0,
                "false_positives": 0, "false_negatives": len(gt)}

    if not gt:
        return {**empty_base,
                "precision": 0.0, "recall": 0.0, "f1_score": 0.0,
                "mae_m": 0.0, "true_positives": 0,
                "false_positives": len(centroids), "false_negatives": 0}

    # Build match list and track which GT stops are claimed
    matches: List[Dict[str, Any]] = []
    claimed_gt: Dict[int, float] = {}   # gt_index → best offset that claimed it
    offsets: List[float] = []

    for i, (clat, clon) in enumerate(centroids):
        name, gt_lat, gt_lon, dist_m = _nearest_stop(clat, clon, gt)

        # Resolve the GT index for this match
        gt_idx = next(
            (j for j, (n, la, lo) in enumerate(gt)
             if n == name and abs(la - gt_lat) < 1e-9 and abs(lo - gt_lon) < 1e-9),
            -1,
        )

        is_match = (dist_m <= threshold_m)

        # Only claim the GT stop if this cluster is the closest one so far
        if is_match and gt_idx >= 0:
            prev_dist = claimed_gt.get(gt_idx, float("inf"))
            if dist_m < prev_dist:
                claimed_gt[gt_idx] = dist_m

        offsets.append(dist_m)
        matches.append({
            "cluster_index":     i,
            "centroid_lat":      clat,
            "centroid_lon":      clon,
            "nearest_stop":      name,
            "nearest_stop_lat":  gt_lat,
            "nearest_stop_lon":  gt_lon,
            "offset_m":          round(dist_m, 2),
            "matched":           is_match,
        })

    tp = len(claimed_gt)
    fp = len(centroids) - tp
    fn = len(gt) - tp

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1        = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0 else 0.0
    )
    mae_m = sum(offsets) / len(offsets) if offsets else 0.0

    return {
        "precision":       round(precision, 4),
        "recall":          round(recall,    4),
        "f1_score":        round(f1,        4),
        "mae_m":           round(mae_m,     2),
        "true_positives":  tp,
        "false_positives": fp,
        "false_negatives": fn,
        "n_detected":      len(centroids),
        "n_ground_truth":  len(gt),
        "threshold_m":     threshold_m,
        "matches":         matches,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Standalone smoke-test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Two centroids: one near Monumento (should match), one near Malanday Terminal
    test_centroids = [
        (14.6564, 120.984),   # Monumento
        (14.718,  120.957),   # Malanday Terminal
        (14.99,   121.50),    # Far from any stop → FP
    ]
    result = validate_clusters(test_centroids)
    print(f"Detected : {result['n_detected']}  GT stops : {result['n_ground_truth']}")
    print(f"TP={result['true_positives']}  FP={result['false_positives']}  FN={result['false_negatives']}")
    print(f"Precision={result['precision']:.4f}  Recall={result['recall']:.4f}  F1={result['f1_score']:.4f}")
    print(f"MAE      ={result['mae_m']:.2f} m")
    for m in result["matches"]:
        status = "✓" if m["matched"] else "✗"
        print(f"  {status}  cluster[{m['cluster_index']}] → {m['nearest_stop']}  ({m['offset_m']} m)")
