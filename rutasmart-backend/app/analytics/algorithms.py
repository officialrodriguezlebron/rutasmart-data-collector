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
    # ── Velocity classification (new) ─────────────────────────────────────
    avg_velocity_ms: float = 0.0   # mean speed of member logs (m/s)
    cluster_type: str = "TRUE_STOP"
    # TRUE_STOP      avg_v < 0.3 m/s  — stationary boarding zone
    # CREEPING_QUEUE 0.3 ≤ avg_v ≤ 1.0 m/s — slow queue near terminal
    # MOVING         avg_v > 1.0 m/s  — jeepney in motion, treat as noise


# ── Velocity helpers ──────────────────────────────────────────────────────────

def compute_velocities(points: List[GPSPoint]) -> List[float]:
    """
    Compute point-to-point speed (m/s) for a time-ordered list of GPS logs.
    Uses Haversine distance / time delta between consecutive logs.
    Returns a list of the same length as points; first entry is always 0.0.
    """
    velocities = [0.0]
    for i in range(1, len(points)):
        dt = (points[i].timestamp - points[i-1].timestamp).total_seconds()
        if dt <= 0:
            velocities.append(0.0)
            continue
        dist = haversine_distance(
            points[i-1].latitude, points[i-1].longitude,
            points[i].latitude,   points[i].longitude,
        )
        velocities.append(dist / dt)
    return velocities


def classify_cluster_type(avg_velocity_ms: float) -> str:
    """
    Classify a cluster by the average speed of its member logs.

    TRUE_STOP      < 0.3 m/s  (< 1.1 km/h) — effectively stationary
    CREEPING_QUEUE 0.3–1.0 m/s (1.1–3.6 km/h) — terminal queue / heavy traffic
    MOVING         > 1.0 m/s  (> 3.6 km/h)  — jeepney in motion; DBSCAN artefact

    Thresholds justified by:
      0.3 m/s — below walking speed; GPS noise dominates, jeepney not moving
      1.0 m/s — upper bound of terminal queue crawl on MacArthur Hwy
    """
    if avg_velocity_ms < 0.3:
        return "TRUE_STOP"
    elif avg_velocity_ms <= 1.0:
        return "CREEPING_QUEUE"
    else:
        return "MOVING"


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

    # ── Compute per-log velocities (needs time-sorted clean_logs) ────────────
    clean_logs_sorted = sorted(clean_logs, key=lambda p: p.timestamp)
    velocities_map = {
        p.log_id: v
        for p, v in zip(clean_logs_sorted, compute_velocities(clean_logs_sorted))
    }

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

        # velocity classification
        member_velocities = [velocities_map.get(p.log_id, 0.0) for p in cluster_pts]
        avg_vel = float(np.mean(member_velocities)) if member_velocities else 0.0
        c_type  = classify_cluster_type(avg_vel)

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
            avg_velocity_ms=round(avg_vel, 3),
            cluster_type=c_type,
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


# ── 7. Task B — Inter-Route Overlap Detection ─────────────────────────────────
#
# DIFFERENT from Task A. Here we want to find road SEGMENTS that are shared
# between two trips/routes, not boarding-zone dwell points.
#
# Parameter justification vs Task A:
#   eps = 75m (not 50m)
#     — Road-sharing test needs to tolerate GPS noise (≤50m ACCEPTABLE) PLUS
#       lane width (~3.5m) PLUS cross-track error on a curve. 75m gives ~25m
#       margin above the accuracy filter threshold. Going to 100m risks merging
#       parallel roads that are only 80-100m apart in dense Caloocan.
#
#   minPts = 20 (not 5)
#     — We only call a segment "overlap" if routes share it CONTINUOUSLY.
#       At 30km/h, 500m of shared road = 60 logs. Requiring 20 logs means
#       overlap must span ≥100m (3 logs × 25m/log × some clustering density).
#       This eliminates coincidental GPS scatter near an intersection.

def run_overlap_dbscan(
    trip_a_points: List[GPSPoint],
    trip_b_points: List[GPSPoint],
    eps_m: float = 75.0,
    min_samples: int = 20,
) -> dict:
    """
    Detect road segments shared between two trips using DBSCAN.

    Strategy: pool GOOD+ACCEPTABLE logs from both trips, run DBSCAN,
    then for each cluster count how many points come from each trip.
    A cluster where BOTH trips contribute ≥ min_samples/2 points
    is flagged as an overlap segment.

    Parameters
    ----------
    trip_a_points, trip_b_points : GPS logs for each route
    eps_m        : 75m — wider than Task A to tolerate GPS noise + lane width
    min_samples  : 20 — requires sustained co-presence (≥100m shared road)

    Returns
    -------
    overlap_segments : clusters where both routes are present
    trip_a_only      : clusters exclusive to trip A
    trip_b_only      : clusters exclusive to trip B
    """
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    # Filter POOR logs from both trips
    a_clean = [p for p in trip_a_points if p.gps_quality_flag != "POOR"]
    b_clean = [p for p in trip_b_points if p.gps_quality_flag != "POOR"]

    if len(a_clean) + len(b_clean) < min_samples:
        return {"overlap_segments": [], "trip_a_only": [], "trip_b_only": [],
                "eps_m": eps_m, "min_samples": min_samples,
                "total_a": len(a_clean), "total_b": len(b_clean)}

    all_points = a_clean + b_clean
    a_ids = {p.log_id for p in a_clean}

    coords = np.radians(
        np.array([[p.latitude, p.longitude] for p in all_points])
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

    overlap_segments, a_only, b_only = [], [], []

    for cid in sorted(set(labels) - {-1}):
        mask = labels == cid
        cluster_pts = [p for p, m in zip(all_points, mask) if m]

        a_pts = [p for p in cluster_pts if p.log_id in a_ids]
        b_pts = [p for p in cluster_pts if p.log_id not in a_ids]

        lats = [p.latitude  for p in cluster_pts]
        lons = [p.longitude for p in cluster_pts]
        centroid = {"lat": float(np.mean(lats)), "lon": float(np.mean(lons))}

        record = {
            "cluster_id":    cid,
            "centroid":      centroid,
            "total_points":  len(cluster_pts),
            "trip_a_points": len(a_pts),
            "trip_b_points": len(b_pts),
        }

        threshold = min_samples // 2   # both trips must contribute meaningfully
        if len(a_pts) >= threshold and len(b_pts) >= threshold:
            overlap_segments.append(record)
        elif len(a_pts) >= threshold:
            a_only.append(record)
        else:
            b_only.append(record)

    return {
        "overlap_segments": overlap_segments,
        "trip_a_only":      a_only,
        "trip_b_only":      b_only,
        "eps_m":            eps_m,
        "min_samples":      min_samples,
        "total_a":          len(a_clean),
        "total_b":          len(b_clean),
    }


# ── 8. Sensitivity Analysis ───────────────────────────────────────────────────
#
# Runs DBSCAN across a grid of eps × minPts values and reports how cluster
# count, centroid stability, and noise ratio change.
# Used to justify the chosen parameters in Chapter 4 / defense.

def run_sensitivity_analysis(
    points: List[GPSPoint],
    official_capacity: int,
    eps_values: List[float] = None,
    minpts_values: List[int] = None,
) -> List[dict]:
    """
    Grid search over eps × minPts for Task A (stop detection).

    For each (eps, minPts) combination reports:
      - cluster_count        : number of clusters found
      - noise_points         : DBSCAN spatial noise count
      - dbscan_input         : logs available after POOR filter
      - avg_cluster_size     : mean points per cluster
      - centroid_spread_m    : mean pairwise distance between centroids (stability proxy)
      - true_stop_count      : clusters classified as TRUE_STOP
      - creeping_queue_count : clusters classified as CREEPING_QUEUE
      - moving_count         : clusters classified as MOVING (artefacts)

    Default grid covers the recommended range for the Malanday-Recto corridor:
      eps     : 30, 40, 50, 60, 75, 100 m
      minPts  : 3, 5, 8, 10
    """
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    if eps_values is None:
        eps_values = [30, 40, 50, 60, 75, 100]
    if minpts_values is None:
        minpts_values = [3, 5, 8, 10]

    # Filter POOR once — reused across all grid cells
    clean_logs = [p for p in points if p.gps_quality_flag != "POOR"]
    total_input = len(points)
    dbscan_input = len(clean_logs)
    noise_ratio = (total_input - dbscan_input) / total_input if total_input else 0.0

    if dbscan_input == 0:
        return [{
            "eps_m": e, "min_samples": m,
            "cluster_count": 0, "noise_points": dbscan_input,
            "dbscan_input": 0, "avg_cluster_size": 0.0,
            "centroid_spread_m": 0.0,
            "true_stop_count": 0, "creeping_queue_count": 0, "moving_count": 0,
            "noise_ratio": noise_ratio,
        } for e in eps_values for m in minpts_values]

    coords = np.radians(
        np.array([[p.latitude, p.longitude] for p in clean_logs])
    )

    # Velocities computed once
    clean_sorted = sorted(clean_logs, key=lambda p: p.timestamp)
    vel_map = {
        p.log_id: v
        for p, v in zip(clean_sorted, compute_velocities(clean_sorted))
    }

    results = []

    for eps_m in eps_values:
        eps_rad = eps_m / EARTH_RADIUS_M
        for minpts in minpts_values:
            db = SKLearnDBSCAN(
                eps=eps_rad, min_samples=minpts,
                metric="haversine", algorithm="ball_tree", n_jobs=-1,
            )
            db.fit(coords)
            labels = db.labels_

            unique_clusters = sorted(set(labels) - {-1})
            n_clusters    = len(unique_clusters)
            n_noise       = int(np.sum(labels == -1))

            sizes, centroids = [], []
            true_stop = creeping = moving = 0

            for cid in unique_clusters:
                mask = labels == cid
                pts  = [p for p, m in zip(clean_logs, mask) if m]
                sizes.append(len(pts))

                lats = [p.latitude  for p in pts]
                lons = [p.longitude for p in pts]
                centroids.append((float(np.mean(lats)), float(np.mean(lons))))

                vels   = [vel_map.get(p.log_id, 0.0) for p in pts]
                avg_v  = float(np.mean(vels)) if vels else 0.0
                ctype  = classify_cluster_type(avg_v)
                if ctype == "TRUE_STOP":       true_stop  += 1
                elif ctype == "CREEPING_QUEUE": creeping   += 1
                else:                           moving     += 1

            # Centroid spread — mean pairwise Haversine distance between centroids
            spread_m = 0.0
            if len(centroids) >= 2:
                dists = []
                for i in range(len(centroids)):
                    for j in range(i + 1, len(centroids)):
                        dists.append(haversine_distance(
                            centroids[i][0], centroids[i][1],
                            centroids[j][0], centroids[j][1],
                        ))
                spread_m = round(float(np.mean(dists)), 1)

            results.append({
                "eps_m":               eps_m,
                "min_samples":         minpts,
                "cluster_count":       n_clusters,
                "noise_points":        n_noise,
                "dbscan_input":        dbscan_input,
                "avg_cluster_size":    round(float(np.mean(sizes)), 1) if sizes else 0.0,
                "centroid_spread_m":   spread_m,
                "true_stop_count":     true_stop,
                "creeping_queue_count": creeping,
                "moving_count":        moving,
                "noise_ratio":         round(noise_ratio, 4),
            })

    return results
