"""
Shared pytest fixtures for the RutaSmart backend test suite.

These fixtures build GPSPoint records the same way the production import and
log endpoints do, so tests exercise the real data shapes the system handles in
the field.
"""
import os
import uuid
from datetime import datetime, timedelta

import pytest

# DATABASE_URL must be set before importing app modules (database.py reads it
# at import time). Tests never touch a real DB — this is a placeholder so the
# SQLAlchemy engine can be constructed without error.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

from app.analytics.algorithms import GPSPoint  # noqa: E402


# ── GPS quality classification (mirrors production import logic) ─────────────
CORRIDOR = dict(lat_min=14.55, lat_max=14.75, lon_min=120.95, lon_max=121.05)


def classify_quality(lat: float, lon: float, accuracy: float) -> str:
    """Replicate the production GPS-quality rule for test data construction."""
    out_of_corridor = not (
        CORRIDOR["lat_min"] <= lat <= CORRIDOR["lat_max"]
        and CORRIDOR["lon_min"] <= lon <= CORRIDOR["lon_max"]
    )
    if out_of_corridor:
        return "POOR"
    if accuracy <= 20:
        return "GOOD"
    if accuracy <= 50:
        return "ACCEPTABLE"
    return "POOR"


def make_point(lat, lon, occ=10, accuracy=10.0, ts=None, quality=None, trip_id="T1"):
    """Construct a single GPSPoint with sensible defaults for tests."""
    if ts is None:
        ts = datetime(2026, 5, 20, 7, 0, 0)
    return GPSPoint(
        log_id=str(uuid.uuid4()),
        latitude=lat,
        longitude=lon,
        accuracy=accuracy,
        gps_quality_flag=quality or classify_quality(lat, lon, accuracy),
        occupancy_count=occ,
        timestamp=ts,
        trip_id=trip_id,
    )


@pytest.fixture
def make_gps_point():
    """Factory fixture so tests can build points inline."""
    return make_point


@pytest.fixture
def dwell_cluster():
    """
    A realistic stop: 10 GPS points clustered tightly at one location with
    near-zero movement (a jeepney dwelling at a stop). Timestamps 2s apart.
    """
    base_ts = datetime(2026, 5, 20, 7, 0, 0)
    pts = []
    for i in range(10):
        pts.append(
            make_point(
                lat=14.6564 + (i * 0.000003),  # ~0.3m jitter
                lon=120.9840 + (i * 0.000003),
                occ=30,
                accuracy=8.0,
                ts=base_ts + timedelta(seconds=2 * i),
            )
        )
    return pts


@pytest.fixture
def two_stop_trip():
    """
    A minimal but realistic trip: dwell at stop A, move to stop B, dwell at B.
    Two genuine stops separated by ~1.5km with moving points between them.
    Used to verify the velocity gate separates stops correctly.
    """
    base = datetime(2026, 5, 20, 7, 0, 0)
    pts = []
    t = base
    # Dwell at stop A (Recto area)
    for i in range(10):
        pts.append(make_point(14.6037 + i * 0.000003, 120.9830, occ=15, accuracy=8.0, ts=t))
        t += timedelta(seconds=2)
    # Move toward stop B (12 fast-moving points covering ~1.5km)
    for j in range(12):
        f = (j + 1) / 13
        pts.append(make_point(14.6037 + f * 0.0135, 120.9830, occ=15, accuracy=12.0, ts=t))
        t += timedelta(seconds=3)
    # Dwell at stop B
    for i in range(10):
        pts.append(make_point(14.6172 + i * 0.000003, 120.9830, occ=22, accuracy=8.0, ts=t))
        t += timedelta(seconds=2)
    return pts
