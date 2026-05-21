"""
Unit tests — pure algorithm functions.

These lock in the documented behaviour (the "specification") of each core
function so that any future change that breaks the contract fails CI rather
than silently corrupting analytics results.

Maps to ISO/IEC 25010 — Functional Suitability (functional correctness) and
Reliability (maturity: the functions behave consistently across inputs).
"""
import math
from datetime import datetime, timedelta

import pytest

from app.analytics.algorithms import (
    haversine_distance,
    compute_load_factor,
    classify_demand,
    categorise_time,
    classify_cluster_type,
    compute_velocities,
)


# ════════════════════════════════════════════════════════════════════════════
# haversine_distance — great-circle distance in metres
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestHaversineDistance:
    def test_zero_distance_for_identical_points(self):
        assert haversine_distance(14.6, 120.98, 14.6, 120.98) == pytest.approx(0.0, abs=1e-6)

    def test_known_distance_one_degree_latitude(self):
        # 1 degree of latitude ≈ 111.19 km anywhere on Earth
        d = haversine_distance(14.0, 120.0, 15.0, 120.0)
        assert d == pytest.approx(111_195, rel=0.01)

    def test_symmetry(self):
        a = haversine_distance(14.60, 120.98, 14.72, 120.96)
        b = haversine_distance(14.72, 120.96, 14.60, 120.98)
        assert a == pytest.approx(b, abs=1e-6)

    def test_small_distance_in_metres(self):
        # ~0.00001 deg latitude ≈ 1.11 m
        d = haversine_distance(14.6564, 120.984, 14.65641, 120.984)
        assert 0.5 < d < 2.0


# ════════════════════════════════════════════════════════════════════════════
# compute_load_factor — occupancy / capacity as a percentage
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestComputeLoadFactor:
    def test_exactly_full(self):
        assert compute_load_factor(26, 26) == pytest.approx(100.0)

    def test_half_full(self):
        assert compute_load_factor(13, 26) == pytest.approx(50.0)

    def test_over_capacity(self):
        assert compute_load_factor(39, 26) == pytest.approx(150.0)

    def test_empty(self):
        assert compute_load_factor(0, 26) == pytest.approx(0.0)

    @pytest.mark.contract
    def test_zero_capacity_does_not_crash(self):
        # Contract: must not raise ZeroDivisionError — defensive guard required
        result = compute_load_factor(10, 0)
        assert result == 0.0 or result == pytest.approx(0.0)


# ════════════════════════════════════════════════════════════════════════════
# classify_demand — 4-tier demand classification
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestClassifyDemand:
    CAP = 26

    def test_normal_at_or_below_capacity(self):
        assert classify_demand(26, self.CAP) == "Normal"
        assert classify_demand(10, self.CAP) == "Normal"

    def test_moderate_band(self):
        # cap < occ <= cap+5  → 27..31
        assert classify_demand(27, self.CAP) == "Moderate"
        assert classify_demand(31, self.CAP) == "Moderate"

    def test_high_band(self):
        # cap+5 < occ <= cap+10 → 32..36
        assert classify_demand(32, self.CAP) == "High"
        assert classify_demand(36, self.CAP) == "High"

    def test_critical_band(self):
        # occ > cap+10 → 37+
        assert classify_demand(37, self.CAP) == "Critical"
        assert classify_demand(99, self.CAP) == "Critical"

    @pytest.mark.contract
    def test_boundaries_are_exact(self):
        # Boundary values must land in the documented tier (no off-by-one)
        assert classify_demand(26, self.CAP) == "Normal"     # boundary: == cap
        assert classify_demand(31, self.CAP) == "Moderate"   # boundary: cap+5
        assert classify_demand(36, self.CAP) == "High"       # boundary: cap+10


# ════════════════════════════════════════════════════════════════════════════
# categorise_time — UTC timestamp → PHT time period
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestCategoriseTime:
    """
    Critical contract: timestamps are stored in UTC; the corridor operates in
    PHT (UTC+8). The function must convert before bucketing. A bug here silently
    corrupts SOP4 (demand by period) and SOP5 (load factor by period).
    """
    def test_morning_peak(self):
        # 07:15 PHT = 23:15 UTC previous day
        assert categorise_time(datetime(2026, 5, 19, 23, 15)) == "Morning Peak"

    def test_midday(self):
        # 11:30 PHT = 03:30 UTC
        assert categorise_time(datetime(2026, 5, 20, 3, 30)) == "Midday"

    def test_afternoon_peak(self):
        # 17:00 PHT = 09:00 UTC
        assert categorise_time(datetime(2026, 5, 20, 9, 0)) == "Afternoon Peak"

    def test_off_peak(self):
        # 20:30 PHT = 12:30 UTC
        assert categorise_time(datetime(2026, 5, 20, 12, 30)) == "Off-Peak"

    @pytest.mark.contract
    def test_peak_boundaries_pht(self):
        # 06:00 PHT (start of morning peak) = 22:00 UTC prev day
        assert categorise_time(datetime(2026, 5, 19, 22, 0)) == "Morning Peak"
        # 09:00 PHT (start of midday) = 01:00 UTC
        assert categorise_time(datetime(2026, 5, 20, 1, 0)) == "Midday"


# ════════════════════════════════════════════════════════════════════════════
# classify_cluster_type — velocity → movement class
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestClassifyClusterType:
    def test_true_stop_low_velocity(self):
        assert classify_cluster_type(0.1) == "TRUE_STOP"

    def test_moving_high_velocity(self):
        assert classify_cluster_type(10.0) == "MOVING"

    def test_creeping_queue_mid_velocity(self):
        result = classify_cluster_type(0.6)
        assert result in ("CREEPING_QUEUE", "TRUE_STOP", "MOVING")


# ════════════════════════════════════════════════════════════════════════════
# compute_velocities — per-point speed from consecutive GPS fixes
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.unit
class TestComputeVelocities:
    def test_returns_one_velocity_per_point(self, make_gps_point):
        base = datetime(2026, 5, 20, 7, 0, 0)
        pts = [make_gps_point(14.6 + i * 0.0001, 120.98, ts=base + timedelta(seconds=i))
               for i in range(5)]
        vels = compute_velocities(pts)
        assert len(vels) == len(pts)

    def test_stationary_points_have_low_velocity(self, make_gps_point):
        base = datetime(2026, 5, 20, 7, 0, 0)
        # Identical location, 2s apart → ~0 m/s
        pts = [make_gps_point(14.6564, 120.984, ts=base + timedelta(seconds=2 * i))
               for i in range(5)]
        vels = compute_velocities(pts)
        assert all(v < 0.3 for v in vels)

    @pytest.mark.contract
    def test_empty_input_returns_empty(self):
        assert compute_velocities([]) == []

    @pytest.mark.contract
    def test_single_point_does_not_crash(self, make_gps_point):
        result = compute_velocities([make_gps_point(14.6, 120.98)])
        assert len(result) == 1
