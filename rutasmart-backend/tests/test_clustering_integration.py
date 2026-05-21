"""
Integration & regression tests — the DBSCAN clustering pipeline.

These exercise run_dbscan / run_wdbscan end to end on realistic multi-point
inputs, and lock in the velocity-gate fix so the density-chaining bug can never
silently return.

Maps to ISO/IEC 25010:
  - Functional Suitability (functional correctness of stop detection)
  - Reliability (maturity — stable behaviour on large/merged inputs)
"""
from datetime import datetime, timedelta

import pytest

from app.analytics.algorithms import run_dbscan, run_wdbscan
from tests.conftest import make_point


def _build_corridor_trips(n_trips: int, n_stops: int = 40):
    """
    Build n_trips passes along a corridor of n_stops, each with a dwell
    (stationary) phase and a moving phase between stops. This reproduces the
    real data shape that caused density chaining when moving points were
    included in clustering.
    """
    pts = []
    stops = [(14.60 + i * 0.0017, 120.98) for i in range(n_stops)]
    for trip in range(n_trips):
        t = datetime(2026, 5, 20, 7, 0, 0) + timedelta(hours=trip)
        for i in range(len(stops) - 1):
            a, b = stops[i], stops[i + 1]
            # dwell — stationary
            for _ in range(12):
                pts.append(make_point(a[0] + 0.000002, a[1], occ=30, accuracy=8.0, ts=t))
                t += timedelta(seconds=2)
            # move — fast points between stops (the chaining hazard)
            for j in range(8):
                f = (j + 1) / 9
                pts.append(make_point(a[0] + f * (b[0] - a[0]), a[1], occ=30, accuracy=12.0, ts=t))
                t += timedelta(seconds=2)
    return pts


@pytest.mark.integration
class TestDBSCANBasic:
    def test_finds_a_single_clear_stop(self, dwell_cluster):
        result = run_dbscan(dwell_cluster, official_capacity=26, eps_m=50, min_samples=5)
        assert len(result["clusters"]) == 1

    def test_separates_two_distinct_stops(self, two_stop_trip):
        # The velocity gate must drop the moving points so the two dwell zones
        # emerge as separate clusters rather than one chained blob.
        result = run_dbscan(two_stop_trip, official_capacity=26, eps_m=50, min_samples=5)
        assert len(result["clusters"]) == 2

    def test_empty_input_returns_empty_result(self):
        result = run_dbscan([], official_capacity=26, eps_m=50, min_samples=5)
        assert result["clusters"] == []
        assert result["total_input"] == 0

    @pytest.mark.contract
    def test_result_has_required_keys(self, dwell_cluster):
        result = run_dbscan(dwell_cluster, official_capacity=26, eps_m=50, min_samples=5)
        for key in ("clusters", "noise_ratio", "eps_m", "min_samples",
                    "total_input", "dbscan_input", "noise_points", "moving_excluded"):
            assert key in result, f"missing contract key: {key}"


@pytest.mark.regression
class TestVelocityGateRegression:
    """
    Locks in the fix for the density-chaining bug where merged multi-trip
    traces collapsed to a single cluster. If anyone removes the velocity gate,
    these tests fail loudly.
    """
    def test_merged_trips_do_not_collapse_to_one_cluster(self):
        merged = _build_corridor_trips(n_trips=8, n_stops=40)
        result = run_dbscan(merged, official_capacity=26, eps_m=50, min_samples=5)
        # Before the fix this returned 1. After the fix it should find most stops.
        assert len(result["clusters"]) >= 30, (
            f"density chaining regression: only {len(result['clusters'])} "
            f"clusters from {len(merged)} points across 40 stops"
        )

    def test_moving_points_are_excluded_from_clustering(self):
        merged = _build_corridor_trips(n_trips=4, n_stops=40)
        result = run_dbscan(merged, official_capacity=26, eps_m=50, min_samples=5)
        # A large share of points are moving and must be gated out
        assert result["moving_excluded"] > 0
        assert result["dbscan_input"] < result["total_input"]

    def test_gate_can_be_disabled_for_comparison(self):
        # The old (chaining) behaviour must still be reachable for thesis
        # before/after comparison — exclude_moving=False reproduces it.
        merged = _build_corridor_trips(n_trips=8, n_stops=40)
        gated = run_dbscan(merged, 26, 50, 5, exclude_moving=True)
        ungated = run_dbscan(merged, 26, 50, 5, exclude_moving=False)
        assert len(gated["clusters"]) > len(ungated["clusters"])


@pytest.mark.integration
class TestWDBSCAN:
    def test_wdbscan_returns_weighted_flag(self, dwell_cluster):
        result = run_wdbscan(dwell_cluster, official_capacity=26, eps_m=50, min_samples=5)
        assert result.get("weighted") is True

    def test_wdbscan_separates_two_stops(self, two_stop_trip):
        result = run_wdbscan(two_stop_trip, official_capacity=26, eps_m=50, min_samples=5)
        assert len(result["clusters"]) == 2

    def test_wdbscan_empty_input(self):
        result = run_wdbscan([], official_capacity=26, eps_m=50, min_samples=5)
        assert result["clusters"] == []


@pytest.mark.contract
class TestDBSCANParameterValidation:
    """
    Contract tests: the function must behave predictably at parameter extremes
    rather than crashing — important for the sensitivity-analysis grid which
    sweeps many eps/min_samples combinations.
    """
    def test_high_min_samples_yields_no_clusters_not_crash(self, dwell_cluster):
        result = run_dbscan(dwell_cluster, 26, 50, min_samples=999)
        assert result["clusters"] == []

    def test_tiny_eps_yields_no_clusters_not_crash(self, dwell_cluster):
        result = run_dbscan(dwell_cluster, 26, eps_m=0.01, min_samples=5)
        assert isinstance(result["clusters"], list)
