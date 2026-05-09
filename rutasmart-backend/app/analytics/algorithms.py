"""
RutaSmart Analytics — Four-Feature Model
=========================================
Implements the four algorithms described in the thesis:

  1. Haversine distance      — great-circle distance between GPS coordinates
  2. DBSCAN stop detection   — density-based clustering of GPS logs
  3. Load factor computation — occupancy / capacity utilisation
  4. Time categorisation     — Morning Peak / Midday / Afternoon Peak / Off-Peak

POOR log filtering
------------------
GPS logs flagged POOR (accuracy > 50m) are excluded from DBSCAN input.
The positional error of a POOR log exceeds epsilon (50m), meaning the log
could spatially belong to any neighbouring cluster — including wrong ones.
Filtering them removes noise without discarding useful occupancy data;
the occupancy_count is still valid even when the GPS fix is unreliable.

Design note: POOR logs ARE included in load factor and time categorisation
because those metrics depend on occupancy and timestamp, not position.
"""

import math
import numpy as np
from datetime import datetime
from typing import List, Optional
from dataclasses import dataclass, field


# ── 1. Haversine Distance ─────────────────────────────────────────────────────

EARTH_RADIUS_M = 6_371_000  # metres


def haversine_distance(lat1: float, lon1: float,
                       lat2: float, lon2: float) -> float:
    """
    Great-circle distance in metres between two WGS-84 coordinates.
    Used as the distance metric for DBSCAN so that epsilon is in real-world
    metres rather than degrees (which vary with latitude).
    """
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.asin(math.sqrt(a))


# ── 2. DBSCAN Stop Cluster Detection ─────────────────────────────────────────

@dataclass
class GPSPoint:
    """Minimal GPS record fed into DBSCAN."""
    log_id: str
    latitude: float
    longitude: float
    accuracy: float
    gps_quality_flag: str       # GOOD | ACCEPTABLE | POOR
    occupancy_count: int
    timestamp: datetime
    trip_id: str


@dataclass
class StopCluster:
    """One detected stop cluster — DBSCAN output."""
    cluster_id: int
    centroid_lat: float
    centroid_lon: float
    point_count: int
    avg_occupancy: float
    max_occupancy: int
    demand_tier: str            # Normal | Moderate | High | Critical
    peak_period: str            # Morning Peak | Midday | Afternoon Peak | Off-Peak
    load_factor_pct: float      # avg occupancy / official capacity × 100
    noise_ratio_pct: float      # % POOR logs excluded before clustering


def run_dbscan(
    points: List[GPSPoint],
    official_capacity: int,
    eps_m: float = 50.0,
    min_samples: int = 5,
) -> dict:
    """
    Run DBSCAN on a list of GPSPoint records.

    POOR logs are filtered before clustering but counted so the noise_ratio
    can be reported. POOR logs' occupancy data is preserved in the
    load-factor and demand calculations, which operate on ALL logs.

    Parameters
    ----------
    points          : GPS logs for one trip (already fetched from DB)
    official_capacity : jeepney's official seating capacity
    eps_m           : cluster radius in metres (default 50m per blueprint)
    min_samples     : minimum cluster density (default 5 per blueprint)

    Returns
    -------
    dict with keys:
        clusters      : List[StopCluster]
        noise_ratio   : float  (fraction of POOR logs)
        eps_m         : float  (parameter echo)
        min_samples   : int    (parameter echo)
        total_input   : int    (logs before filter)
        dbscan_input  : int    (logs after POOR filter)
        noise_points  : int    (DBSCAN noise — not the same as POOR)
    """
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    total_input = len(points)
    if total_input == 0:
        return _empty_result(eps_m, min_samples)

    # ── Filter: exclude POOR logs from spatial clustering ────────────────────
    poor_logs  = [p for p in points if p.gps_quality_flag == "POOR"]
    clean_logs = [p for p in points if p.gps_quality_flag != "POOR"]

    noise_ratio = len(poor_logs) / total_input if total_input else 0.0

    if len(clean_logs) < min_samples:
        # Not enough clean points to form even one cluster
        return _empty_result(eps_m, min_samples,
                             total_input=total_input,
                             noise_ratio=noise_ratio)

    # ── Build coordinate matrix (radians for haversine metric) ───────────────
    coords = np.radians(
        np.array([[p.latitude, p.longitude] for p in clean_logs])
    )
    eps_radians = eps_m / EARTH_RADIUS_M

    db = SKLearnDBSCAN(
        eps=eps_radians,
        min_samples=min_samples,
        metric="haversine",
        algorithm="ball_tree",
        n_jobs=-1,
    )
    db.fit(coords)
    labels = db.labels_

    dbscan_noise_count = int(np.sum(labels == -1))

    # ── Build cluster summaries ───────────────────────────────────────────────
    clusters: List[StopCluster] = []
    unique_labels = sorted(set(labels) - {-1})

    for cid in unique_labels:
        mask = labels == cid
        cluster_pts = [p for p, m in zip(clean_logs, mask) if m]

        lats = [p.latitude  for p in cluster_pts]
        lons = [p.longitude for p in cluster_pts]
        occs = [p.occupancy_count for p in cluster_pts]
        times = [p.timestamp for p in cluster_pts]

        centroid_lat = float(np.mean(lats))
        centroid_lon = float(np.mean(lons))
        avg_occ      = float(np.mean(occs))
        max_occ      = int(np.max(occs))
        lf_pct       = (avg_occ / official_capacity * 100) if official_capacity > 0 else 0.0

        demand_tier  = classify_demand(max_occ, official_capacity)
        peak_period  = _most_common_period([categorise_time(t) for t in times])

        clusters.append(StopCluster(
            cluster_id=cid,
            centroid_lat=centroid_lat,
            centroid_lon=centroid_lon,
            point_count=len(cluster_pts),
            avg_occupancy=round(avg_occ, 2),
            max_occupancy=max_occ,
            demand_tier=demand_tier,
            peak_period=peak_period,
            load_factor_pct=round(lf_pct, 2),
            noise_ratio_pct=round(noise_ratio * 100, 2),
        ))

    return {
        "clusters":     clusters,
        "noise_ratio":  round(noise_ratio, 4),
        "eps_m":        eps_m,
        "min_samples":  min_samples,
        "total_input":  total_input,
        "dbscan_input": len(clean_logs),
        "noise_points": dbscan_noise_count,   # spatial noise, not POOR logs
    }


def _empty_result(eps_m, min_samples, total_input=0, noise_ratio=0.0):
    return {
        "clusters":     [],
        "noise_ratio":  noise_ratio,
        "eps_m":        eps_m,
        "min_samples":  min_samples,
        "total_input":  total_input,
        "dbscan_input": 0,
        "noise_points": 0,
    }


def _most_common_period(periods: List[str]) -> str:
    if not periods:
        return "Unknown"
    return max(set(periods), key=periods.count)


# ── 3. Demand Intensity Classification ───────────────────────────────────────

def classify_demand(occupancy: int, official_capacity: int) -> str:
    """
    Four-tier demand classification relative to official capacity.

    Normal   : occupancy ≤ official_capacity       (utilisation ≤ 100%)
    Moderate : official_capacity < occ ≤ cap + 5   (up to ~120% for C=25)
    High     : cap + 5 < occ ≤ cap + 10
    Critical : occ > cap + 10

    Using capacity-relative bands rather than fixed integers makes the
    classification portable to other routes with different capacities.
    """
    if occupancy <= official_capacity:
        return "Normal"
    elif occupancy <= official_capacity + 5:
        return "Moderate"
    elif occupancy <= official_capacity + 10:
        return "High"
    else:
        return "Critical"


def classify_demand_distribution(
    points: List[GPSPoint],
    official_capacity: int,
) -> dict:
    """
    Aggregate demand tier counts across all logs in a trip.
    Includes POOR logs — occupancy is valid regardless of GPS accuracy.
    """
    tiers = {"Normal": 0, "Moderate": 0, "High": 0, "Critical": 0}
    for p in points:
        tier = classify_demand(p.occupancy_count, official_capacity)
        tiers[tier] += 1
    total = len(points)
    return {
        tier: {
            "count": count,
            "pct": round(count / total * 100, 1) if total else 0.0,
        }
        for tier, count in tiers.items()
    }


# ── 4. Load Factor Computation ────────────────────────────────────────────────

def compute_load_factor(occupancy: int, capacity: int) -> float:
    """Passenger load factor as a percentage of official capacity."""
    return round((occupancy / capacity) * 100, 2) if capacity > 0 else 0.0


def load_factor_by_period(
    points: List[GPSPoint],
    official_capacity: int,
) -> dict:
    """
    Average load factor broken down by time period.
    Includes POOR logs (occupancy is still valid).
    Returns dict keyed by period name with avg_lf, log_count, max_lf.
    """
    buckets: dict[str, List[float]] = {
        "Morning Peak":    [],
        "Midday":          [],
        "Afternoon Peak":  [],
        "Off-Peak":        [],
    }

    for p in points:
        period = categorise_time(p.timestamp)
        lf = compute_load_factor(p.occupancy_count, official_capacity)
        buckets[period].append(lf)

    result = {}
    for period, lfs in buckets.items():
        if lfs:
            result[period] = {
                "avg_lf":    round(sum(lfs) / len(lfs), 2),
                "max_lf":    round(max(lfs), 2),
                "log_count": len(lfs),
            }
        else:
            result[period] = {"avg_lf": 0.0, "max_lf": 0.0, "log_count": 0}

    return result


def trip_load_factor_summary(
    points: List[GPSPoint],
    official_capacity: int,
) -> dict:
    """Overall load factor stats for a full trip."""
    if not points:
        return {"avg_lf": 0.0, "max_lf": 0.0, "min_lf": 0.0, "log_count": 0}

    lfs = [compute_load_factor(p.occupancy_count, official_capacity)
           for p in points]
    return {
        "avg_lf":    round(sum(lfs) / len(lfs), 2),
        "max_lf":    round(max(lfs), 2),
        "min_lf":    round(min(lfs), 2),
        "log_count": len(lfs),
    }


# ── 5. Time Categorisation ────────────────────────────────────────────────────

def categorise_time(ts: datetime) -> str:
    """
    Assign a GPS log to one of four operational periods.
    Timestamps are stored as naive UTC — convert to PHT (UTC+8) first
    so that period boundaries reflect actual Manila local time.

    Morning Peak   06:00 – 08:59 PHT
    Midday         09:00 – 15:59 PHT
    Afternoon Peak 16:00 – 18:59 PHT
    Off-Peak       19:00 – 05:59 PHT
    """
    from datetime import timedelta
    PHT_OFFSET = timedelta(hours=8)
    ts_pht = ts + PHT_OFFSET          # naive UTC → naive PHT
    h = ts_pht.hour
    if 6 <= h < 9:
        return "Morning Peak"
    elif 9 <= h < 16:
        return "Midday"
    elif 16 <= h < 19:
        return "Afternoon Peak"
    else:
        return "Off-Peak"


def time_period_distribution(points: List[GPSPoint]) -> dict:
    """Log count and percentage per time period."""
    periods = {"Morning Peak": 0, "Midday": 0, "Afternoon Peak": 0, "Off-Peak": 0}
    for p in points:
        periods[categorise_time(p.timestamp)] += 1
    total = len(points)
    return {
        period: {
            "count": count,
            "pct": round(count / total * 100, 1) if total else 0.0,
        }
        for period, count in periods.items()
    }


# ── 6. GPS Quality Summary ────────────────────────────────────────────────────

def gps_quality_summary(points: List[GPSPoint]) -> dict:
    """
    Break down log counts by GPS quality flag.
    Tells the analyst exactly how many logs were excluded from DBSCAN (POOR)
    and why, fulfilling the thesis claim about automatic quality classification.
    """
    counts = {"GOOD": 0, "ACCEPTABLE": 0, "POOR": 0}
    for p in points:
        flag = p.gps_quality_flag.upper() if p.gps_quality_flag else "POOR"
        counts[flag] = counts.get(flag, 0) + 1

    total = len(points)
    dbscan_eligible = counts["GOOD"] + counts["ACCEPTABLE"]

    return {
        "total_logs":       total,
        "good_count":       counts["GOOD"],
        "acceptable_count": counts["ACCEPTABLE"],
        "poor_count":       counts["POOR"],
        "good_pct":         round(counts["GOOD"]       / total * 100, 1) if total else 0.0,
        "acceptable_pct":   round(counts["ACCEPTABLE"] / total * 100, 1) if total else 0.0,
        "poor_pct":         round(counts["POOR"]       / total * 100, 1) if total else 0.0,
        "dbscan_eligible":  dbscan_eligible,
        "dbscan_excluded":  counts["POOR"],
    }
