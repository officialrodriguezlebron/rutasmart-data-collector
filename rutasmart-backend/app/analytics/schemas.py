"""
Pydantic response schemas for RutaSmart analytics endpoints.
Kept separate from algorithms.py so FastAPI can auto-generate OpenAPI docs.
"""

from pydantic import BaseModel
from typing import List, Dict, Optional


class StopClusterOut(BaseModel):
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
    # TRUE_STOP | CREEPING_QUEUE | MOVING


class DBSCANResult(BaseModel):
    trip_id:      str
    clusters:     List[StopClusterOut]
    noise_ratio:  float          # fraction of POOR logs excluded (0–1)
    eps_m:        float
    min_samples:  int
    total_input:  int            # logs before POOR filter
    dbscan_input: int            # logs after POOR filter
    noise_points: int            # DBSCAN spatial noise (not POOR logs)


class PeriodStat(BaseModel):
    avg_lf:    float
    max_lf:    float
    log_count: int


class LoadFactorResult(BaseModel):
    trip_id:           str
    official_capacity: int
    overall:           Dict[str, float]   # avg_lf, max_lf, min_lf, log_count
    by_period:         Dict[str, PeriodStat]


class TierCount(BaseModel):
    count: int
    pct:   float


class DemandResult(BaseModel):
    trip_id:      str
    distribution: Dict[str, TierCount]   # Normal | Moderate | High | Critical


class PeriodCount(BaseModel):
    count: int
    pct:   float


class TimeResult(BaseModel):
    trip_id:      str
    distribution: Dict[str, PeriodCount]


class GPSQualityResult(BaseModel):
    trip_id:          str
    total_logs:       int
    good_count:       int
    acceptable_count: int
    poor_count:       int
    good_pct:         float
    acceptable_pct:   float
    poor_pct:         float
    dbscan_eligible:  int
    dbscan_excluded:  int


class FullAnalyticsResult(BaseModel):
    """
    Single-call endpoint — runs all four features and returns combined output.
    This is what the Admin/Analyst dashboard calls.
    """
    trip_id:     str
    gps_quality: GPSQualityResult
    dbscan:      DBSCANResult
    load_factor: LoadFactorResult
    demand:      DemandResult
    time_dist:   TimeResult


# ── Sensitivity analysis schemas ──────────────────────────────────────────────

class SensitivityRow(BaseModel):
    eps_m:                float
    min_samples:          int
    cluster_count:        int
    noise_points:         int
    dbscan_input:         int
    avg_cluster_size:     float
    centroid_spread_m:    float
    true_stop_count:      int
    creeping_queue_count: int
    moving_count:         int
    noise_ratio:          float


class SensitivityResult(BaseModel):
    trip_id:    str
    rows:       List[SensitivityRow]
    recommended: dict   # highlights the (eps=50, minPts=5) cell


# ── Inter-route overlap schemas ───────────────────────────────────────────────

class OverlapSegment(BaseModel):
    cluster_id:    int
    centroid:      dict   # {lat, lon}
    total_points:  int
    trip_a_points: int
    trip_b_points: int


class OverlapResult(BaseModel):
    trip_a_id:        str
    trip_b_id:        str
    overlap_segments: List[OverlapSegment]
    trip_a_only:      List[OverlapSegment]
    trip_b_only:      List[OverlapSegment]
    eps_m:            float
    min_samples:      int
    total_a:          int
    total_b:          int


# ── Cluster evaluation schemas (ML metrics) ───────────────────────────────────

class SilhouetteResultOut(BaseModel):
    score:          float
    per_cluster:    List[dict]
    interpretation: str
    n_clusters:     int
    n_points:       int


class DaviesBouldinResultOut(BaseModel):
    index:          float
    per_cluster:    List[dict]
    interpretation: str
    n_clusters:     int


class GroundTruthMatchOut(BaseModel):
    cluster_id:    int
    detected_lat:  float
    detected_lon:  float
    nearest_stop:  str
    gt_lat:        float
    gt_lon:        float
    offset_m:      float
    matched:       bool


class ClusterEvaluationOut(BaseModel):
    """
    Full ML evaluation result — Silhouette + Davies-Bouldin + Ground Truth.
    Required by professor's revision to Chapter 3.
    """
    # Internal validity metrics
    silhouette:     SilhouetteResultOut
    davies_bouldin: DaviesBouldinResultOut

    # External validity (ground truth comparison)
    match_threshold_m: float
    matches:           List[GroundTruthMatchOut]
    mae_m:             float
    true_positives:    int
    false_positives:   int
    false_negatives:   int
    precision:         float
    recall:            float
    f1_score:          float

    # Context
    eps_m:        float
    min_samples:  int
    total_input:  int
    dbscan_input: int
    noise_ratio:  float
