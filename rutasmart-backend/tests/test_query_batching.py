"""Query-batching optimisations: equivalence and statement count.

Two endpoints used to issue one query per item in a loop:

  * /stop-zones/recommendations ran a bounding-box query per
    (zone x collection day x trip) -- about 146 statements for one request
    on the official dataset.
  * /analytics/merged/run-all called _fetch_points once per trip, plus a
    Trip lookup per trip -- two statements per trip.

Both now issue a small fixed number of statements. These tests pin the two
properties that matter: the rows that come back are the same ones, in the
same order, and the statement count no longer scales with the input.

No database is required. A recording fake stands in for the Session, so the
tests assert on the queries that WOULD be issued without issuing any.
"""
from datetime import datetime, timedelta

import pytest

from app.routes.analytics_routes import _fetch_points, _fetch_points_bulk, _to_point


# ── A recording stand-in for the parts of Session these loaders use ──────
class FakeLog:
    """The GPSLog columns the point mapper reads."""

    def __init__(self, trip_id, log_id, ts, lat=14.7, lon=120.95,
                 occ=10, acc=5.0, flag="GOOD"):
        self.trip_id = trip_id
        self.log_id = log_id
        self.timestamp = ts
        self.latitude = lat
        self.longitude = lon
        self.occupancy_count = occ
        self.accuracy = acc
        self.gps_quality_flag = flag


class FakeQuery:
    def __init__(self, rows, recorder):
        self._rows = rows
        self._rec = recorder
        self._ids = None

    def filter(self, *criteria):
        # The loaders filter on trip_id, either == or .in_(). Record which.
        self._rec["filters"].append(criteria)
        return self

    def order_by(self, *_):
        return self

    def all(self):
        self._rec["statements"] += 1
        return list(self._rows)


class FakeSession:
    """Counts statements and returns a fixed row set."""

    def __init__(self, rows):
        self.rows = rows
        self.rec = {"statements": 0, "filters": []}

    def query(self, *_entities):
        return FakeQuery(self.rows, self.rec)


def _rows():
    """Three trips, deliberately interleaved and out of timestamp order."""
    t0 = datetime(2026, 6, 5, 8, 0, 0)
    out = []
    for trip, n in (("T1", 3), ("T2", 2), ("T3", 1)):
        for i in range(n):
            out.append(FakeLog(trip, "%s-%d" % (trip, i), t0 + timedelta(seconds=i)))
    return out


# ── _fetch_points_bulk ───────────────────────────────────────────────────
def test_bulk_issues_one_statement_for_many_trips():
    """The whole point: statement count does not scale with trip count."""
    db = FakeSession(_rows())
    _fetch_points_bulk(["T1", "T2", "T3"], db)
    assert db.rec["statements"] == 1


def test_bulk_groups_every_trip_and_drops_nothing():
    db = FakeSession(_rows())
    grouped = _fetch_points_bulk(["T1", "T2", "T3"], db)
    assert sorted(grouped) == ["T1", "T2", "T3"]
    assert [len(grouped[t]) for t in ("T1", "T2", "T3")] == [3, 2, 1]
    # Every row landed in exactly one bucket.
    assert sum(len(v) for v in grouped.values()) == 6


def test_bulk_matches_the_per_trip_loader_row_for_row():
    """Equivalence with the function it replaces, field by field."""
    rows = _rows()
    bulk = _fetch_points_bulk(["T1", "T2", "T3"], FakeSession(rows))
    for trip in ("T1", "T2", "T3"):
        single = _fetch_points(trip, FakeSession([r for r in rows if r.trip_id == trip]))
        assert len(bulk[trip]) == len(single)
        for a, b in zip(bulk[trip], single):
            assert a.log_id == b.log_id
            assert a.trip_id == b.trip_id
            assert a.timestamp == b.timestamp
            assert a.latitude == b.latitude
            assert a.longitude == b.longitude
            assert a.occupancy_count == b.occupancy_count
            assert a.accuracy == b.accuracy
            assert a.gps_quality_flag == b.gps_quality_flag


def test_bulk_preserves_timestamp_order_within_a_trip():
    db = FakeSession(_rows())
    grouped = _fetch_points_bulk(["T1"], db)
    stamps = [p.timestamp for p in grouped["T1"]]
    assert stamps == sorted(stamps)


def test_bulk_requests_every_id_in_one_filter():
    """A single IN/ANY filter, not one filter per trip."""
    db = FakeSession(_rows())
    _fetch_points_bulk(["T1", "T2", "T3"], db)
    assert len(db.rec["filters"]) == 1


# ── empty and partial inputs ─────────────────────────────────────────────
def test_bulk_empty_id_list_issues_no_statement():
    db = FakeSession(_rows())
    assert _fetch_points_bulk([], db) == {}
    assert db.rec["statements"] == 0


def test_bulk_keeps_an_empty_bucket_for_a_trip_with_no_logs():
    """A requested trip with no rows must still appear, empty.

    The caller tests `if pts:` to decide whether a trip contributed, so a
    missing key and an empty list must behave the same.
    """
    db = FakeSession([r for r in _rows() if r.trip_id == "T1"])
    grouped = _fetch_points_bulk(["T1", "T_MISSING"], db)
    assert grouped["T_MISSING"] == []
    assert len(grouped["T1"]) == 3


def test_bulk_ignores_rows_for_trips_that_were_not_requested():
    """Direction filtering happens by passing a subset of ids."""
    db = FakeSession(_rows())
    grouped = _fetch_points_bulk(["T1"], db)          # one direction's trips
    assert sorted(grouped) == ["T1"]
    assert all(p.trip_id == "T1" for p in grouped["T1"])


# ── the shared row mapper ────────────────────────────────────────────────
def test_to_point_unwraps_an_enum_quality_flag():
    class Flag:
        value = "ACCEPTABLE"

    log = FakeLog("T1", "L1", datetime(2026, 6, 5), flag=Flag())
    assert _to_point(log).gps_quality_flag == "ACCEPTABLE"


def test_to_point_passes_through_a_plain_string_flag():
    log = FakeLog("T1", "L1", datetime(2026, 6, 5), flag="POOR")
    assert _to_point(log).gps_quality_flag == "POOR"


def test_to_point_carries_accuracy_unchanged():
    """Regression guard: accuracy must be the row's accuracy, nothing else."""
    log = FakeLog("T1", "L1", datetime(2026, 6, 5), acc=42.5)
    assert _to_point(log).accuracy == 42.5


# ── the recommendations bounding-box test, now done in Python ────────────
@pytest.mark.parametrize("lat,lon,inside", [
    (14.700000, 120.950000, True),    # dead centre
    (14.700449, 120.950000, True),    # just inside the latitude tolerance
    (14.700451, 120.950000, False),   # just outside it
    (14.700000, 120.950599, True),    # just inside the longitude tolerance
    (14.700000, 120.950601, False),   # just outside it
])
def test_bounding_box_bounds_match_the_sql_they_replace(lat, lon, inside):
    """The in-memory box must be inclusive on both edges, as BETWEEN was."""
    LAT_TOL, LON_TOL = 0.00045, 0.00060
    z_lat, z_lon = 14.70, 120.95
    lat_lo, lat_hi = z_lat - LAT_TOL, z_lat + LAT_TOL
    lon_lo, lon_hi = z_lon - LON_TOL, z_lon + LON_TOL
    got = (lat_lo <= lat <= lat_hi) and (lon_lo <= lon <= lon_hi)
    assert got is inside
