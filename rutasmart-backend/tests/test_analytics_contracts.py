"""
Contract tests — analytics aggregation functions.

Verify the distribution/summary functions return well-formed results that the
API schema and frontend depend on. A broken contract here surfaces as wrong
dashboard numbers, so these guard SOP4 (demand) and SOP5 (load factor).

Maps to ISO/IEC 25010 — Functional Suitability & Reliability.
"""
from datetime import datetime, timedelta

import pytest

from app.analytics.algorithms import (
    classify_demand_distribution,
    time_period_distribution,
    gps_quality_summary,
    trip_load_factor_summary,
)
from tests.conftest import make_point


def _spread_of_points():
    """Points spanning all 4 demand tiers and all 4 time periods."""
    pts = []
    # Morning peak (23:00-01:00 UTC), occupancies across tiers
    base = datetime(2026, 5, 19, 23, 30)
    for occ in (10, 20, 28, 34, 40):  # Normal, Normal, Moderate, High, Critical
        pts.append(make_point(14.6564, 120.984, occ=occ, ts=base))
    # Afternoon peak (09:00-11:00 UTC)
    base = datetime(2026, 5, 20, 9, 30)
    for occ in (15, 30):
        pts.append(make_point(14.6564, 120.984, occ=occ, ts=base))
    return pts


@pytest.mark.contract
class TestDemandDistribution:
    def test_percentages_sum_to_100(self):
        dd = classify_demand_distribution(_spread_of_points(), official_capacity=26)
        total_pct = sum(d["pct"] for d in dd.values())
        assert total_pct == pytest.approx(100.0, abs=0.5)

    def test_all_four_tiers_present(self):
        dd = classify_demand_distribution(_spread_of_points(), official_capacity=26)
        assert set(dd.keys()) == {"Normal", "Moderate", "High", "Critical"}

    def test_counts_are_non_negative_integers(self):
        dd = classify_demand_distribution(_spread_of_points(), official_capacity=26)
        for tier in dd.values():
            assert isinstance(tier["count"], int)
            assert tier["count"] >= 0

    def test_empty_input_does_not_crash(self):
        dd = classify_demand_distribution([], official_capacity=26)
        assert set(dd.keys()) == {"Normal", "Moderate", "High", "Critical"}


@pytest.mark.contract
class TestTimePeriodDistribution:
    def test_all_four_periods_present(self):
        td = time_period_distribution(_spread_of_points())
        assert set(td.keys()) == {"Morning Peak", "Midday", "Afternoon Peak", "Off-Peak"}

    def test_counts_sum_to_total_points(self):
        pts = _spread_of_points()
        td = time_period_distribution(pts)
        assert sum(d["count"] for d in td.values()) == len(pts)


@pytest.mark.contract
class TestGPSQualitySummary:
    def test_counts_sum_to_total(self):
        pts = [
            make_point(14.6564, 120.984, accuracy=10.0),   # GOOD
            make_point(14.6564, 120.984, accuracy=35.0),   # ACCEPTABLE
            make_point(14.6564, 120.984, accuracy=80.0),   # POOR
        ]
        q = gps_quality_summary(pts)
        assert q["good_count"] + q["acceptable_count"] + q["poor_count"] == q["total_logs"]

    def test_dbscan_eligible_excludes_poor(self):
        pts = [
            make_point(14.6564, 120.984, accuracy=10.0),
            make_point(14.6564, 120.984, accuracy=80.0),   # POOR
        ]
        q = gps_quality_summary(pts)
        assert q["dbscan_eligible"] == q["total_logs"] - q["poor_count"]


@pytest.mark.contract
class TestLoadFactorSummary:
    def test_avg_does_not_exceed_max(self):
        pts = [make_point(14.6564, 120.984, occ=o) for o in (10, 20, 30, 40)]
        lf = trip_load_factor_summary(pts, official_capacity=26)
        assert lf["avg_lf"] <= lf["max_lf"]

    def test_known_values(self):
        # All points at occupancy 26 → load factor exactly 100%
        pts = [make_point(14.6564, 120.984, occ=26) for _ in range(5)]
        lf = trip_load_factor_summary(pts, official_capacity=26)
        assert lf["avg_lf"] == pytest.approx(100.0)
        assert lf["max_lf"] == pytest.approx(100.0)
