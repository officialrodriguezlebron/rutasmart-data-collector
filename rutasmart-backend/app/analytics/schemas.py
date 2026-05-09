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
