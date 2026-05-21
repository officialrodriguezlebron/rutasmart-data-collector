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


# ── 2. Kalman Filter pre-smoothing (Stage 3.5 of pipeline) ────────────────────
#
# Enhanced Pipeline addition (Chapter 3 revision):
#   - Kalman Filter        — GPS trace smoothing before DBSCAN
#   - W-DBSCAN             — Weighted DBSCAN using occupancy as density weight

def kalman_smooth(points: "List[GPSPoint]") -> "List[GPSPoint]":
    """
    Apply a 2D constant-velocity Kalman Filter to a time-ordered list of GPS points.
    Returns new GPSPoint objects with smoothed lat/lon; all other fields preserved.

    Only applied to GOOD and ACCEPTABLE quality logs. POOR logs are passed
    through unchanged (they are excluded from DBSCAN regardless of smoothing).

    The filter runs forward-only (causal) — suitable for real-time use.
    For post-trip analytics a Kalman smoother (RTS smoother) would give better
    results but requires the full trajectory; causal filter is used here for
    consistency with the streaming data model.
    """
    if len(points) < 2:
        return points

    import copy

    # Degrees-to-metres conversion at Manila latitude (~14.65°N)
    # Used to convert state in metres back to degrees for output
    LAT_M_PER_DEG = 111_320.0                              # ~constant
    LON_M_PER_DEG = 111_320.0 * math.cos(math.radians(14.65))

    def deg_to_m(lat_deg, lon_deg, ref_lat, ref_lon):
        return (
            (lat_deg - ref_lat) * LAT_M_PER_DEG,
            (lon_deg - ref_lon) * LON_M_PER_DEG,
        )

    def m_to_deg(dy, dx, ref_lat, ref_lon):
        return (
            ref_lat + dy / LAT_M_PER_DEG,
            ref_lon + dx / LON_M_PER_DEG,
        )

    # Reference origin — first point
    ref_lat = points[0].latitude
    ref_lon = points[0].longitude

    # State: [y (m), x (m), vy (m/s), vx (m/s)]
    dt = 3.0  # seconds between GPS logs (nominal interval)

    # State transition matrix (constant velocity)
    F = np.array([
        [1, 0, dt, 0 ],
        [0, 1, 0,  dt],
        [0, 0, 1,  0 ],
        [0, 0, 0,  1 ],
    ], dtype=float)

    # Measurement matrix (we observe lat, lon → y, x)
    H = np.array([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
    ], dtype=float)

    # Process noise covariance (acceleration uncertainty)
    sigma_a = 0.3  # m/s²
    G = np.array([[0.5*dt**2], [0.5*dt**2], [dt], [dt]])
    Q = sigma_a**2 * G @ G.T

    # Initial state
    y0, x0 = deg_to_m(points[0].latitude, points[0].longitude, ref_lat, ref_lon)
    state = np.array([[y0], [x0], [0.0], [0.0]])

    # Initial covariance — high uncertainty
    P = np.eye(4) * 100.0

    smoothed = []
    for pt in points:
        # Measurement noise from GPS accuracy (1σ)
        sigma_r = pt.accuracy if pt.gps_quality_flag != "POOR" else 200.0
        R = np.eye(2) * sigma_r**2

        # Predict
        state = F @ state
        P     = F @ P @ F.T + Q

        # Measurement
        y_m, x_m = deg_to_m(pt.latitude, pt.longitude, ref_lat, ref_lon)
        z = np.array([[y_m], [x_m]])

        # Update
        S = H @ P @ H.T + R
        K = P @ H.T @ np.linalg.inv(S)
        state = state + K @ (z - H @ state)
        P     = (np.eye(4) - K @ H) @ P

        # Convert smoothed state back to degrees
        sm_lat, sm_lon = m_to_deg(float(state[0, 0]), float(state[1, 0]), ref_lat, ref_lon)

        new_pt = copy.copy(pt)
        # Only update position for GOOD/ACCEPTABLE; leave POOR as-is
        if pt.gps_quality_flag != "POOR":
            new_pt.latitude  = sm_lat
            new_pt.longitude = sm_lon
        smoothed.append(new_pt)

    return smoothed


# ── 6. W-DBSCAN — Weighted DBSCAN (occupancy as density weight) ──────────────
#
# Standard DBSCAN treats every GPS log equally. A point where the jeepney had
# 2 passengers counts the same as a point where it had 24. This means a brief
# idle with empty seats can form a cluster that "competes" with a genuine
# high-demand boarding zone.
#
# W-DBSCAN addresses this by replicating each point proportional to its
# occupancy_count before running DBSCAN. A log with occupancy=20 contributes
# 20 copies to the density estimate; occupancy=2 contributes only 2 copies.
#
# Effect on clustering:
#   - High-occupancy dwell zones → stronger cluster signal → more stable centroids
#   - Low-occupancy idling at red lights → weaker signal → may not form cluster
#   - Centroid position shifts toward the highest-occupancy point in the zone
#     (i.e., where the most passengers were present, not just where vehicle stopped)
#
# Implementation note (sklearn compatibility):
#   sklearn DBSCAN does not support sample weights natively. We use point
#   replication — each point is duplicated floor(occupancy/scale) times.
#   This is a well-documented technique for weighted density estimation
#   (Ankerst et al., 1999; Ester et al., 1996 extended).
#
#   scale = median_occupancy // 2 to keep the replicated dataset manageable.
#   After DBSCAN, cluster assignments are mapped back to original points only
#   (replicated copies are discarded).

def run_wdbscan(
    points: "List[GPSPoint]",
    official_capacity: int,
    eps_m: float = 50.0,
    min_samples: int = 5,
    weight_scale: int = None,
) -> dict:
    """
    Weighted DBSCAN — occupancy-weighted stop cluster detection.

    Improves upon vanilla DBSCAN by giving higher-occupancy GPS logs more
    influence on cluster formation. The result is that detected stop zones
    correspond to actual high-demand boarding locations, not just any
    position where the vehicle spent time.

    Parameters
    ----------
    points            : GPS logs for one trip
    official_capacity : jeepney capacity (for LF computation)
    eps_m             : cluster radius in metres (same as Task A default: 50m)
    min_samples       : minimum cluster density (default 5)
    weight_scale      : occupancy divisor for replication (auto if None)

    Returns
    -------
    Same structure as run_dbscan() for drop-in compatibility.
    Adds 'weighted': True to distinguish from vanilla DBSCAN results.
    """
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    total_input = len(points)
    if total_input == 0:
        return {**_empty_result(eps_m, min_samples), "weighted": True}

    # Filter POOR logs (same as vanilla DBSCAN)
    poor_logs  = [p for p in points if p.gps_quality_flag == "POOR"]
    clean_logs = [p for p in points if p.gps_quality_flag != "POOR"]
    noise_ratio = len(poor_logs) / total_input

    if len(clean_logs) < min_samples:
        return {**_empty_result(eps_m, min_samples,
                               total_input=total_input,
                               noise_ratio=noise_ratio), "weighted": True}

    # ── Velocity gate (same rationale as run_dbscan) ─────────────────────────
    # Exclude MOVING points (>1.0 m/s) before clustering to prevent the
    # density-chaining that collapses dense / merged traces into one cluster.
    clean_sorted_pre = sorted(clean_logs, key=lambda p: p.timestamp)
    vel_pre = {
        p.log_id: v
        for p, v in zip(clean_sorted_pre, compute_velocities(clean_sorted_pre))
    }
    MOVING_THRESHOLD_MS = 1.0
    gated = [p for p in clean_logs if vel_pre.get(p.log_id, 0.0) <= MOVING_THRESHOLD_MS]
    if len(gated) >= min_samples:
        clean_logs = gated

    # Determine weight scale from data
    occs = [p.occupancy_count for p in clean_logs]
    median_occ = float(np.median(occs)) if occs else 1.0
    if weight_scale is None:
        weight_scale = max(1, int(median_occ) // 2)  # replicate ~2× at median

    # Build replicated dataset
    replicated_pts   = []   # GPSPoint objects (originals + copies)
    original_indices = []   # which original point each replicated entry came from

    for idx, pt in enumerate(clean_logs):
        # Number of copies = occupancy / scale, minimum 1
        copies = max(1, int(pt.occupancy_count / weight_scale))
        for _ in range(copies):
            replicated_pts.append(pt)
            original_indices.append(idx)

    coords = np.radians(
        np.array([[p.latitude, p.longitude] for p in replicated_pts])
    )
    eps_rad = eps_m / EARTH_RADIUS_M

    db = SKLearnDBSCAN(
        eps=eps_rad,
        min_samples=min_samples,
        metric="haversine",
        algorithm="ball_tree",
        n_jobs=-1,
    )
    db.fit(coords)
    labels = db.labels_

    # Map cluster labels back to ORIGINAL points only
    # Original point idx → most common label among its replicated copies
    orig_label_votes = [[] for _ in range(len(clean_logs))]
    for replicated_label, orig_idx in zip(labels, original_indices):
        orig_label_votes[orig_idx].append(replicated_label)

    # Assign each original point the most-voted label
    orig_labels = []
    for votes in orig_label_votes:
        if not votes:
            orig_labels.append(-1)
        else:
            # -1 (noise) only wins if all copies were noise
            non_noise = [v for v in votes if v != -1]
            orig_labels.append(
                max(set(non_noise), key=non_noise.count) if non_noise else -1
            )

    # Compute velocities on clean_logs for cluster type classification
    clean_sorted = sorted(clean_logs, key=lambda p: p.timestamp)
    vel_map = {
        p.log_id: v
        for p, v in zip(clean_sorted, compute_velocities(clean_sorted))
    }

    dbscan_noise_count = int(sum(1 for l in orig_labels if l == -1))
    clusters: List[StopCluster] = []

    for cid in sorted(set(orig_labels) - {-1}):
        cluster_pts = [p for p, l in zip(clean_logs, orig_labels) if l == cid]

        lats  = [p.latitude  for p in cluster_pts]
        lons  = [p.longitude for p in cluster_pts]
        occs  = [p.occupancy_count for p in cluster_pts]
        times = [p.timestamp for p in cluster_pts]

        # Occupancy-weighted centroid — stops where more passengers were present
        # contribute more to the centroid position
        total_occ    = sum(occs) or 1
        centroid_lat = float(sum(la * o for la, o in zip(lats, occs)) / total_occ)
        centroid_lon = float(sum(lo * o for lo, o in zip(lons, occs)) / total_occ)

        avg_occ = float(np.mean(occs))
        max_occ = int(np.max(occs))
        lf_pct  = (avg_occ / official_capacity * 100) if official_capacity > 0 else 0.0

        demand_tier = classify_demand(max_occ, official_capacity)
        peak_period = _most_common_period([categorise_time(t) for t in times])

        member_velocities = [vel_map.get(p.log_id, 0.0) for p in cluster_pts]
        avg_vel = float(np.mean(member_velocities)) if member_velocities else 0.0
        c_type  = classify_cluster_type(avg_vel)

        clusters.append(StopCluster(
            cluster_id=int(cid),
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
        "noise_points": dbscan_noise_count,
        "weighted":     True,
        "weight_scale": weight_scale,
    }


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
    apply_kalman: bool = False,
    exclude_moving: bool = True,
) -> dict:
    """
    Run DBSCAN on a list of GPSPoint records.

    POOR logs are filtered before clustering but counted so the noise_ratio
    can be reported. POOR logs' occupancy data is preserved in the
    load-factor and demand calculations, which operate on ALL logs.

    Velocity gating (exclude_moving)
    --------------------------------
    When exclude_moving is True (default), GPS points with velocity above the
    MOVING threshold (>1.0 m/s) are excluded from the spatial clustering input.
    Stops are, by definition, where the jeepney is stationary or creeping — the
    moving-segment points between stops add no stop information and, on dense
    or merged multi-trip traces, chain adjacent stops into one giant cluster
    (the classic DBSCAN density-chaining problem). Gating on velocity isolates
    the dwell points so DBSCAN can separate genuine stops. Excluded moving
    points are still counted for occupancy, load-factor, and demand metrics,
    which depend on passenger count and time, not position.

    Parameters
    ----------
    points            : GPS logs for one trip (already fetched from DB)
    official_capacity : jeepney's official seating capacity
    eps_m             : cluster radius in metres (default 50m per blueprint)
    min_samples       : minimum cluster density (default 5 per blueprint)
    apply_kalman      : if True, apply Kalman Filter smoothing before DBSCAN
                        (Stage 3.5 of pipeline — reduces centroid jitter)
    exclude_moving    : if True, exclude MOVING (>1.0 m/s) points from the
                        clustering input to prevent density chaining
    """
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    total_input = len(points)
    if total_input == 0:
        return _empty_result(eps_m, min_samples)

    # ── Stage 3.5 (optional): Kalman Filter smoothing ────────────────────────
    if apply_kalman:
        points = kalman_smooth(points)

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

    # ── Velocity gate: exclude MOVING points from clustering input ───────────
    # Moving-segment points (>1.0 m/s) bridge adjacent stops and chain them
    # into one cluster on dense / merged traces. We cluster only the dwell
    # points (stationary + creeping queue). If gating would leave too few
    # points to cluster (e.g. a very short or fast trip), fall back to using
    # all clean points so we never return an empty result spuriously.
    MOVING_THRESHOLD_MS = 1.0
    moving_excluded = 0
    cluster_logs = clean_logs
    if exclude_moving:
        gated = [p for p in clean_logs
                 if velocities_map.get(p.log_id, 0.0) <= MOVING_THRESHOLD_MS]
        moving_excluded = len(clean_logs) - len(gated)
        if len(gated) >= min_samples:
            cluster_logs = gated
        else:
            # Not enough dwell points — fall back to all clean points
            cluster_logs = clean_logs
            moving_excluded = 0

    # ── Build coordinate matrix (radians for haversine metric) ───────────────
    coords = np.radians(
        np.array([[p.latitude, p.longitude] for p in cluster_logs])
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
        cluster_pts = [p for p, m in zip(cluster_logs, mask) if m]

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
        "clusters":        clusters,
        "noise_ratio":     round(noise_ratio, 4),
        "eps_m":           eps_m,
        "min_samples":     min_samples,
        "total_input":     total_input,
        "dbscan_input":    len(cluster_logs),
        "noise_points":    dbscan_noise_count,   # spatial noise, not POOR logs
        "moving_excluded": moving_excluded,      # MOVING points gated out before clustering
    }


def _empty_result(eps_m, min_samples, total_input=0, noise_ratio=0.0):
    return {
        "clusters":        [],
        "noise_ratio":     noise_ratio,
        "eps_m":           eps_m,
        "min_samples":     min_samples,
        "total_input":     total_input,
        "dbscan_input":    0,
        "noise_points":    0,
        "moving_excluded": 0,
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
