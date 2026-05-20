"""
RutaSmart Cluster Evaluation Module
=====================================
Implements the ML evaluation metrics required by the professor's revision:

  1. Silhouette Coefficient   — measures intra-cluster cohesion vs
                                 inter-cluster separation (-1 to +1, higher = better)
  2. Davies-Bouldin Index     — ratio of within-cluster scatter to
                                 between-cluster separation (lower = better)
  3. Ground Truth Comparison  — matches detected clusters against the 70
                                 field-verified stops along the
                                 Malanday-Recto corridor using MAE on centroid offset
  4. Detection Confusion Matrix — TP/FP/FN counts at configurable match
                                  threshold (default 100m)

Why these metrics for DBSCAN on GPS data
-----------------------------------------
Silhouette and Davies-Bouldin are standard unsupervised clustering metrics
used when no ground truth exists (e.g., exploratory field data). The ground
truth comparison (MAE + confusion matrix) is used when a reference set is
available — in our case, the 70 field-verified stops along the Malanday-Recto
corridor, cross-referenced with LTFRB franchise documents. Together they
answer two distinct questions:

  • Are the clusters internally valid? (Silhouette / Davies-Bouldin)
  • Do the clusters correspond to real stops? (MAE / confusion matrix)

References
----------
Rousseeuw, P.J. (1987). Silhouettes: a graphical aid to the interpretation
  and validation of cluster analysis. J. Computational & Applied Mathematics.
Davies, D.L. & Bouldin, D.W. (1979). A cluster separation measure.
  IEEE Transactions on Pattern Analysis and Machine Intelligence.
"""

import math
import numpy as np
from dataclasses import dataclass, field
from typing import List, Tuple, Optional


EARTH_RADIUS_M = 6_371_000

# ── 70 field-verified stops along Malanday-Recto ──────────────────────────────
# Source: Field-verified stop coordinates cross-referenced with official LTFRB
# franchise route documents for the Malanday–Recto corridor (70 stops)
GROUND_TRUTH_STOPS: List[Tuple[str, float, float]] = [
    ("MacArthur / Woodlands Drive",          14.7187, 120.957),
    ("MacArthur / Del Pilar, Malanday",      14.7183, 120.957),
    ("Malanday Terminal",                    14.718,  120.957),
    ("Mercury Drug Malanday",                14.7173, 120.957),
    ("Marisyl School",                       14.7155, 120.958),
    ("MacArthur Hwy, Dalandanan",            14.7122, 120.959),
    ("MacArthur / Santiago Road",            14.7093, 120.96),
    ("Ign Pharmacy",                         14.7085, 120.96),
    ("Dalandanan Fire Sub-Station",          14.7041, 120.961),
    ("Dalandanan Health Centre",             14.7036, 120.962),
    ("Santos Encarnacion Elem",              14.7022, 120.962),
    ("Iglesia ni Cristo",                    14.7013, 120.962),
    ("Galdrine Industrial Corp",             14.6988, 120.963),
    ("MacArthur / San Miguel",               14.697,  120.964),
    ("Parish Church San Isidro",             14.6956, 120.964),
    ("Jollibee Malinta",                     14.6929, 120.964),
    ("Malinta Elementary School",            14.6925, 120.965),
    ("MacArthur / Maysan Road",              14.6928, 120.966),
    ("Flying V Gas",                         14.6928, 120.969),
    ("South Supermarket",                    14.6922, 120.971),
    ("Bureau of Telecom Training Institute", 14.6911, 120.973),
    ("Karuhatan Public Market",              14.6899, 120.974),
    ("Macro LPG",                            14.6886, 120.975),
    ("MacArthur / San Francisco",            14.6877, 120.975),
    ("SM Center Valenzuela",                 14.6862, 120.976),
    ("MacArthur / Cayetano",                 14.6852, 120.977),
    ("Novo Dep. Store",                      14.6837, 120.978),
    ("Bread of Life",                        14.6815, 120.979),
    ("OLFU / Fatima University",             14.6779, 120.98),
    ("Bearsea Auto Supply",                  14.6749, 120.981),
    ("Calalang General Hospital",            14.6732, 120.982),
    ("CDC Manufacturing",                    14.67,   120.982),
    ("MacArthur / Del Monte",                14.6677, 120.982),
    ("Malabon / Victoneta Ave",              14.665,  120.984),
    ("Potrero Heights Elem School",          14.663,  120.984),
    ("MacArthur / Lanzones",                 14.6617, 120.984),
    ("Floresco North Mortuary",              14.6601, 120.984),
    ("Bonifacio Market",                     14.6576, 120.984),
    ("Araneta Square Mall",                  14.6571, 120.984),
    ("Monumento",                            14.6564, 120.984),
    ("Ever Gotesco Grand Central",           14.6556, 120.984),
    ("McDonalds Rizal Ave",                  14.6538, 120.984),
    ("Rizal Ave / Asistio",                  14.6516, 120.984),
    ("Rizal Ave / 8th Ave West",             14.6488, 120.984),
    ("Asia Trust Bank",                      14.6462, 120.984),
    ("CR3 / M.H. Del Pilar",                 14.6445, 120.984),
    ("Banco De Oro Rizal Ave",               14.6412, 120.984),
    ("Baliwag Transit Bus Station",          14.64,   120.984),
    ("Rizal Ave / Road 1",                   14.6374, 120.983),
    ("LRT R. Papa Station",                  14.6362, 120.982),
    ("P. Sevilla / 2nd Ave West",            14.6334, 120.981),
    ("Rizal Ave / Jose Abad Santos",         14.632,  120.981),
    ("Jose Abad Santos / Morong",            14.6304, 120.98),
    ("Jose Abad Santos / Corregidor",        14.629,  120.979),
    ("Jose Abad Santos Ave",                 14.6275, 120.979),
    ("Jose Abad Santos / T. Bugallon",       14.6257, 120.979),
    ("T. Bugallon Street",                   14.6256, 120.98),
    ("T. Bugallon / Cavite",                 14.6243, 120.981),
    ("T. Mapua / New Antipolo",              14.623,  120.982),
    ("T. Mapua / Laguna",                    14.6219, 120.982),
    ("Tomas Mapua / Batangas",               14.6206, 120.982),
    ("Felix Huertas Manila",                 14.6147, 120.985),
    ("Quiricada / Felix Huertas",            14.613,  120.984),
    ("Felix Huertas 2",                      14.6115, 120.984),
    ("Felix Huertas 3",                      14.6092, 120.984),
    ("Sulu Manila",                          14.6076, 120.984),
    ("Quezon Blvd / P. Paredes",             14.6073, 120.986),
    ("España Blvd / Quezon Blvd",            14.6048, 120.985),
    ("Claro M. Recto Ave / Quezon Blvd",     14.6031, 120.985),
    ("Recto LRT",                            14.6037, 120.983),
]


# ── Haversine ─────────────────────────────────────────────────────────────────

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return EARTH_RADIUS_M * 2 * math.asin(math.sqrt(a))


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class SilhouetteResult:
    score: float            # mean silhouette coefficient (-1 to +1)
    per_cluster: List[dict] # per-cluster mean silhouette
    interpretation: str
    n_clusters: int
    n_points: int


@dataclass
class DaviesBouldinResult:
    index: float            # Davies-Bouldin index (lower = better)
    per_cluster: List[dict] # per-cluster DB score
    interpretation: str
    n_clusters: int


@dataclass
class GroundTruthMatch:
    detected_cluster_id: int
    detected_lat: float
    detected_lon: float
    nearest_stop_name: str
    nearest_stop_lat: float
    nearest_stop_lon: float
    offset_m: float         # Haversine distance from centroid to nearest GT stop
    matched: bool           # offset_m <= match_threshold_m


@dataclass
class ClusterEvaluationResult:
    """Complete ML evaluation result for one DBSCAN run."""
    # Internal validity
    silhouette:     SilhouetteResult
    davies_bouldin: DaviesBouldinResult

    # External validity (ground truth)
    match_threshold_m: float
    matches:           List[GroundTruthMatch]
    mae_m:             float    # Mean Absolute Error of centroid offsets
    true_positives:    int      # detected clusters matched to a GT stop
    false_positives:   int      # detected clusters with no nearby GT stop
    false_negatives:   int      # GT stops not covered by any cluster
    precision:         float    # TP / (TP + FP)
    recall:            float    # TP / (TP + FN)
    f1_score:          float    # harmonic mean of precision and recall

    # Parameters echo
    eps_m:        float
    min_samples:  int
    total_input:  int
    dbscan_input: int
    noise_ratio:  float


# ── Silhouette Coefficient ────────────────────────────────────────────────────

def compute_silhouette(
    points_by_cluster: dict,   # {cluster_id: [(lat, lon), ...]}
) -> SilhouetteResult:
    """
    Silhouette Coefficient for DBSCAN output using Haversine distance.

    For each point i:
      a(i) = mean distance to all OTHER points in same cluster (cohesion)
      b(i) = mean distance to all points in nearest OTHER cluster (separation)
      s(i) = (b(i) - a(i)) / max(a(i), b(i))

    Mean s(i) across all points = Silhouette Score.
    Range: -1 (wrong cluster) to +1 (perfect separation).
    Threshold: ≥ 0.5 indicates valid clustering for GPS stop data.

    Complexity: O(n²) — acceptable for field-ride log counts (≤ 2000 points).
    """
    cluster_ids = list(points_by_cluster.keys())
    n_clusters  = len(cluster_ids)

    if n_clusters < 2:
        return SilhouetteResult(
            score=0.0, per_cluster=[], n_clusters=n_clusters, n_points=0,
            interpretation="Cannot compute: need ≥ 2 clusters"
        )

    # Flatten all points with their cluster label
    all_points  = []   # (lat, lon)
    all_labels  = []   # cluster_id

    for cid, pts in points_by_cluster.items():
        for pt in pts:
            all_points.append(pt)
            all_labels.append(cid)

    n = len(all_points)
    if n == 0:
        return SilhouetteResult(
            score=0.0, per_cluster=[], n_clusters=n_clusters, n_points=0,
            interpretation="No points to evaluate"
        )

    silhouettes = []
    cluster_silhouettes = {cid: [] for cid in cluster_ids}

    for i in range(n):
        lat_i, lon_i = all_points[i]
        cid_i        = all_labels[i]

        # a(i): mean dist to same-cluster points
        same = [j for j in range(n) if all_labels[j] == cid_i and j != i]
        if not same:
            silhouettes.append(0.0)
            cluster_silhouettes[cid_i].append(0.0)
            continue

        a_i = np.mean([
            haversine_m(lat_i, lon_i, all_points[j][0], all_points[j][1])
            for j in same
        ])

        # b(i): mean dist to nearest OTHER cluster
        b_i = float("inf")
        for cid_other in cluster_ids:
            if cid_other == cid_i:
                continue
            other = [j for j in range(n) if all_labels[j] == cid_other]
            mean_dist = np.mean([
                haversine_m(lat_i, lon_i, all_points[j][0], all_points[j][1])
                for j in other
            ])
            b_i = min(b_i, mean_dist)

        s_i = (b_i - a_i) / max(a_i, b_i) if max(a_i, b_i) > 0 else 0.0
        silhouettes.append(s_i)
        cluster_silhouettes[cid_i].append(s_i)

    score = float(np.mean(silhouettes))

    per_cluster = [
        {
            "cluster_id":      int(cid),
            "mean_silhouette": round(float(np.mean(vals)), 4) if vals else 0.0,
            "n_points":        int(len(vals)),
        }
        for cid, vals in cluster_silhouettes.items()
    ]

    if score >= 0.7:
        interp = "Strong — clusters are dense and well-separated"
    elif score >= 0.5:
        interp = "Reasonable — clusters are acceptably separated for GPS stop data"
    elif score >= 0.25:
        interp = "Weak — clusters overlap; consider adjusting eps or minPts"
    else:
        interp = "Poor — no meaningful cluster structure detected"

    return SilhouetteResult(
        score=round(score, 4),
        per_cluster=per_cluster,
        n_clusters=n_clusters,
        n_points=n,
        interpretation=interp,
    )


# ── Davies-Bouldin Index ──────────────────────────────────────────────────────

def compute_davies_bouldin(
    points_by_cluster: dict,
) -> DaviesBouldinResult:
    """
    Davies-Bouldin Index for DBSCAN output using Haversine distance.

    For each cluster i:
      s_i = mean distance of all points in i to centroid i (scatter)

    DB index = mean over all i of max_{j ≠ i} [ (s_i + s_j) / d(c_i, c_j) ]

    where d(c_i, c_j) = Haversine distance between centroids.
    Lower = better. GPS stop data: DB < 0.5 is excellent, < 1.0 is acceptable.
    """
    cluster_ids = list(points_by_cluster.keys())
    n_clusters  = len(cluster_ids)

    if n_clusters < 2:
        return DaviesBouldinResult(
            index=0.0, per_cluster=[], n_clusters=n_clusters,
            interpretation="Cannot compute: need ≥ 2 clusters"
        )

    # Compute centroid and scatter (s) per cluster
    centroids = {}
    scatters  = {}

    for cid, pts in points_by_cluster.items():
        lats = [p[0] for p in pts]
        lons = [p[1] for p in pts]
        c_lat = float(np.mean(lats))
        c_lon = float(np.mean(lons))
        centroids[cid] = (c_lat, c_lon)
        scatters[cid]  = float(np.mean([
            haversine_m(lat, lon, c_lat, c_lon) for lat, lon in pts
        ])) if pts else 0.0

    # DB ratio per cluster pair
    per_cluster = []
    db_per_i    = []

    for cid_i in cluster_ids:
        max_ratio = 0.0
        for cid_j in cluster_ids:
            if cid_j == cid_i:
                continue
            d_ij = haversine_m(
                centroids[cid_i][0], centroids[cid_i][1],
                centroids[cid_j][0], centroids[cid_j][1],
            )
            if d_ij == 0:
                continue
            ratio = (scatters[cid_i] + scatters[cid_j]) / d_ij
            max_ratio = max(max_ratio, ratio)

        db_per_i.append(max_ratio)
        per_cluster.append({
            "cluster_id":   int(cid_i),
            "scatter_m":    round(float(scatters[cid_i]), 2),
            "db_score":     round(float(max_ratio), 4),
            "centroid_lat": round(float(centroids[cid_i][0]), 6),
            "centroid_lon": round(float(centroids[cid_i][1]), 6),
        })

    index = float(np.mean(db_per_i))

    if index < 0.3:
        interp = "Excellent — clusters are compact and well-separated"
    elif index < 0.5:
        interp = "Good — acceptable separation for GPS stop detection"
    elif index < 1.0:
        interp = "Moderate — some cluster overlap present"
    else:
        interp = "Poor — clusters are not well-separated"

    return DaviesBouldinResult(
        index=round(index, 4),
        per_cluster=per_cluster,
        n_clusters=n_clusters,
        interpretation=interp,
    )


# ── Ground Truth Comparison ───────────────────────────────────────────────────

def compare_to_ground_truth(
    detected_clusters: List[dict],   # list of {"cluster_id", "centroid_lat", "centroid_lon"}
    ground_truth: List[Tuple[str, float, float]] = None,
    match_threshold_m: float = 100.0,
) -> dict:
    """
    Compare detected cluster centroids to manually recorded ground truth stops.

    For each detected cluster: find nearest GT stop, compute Haversine offset.
    MAE = mean of all centroid offsets (lower = better spatial accuracy).
    Confusion matrix:
      TP = detected cluster within match_threshold_m of a GT stop
      FP = detected cluster with no GT stop within threshold
      FN = GT stop not matched by any detected cluster

    match_threshold_m = 100m default:
      Justified because official stop locations have ±50m positional uncertainty
      (hand-placed on GIS maps) and GPS ACCEPTABLE accuracy is ≤50m.
      50m GT error + 50m GPS error = 100m maximum reasonable match distance.
    """
    if ground_truth is None:
        ground_truth = GROUND_TRUTH_STOPS

    matches    = []
    gt_matched = set()   # indices of GT stops that have been claimed

    for cluster in detected_clusters:
        c_lat = cluster["centroid_lat"]
        c_lon = cluster["centroid_lon"]
        cid   = cluster["cluster_id"]

        # Find nearest GT stop
        best_dist  = float("inf")
        best_idx   = -1
        best_name  = ""
        best_gt_lat = 0.0
        best_gt_lon = 0.0

        for idx, (name, gt_lat, gt_lon) in enumerate(ground_truth):
            d = haversine_m(c_lat, c_lon, gt_lat, gt_lon)
            if d < best_dist:
                best_dist    = d
                best_idx     = idx
                best_name    = name
                best_gt_lat  = gt_lat
                best_gt_lon  = gt_lon

        matched = best_dist <= match_threshold_m
        if matched:
            gt_matched.add(best_idx)

        matches.append(GroundTruthMatch(
            detected_cluster_id=int(cid),
            detected_lat=float(c_lat),
            detected_lon=float(c_lon),
            nearest_stop_name=best_name,
            nearest_stop_lat=float(best_gt_lat),
            nearest_stop_lon=float(best_gt_lon),
            offset_m=round(float(best_dist), 2),
            matched=bool(matched),
        ))

    tp = sum(1 for m in matches if m.matched)
    fp = sum(1 for m in matches if not m.matched)
    fn = len(ground_truth) - len(gt_matched)

    mae = float(np.mean([m.offset_m for m in matches])) if matches else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1        = (2 * precision * recall / (precision + recall)
                 if (precision + recall) > 0 else 0.0)

    return {
        "matches":           [
            {
                "cluster_id":        m.detected_cluster_id,
                "detected_lat":      m.detected_lat,
                "detected_lon":      m.detected_lon,
                "nearest_stop":      m.nearest_stop_name,
                "gt_lat":            m.nearest_stop_lat,
                "gt_lon":            m.nearest_stop_lon,
                "offset_m":          m.offset_m,
                "matched":           m.matched,
            }
            for m in matches
        ],
        "mae_m":             round(mae, 2),
        "true_positives":    tp,
        "false_positives":   fp,
        "false_negatives":   fn,
        "precision":         round(precision, 4),
        "recall":            round(recall, 4),
        "f1_score":          round(f1, 4),
        "match_threshold_m": match_threshold_m,
        "n_ground_truth":    len(ground_truth),
        "n_detected":        len(detected_clusters),
    }


# ── Full evaluation pipeline ──────────────────────────────────────────────────

def evaluate_clusters(
    points_by_cluster: dict,    # {cluster_id: [(lat, lon), ...]}
    detected_clusters: List[dict],
    eps_m: float,
    min_samples: int,
    total_input: int,
    dbscan_input: int,
    noise_ratio: float,
    match_threshold_m: float = 100.0,
    ground_truth: List[Tuple[str, float, float]] = None,
) -> ClusterEvaluationResult:
    """
    Run the full ML evaluation pipeline:
      1. Silhouette Coefficient
      2. Davies-Bouldin Index
      3. Ground truth comparison (MAE + confusion matrix)

    Parameters
    ----------
    points_by_cluster : {cluster_id: [(lat, lon)]} — GOOD+ACCEPTABLE logs per cluster
    detected_clusters : list of cluster metadata dicts from run_dbscan()
    """
    sil = compute_silhouette(points_by_cluster)
    db  = compute_davies_bouldin(points_by_cluster)
    gt  = compare_to_ground_truth(detected_clusters, ground_truth, match_threshold_m)

    return ClusterEvaluationResult(
        silhouette=sil,
        davies_bouldin=db,
        match_threshold_m=match_threshold_m,
        matches=gt["matches"],
        mae_m=gt["mae_m"],
        true_positives=gt["true_positives"],
        false_positives=gt["false_positives"],
        false_negatives=gt["false_negatives"],
        precision=gt["precision"],
        recall=gt["recall"],
        f1_score=gt["f1_score"],
        eps_m=eps_m,
        min_samples=min_samples,
        total_input=total_input,
        dbscan_input=dbscan_input,
        noise_ratio=noise_ratio,
    )
