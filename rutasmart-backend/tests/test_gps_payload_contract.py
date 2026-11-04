"""
Contract tests for the GPS log payload the PWA sends.

These lock in the shape that rutas-frontend/src/utils/deviceId.js now
guarantees, validated against the real Pydantic schema the endpoint uses. No
database, no network: GPSLogCreate is exercised directly.

Background: the browser sends GeolocationPosition.timestamp, a
DOMHighResTimeStamp (a double), into gps_timestamp: Optional[int], and read
device_id with a bare localStorage lookup that could return null. Both
produced HTTP 422 and every GPS log from the recording screen was rejected.
The schema is deliberately unchanged — the client was fixed.
"""
import math

import pytest
from pydantic import ValidationError

from app.schemas.gps_schema import GPSLogCreate

pytestmark = pytest.mark.contract


def payload(**over):
    base = dict(trip_id="2026-11-05_JPN-001_MALANDAY-RECTO_abcd",
                device_id="RS-1A2B3C4D", latitude=14.7187, longitude=120.9570,
                accuracy=8.0, occupancy_count=3, client_seq=1)
    base.update(over)
    return base


def round_like_client(value):
    """Mirror toEpochMillis in rutas-frontend/src/utils/deviceId.js."""
    if value is None:
        return None
    n = float(value)
    if not math.isfinite(n):
        return None
    return round(n)


# ── integer GPS timestamps ───────────────────────────────────────────────────

def test_integer_gps_timestamp_is_accepted():
    log = GPSLogCreate(**payload(gps_timestamp=1793808830123))
    assert log.gps_timestamp == 1793808830123


def test_null_gps_timestamp_is_accepted():
    assert GPSLogCreate(**payload(gps_timestamp=None)).gps_timestamp is None


def test_omitted_gps_timestamp_defaults_to_none():
    body = payload()
    body.pop("gps_timestamp", None)
    assert GPSLogCreate(**body).gps_timestamp is None


# ── fractional timestamps: rejected raw, accepted once rounded ───────────────

def test_raw_fractional_timestamp_is_rejected_by_the_schema():
    """The bug: DOMHighResTimeStamp carries fractional milliseconds."""
    with pytest.raises(ValidationError) as exc:
        GPSLogCreate(**payload(gps_timestamp=1793808830123.456))
    assert "integer" in str(exc.value).lower()


def test_client_rounding_makes_a_fractional_timestamp_valid():
    log = GPSLogCreate(**payload(gps_timestamp=round_like_client(1793808830123.456)))
    assert log.gps_timestamp == 1793808830123


def test_rounding_goes_to_nearest_not_down():
    """Math.floor would bias every timestamp downward by up to 1 ms."""
    assert round_like_client(1793808830123.6) == 1793808830124
    assert round_like_client(1793808830123.4) == 1793808830123


def test_whole_float_timestamp_round_trips_unchanged():
    assert round_like_client(1793808830123.0) == 1793808830123


def test_non_finite_timestamp_becomes_none():
    assert round_like_client(float("nan")) is None
    assert round_like_client(float("inf")) is None


# ── device_id is never null or too short ─────────────────────────────────────

def test_null_device_id_is_rejected():
    with pytest.raises(ValidationError):
        GPSLogCreate(**payload(device_id=None))


def test_empty_device_id_is_rejected():
    with pytest.raises(ValidationError):
        GPSLogCreate(**payload(device_id=""))


def test_short_device_id_is_rejected():
    """Schema requires min_length=3."""
    with pytest.raises(ValidationError):
        GPSLogCreate(**payload(device_id="RS"))


def test_generated_device_id_shape_is_accepted():
    """getOrCreateDeviceId emits RS- plus 8 uppercase hex characters."""
    log = GPSLogCreate(**payload(device_id="RS-1A2B3C4D"))
    assert log.device_id.startswith("RS-")
    assert len(log.device_id) >= 3


# ── the full payload the recording screen now builds ─────────────────────────

def test_recording_payload_validates_end_to_end():
    log = GPSLogCreate(**payload(
        gps_timestamp=round_like_client(1793808830123.456),
        client_seq=7,
        client_online_event_at=None,
    ))
    assert isinstance(log.gps_timestamp, int)
    assert log.client_seq == 7
    assert log.device_id and len(log.device_id) >= 3


def test_client_seq_must_not_be_negative():
    with pytest.raises(ValidationError):
        GPSLogCreate(**payload(client_seq=-1))
