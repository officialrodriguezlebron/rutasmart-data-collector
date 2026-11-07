"""
Regression tests for two-decimal precision in analytics percentages.

Why this exists
---------------
The manuscript reports demand, quality and load-factor figures to two
decimal places: Normal 60.49%, Moderate 15.28%, High 16.03%, Critical
8.20%, quality threshold 96.90%, Afternoon Peak load factor 107.19%.

The serialisation layer previously rounded percentages with round(x, 1),
so the second decimal was discarded before the value ever left the
backend. 60.49 became 60.5 and no amount of frontend formatting could
recover it. The counts were always exact; only the published percentage
was lossy.

These tests pin the two-decimal contract against the real shape of the
official dataset, so the precision cannot silently regress.

Isolation
---------
Pure function tests. No database, no network, no fixtures that touch
rutasmart_db or rutasmart_official_snapshot. The point lists are
synthesised to reproduce the official per-tier counts exactly.
"""
from datetime import datetime

import pytest

from app.analytics.algorithms import (
    GPSPoint,
    classify_demand_distribution,
    gps_quality_summary,
    load_factor_by_period,
    time_period_distribution,
)

pytestmark = pytest.mark.regression

# Official dataset, as reported in the manuscript and confirmed against the
# recovered Railway database on 2026-11-08.
CAPACITY = 26
TOTAL_LOGS = 35_326

TIER_COUNTS = {           # sum == 35,326
    "Normal":   21_369,   # 60.49%
    "Moderate":  5_397,   # 15.28%
    "High":      5_664,   # 16.03%
    "Critical":  2_896,   # 8.20%
}

QUALITY_COUNTS = {        # sum == 35,326
    "GOOD":       29_891,  # 84.61%
    "ACCEPTABLE":  4_339,  # 12.28%
    "POOR":        1_096,  # 3.10%
}

# One occupancy value per tier, chosen so classify_demand lands in that tier
# for CAPACITY = 26: Normal <= 26, Moderate 27-31, High 32-36, Critical > 36.
TIER_OCCUPANCY = {"Normal": 20, "Moderate": 29, "High": 34, "Critical": 40}

PHT_OFFSET_HOURS = 8
# Stored timestamps are UTC; categorise_time bins them to PHT internally.
# 09:00 UTC == 17:00 PHT, which is Afternoon Peak.
AFTERNOON_PEAK_UTC_HOUR = 9


def _point(occupancy, quality="GOOD", hour=AFTERNOON_PEAK_UTC_HOUR, idx=0):
    return GPSPoint(
        log_id="L%06d" % idx,
        latitude=14.7187,
        longitude=120.9570,
        accuracy=8.0,
        gps_quality_flag=quality,
        occupancy_count=occupancy,
        timestamp=datetime(2026, 6, 1, hour, 0, 0),
        trip_id="T-1",
    )


def _official_tier_points():
    """35,326 points reproducing the official per-tier counts exactly."""
    pts, i = [], 0
    for tier, n in TIER_COUNTS.items():
        occ = TIER_OCCUPANCY[tier]
        for _ in range(n):
            pts.append(_point(occ, idx=i))
            i += 1
    return pts


# ── the counts themselves must be right before precision means anything ──

def test_official_tier_counts_sum_to_total():
    assert sum(TIER_COUNTS.values()) == TOTAL_LOGS


def test_official_quality_counts_sum_to_total():
    assert sum(QUALITY_COUNTS.values()) == TOTAL_LOGS


# ── demand distribution ──────────────────────────────────────────────────

def test_demand_distribution_reports_two_decimals():
    """The manuscript's four tier percentages, to the second decimal."""
    dist = classify_demand_distribution(_official_tier_points(), CAPACITY)

    assert dist["Normal"]["count"] == 21_369
    assert dist["Moderate"]["count"] == 5_397
    assert dist["High"]["count"] == 5_664
    assert dist["Critical"]["count"] == 2_896

    assert dist["Normal"]["pct"] == 60.49
    assert dist["Moderate"]["pct"] == 15.28
    assert dist["High"]["pct"] == 16.03
    assert dist["Critical"]["pct"] == 8.20


def test_demand_percentages_are_not_rounded_to_one_decimal():
    """Guards the specific regression: 60.49 must not collapse to 60.5."""
    dist = classify_demand_distribution(_official_tier_points(), CAPACITY)
    assert dist["Normal"]["pct"] != 60.5
    assert dist["Moderate"]["pct"] != 15.3
    assert dist["High"]["pct"] != 16.0


def test_over_capacity_share_is_39_51_percent():
    """Moderate + High + Critical, the manuscript's over-capacity figure."""
    dist = classify_demand_distribution(_official_tier_points(), CAPACITY)
    over = sum(dist[t]["pct"] for t in ("Moderate", "High", "Critical"))
    assert round(over, 2) == 39.51


def test_demand_percentages_sum_to_100():
    dist = classify_demand_distribution(_official_tier_points(), CAPACITY)
    assert round(sum(d["pct"] for d in dist.values()), 2) == 100.00


# ── GPS quality ──────────────────────────────────────────────────────────

def test_gps_quality_reports_two_decimals():
    pts, i = [], 0
    for flag, n in QUALITY_COUNTS.items():
        for _ in range(n):
            pts.append(_point(20, quality=flag, idx=i))
            i += 1

    q = gps_quality_summary(pts)
    assert q["total_logs"] == TOTAL_LOGS
    assert q["good_count"] == 29_891
    assert q["acceptable_count"] == 4_339
    assert q["poor_count"] == 1_096

    assert q["good_pct"] == 84.61
    assert q["acceptable_pct"] == 12.28
    assert q["poor_pct"] == 3.10

    # The manuscript's headline quality figure is GOOD + ACCEPTABLE.
    assert round(q["good_pct"] + q["acceptable_pct"], 2) == 96.89
    met = (q["good_count"] + q["acceptable_count"]) / q["total_logs"] * 100
    assert round(met, 2) == 96.90


def test_gps_quality_not_rounded_to_one_decimal():
    pts, i = [], 0
    for flag, n in QUALITY_COUNTS.items():
        for _ in range(n):
            pts.append(_point(20, quality=flag, idx=i))
            i += 1
    q = gps_quality_summary(pts)
    assert q["good_pct"] != 84.6
    assert q["acceptable_pct"] != 12.3


# ── load factor ──────────────────────────────────────────────────────────

def test_afternoon_peak_load_factor_can_represent_107_19():
    """
    107.19% is the manuscript's Afternoon Peak mean load factor.

    Load factor was already serialised at two decimals, so this test pins
    that contract rather than fixing a regression: it fails if anyone
    reduces the precision to match the old percentage behaviour.

    A mean of 107.19 at capacity 26 needs a mean occupancy of
    107.19 / 100 * 26 = 27.8694. Mixing occupancies of 28 and 27 over
    10,000 points gives mean = 27 + n28/10000, so n28 = 8,694 and
    n27 = 1,306 produce 27.8694 and therefore 107.1900% exactly.
    """
    n28, n27 = 8_694, 1_306
    pts = [_point(28, idx=i) for i in range(n28)]
    pts += [_point(27, idx=n28 + i) for i in range(n27)]

    by_period = load_factor_by_period(pts, CAPACITY)
    ap = by_period["Afternoon Peak"]

    assert ap["log_count"] == n28 + n27
    assert ap["avg_lf"] == 107.19
    assert ap["avg_lf"] != 107.2


def test_load_factor_over_100_is_preserved_not_clamped():
    pts = [_point(40, idx=i) for i in range(10)]
    ap = load_factor_by_period(pts, CAPACITY)["Afternoon Peak"]
    assert ap["avg_lf"] > 100
    assert ap["avg_lf"] == round(40 / CAPACITY * 100, 2)


# ── time-period distribution ─────────────────────────────────────────────

def test_time_distribution_reports_two_decimals():
    """A split that is only distinguishable at the second decimal."""
    pts = [_point(20, hour=AFTERNOON_PEAK_UTC_HOUR, idx=i) for i in range(1_234)]
    pts += [_point(20, hour=0, idx=10_000 + i) for i in range(8_766)]  # 08:00 PHT

    dist = time_period_distribution(pts)
    total = sum(d["count"] for d in dist.values())
    assert total == 10_000

    assert dist["Afternoon Peak"]["count"] == 1_234
    assert dist["Afternoon Peak"]["pct"] == 12.34
    assert dist["Morning Peak"]["count"] == 8_766
    assert dist["Morning Peak"]["pct"] == 87.66


def test_time_distribution_percentages_sum_to_100():
    pts = [_point(20, hour=AFTERNOON_PEAK_UTC_HOUR, idx=i) for i in range(777)]
    pts += [_point(20, hour=0, idx=1_000 + i) for i in range(223)]
    dist = time_period_distribution(pts)
    assert round(sum(d["pct"] for d in dist.values()), 2) == 100.00


# ── empty input must stay safe ───────────────────────────────────────────

def test_empty_inputs_do_not_divide_by_zero():
    assert all(d["pct"] == 0.0 for d in classify_demand_distribution([], CAPACITY).values())
    assert all(d["pct"] == 0.0 for d in time_period_distribution([]).values())
    q = gps_quality_summary([])
    assert q["good_pct"] == 0.0 and q["acceptable_pct"] == 0.0 and q["poor_pct"] == 0.0
