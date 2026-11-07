"""
Regression tests for D1 — idempotent GPS log ingestion.

Isolation
---------
Everything runs against a throwaway in-memory SQLite database created per
test. Nothing touches localhost:5432/rutasmart_db, and no network or Railway
access is involved.

app.main is deliberately never imported: it calls Base.metadata.create_all
against the configured engine at import time, which would reach for a real
database. Importing app.routes.gps_routes is safe — create_engine resolves a
DBAPI but opens no connection — and the handler is invoked directly through
its __wrapped__ attribute, under the slowapi rate-limit decorator, with the
SQLite session passed in. That also avoids pulling in a test HTTP client
dependency purely to exercise one function.

Authorization on POST /log/ is covered separately (tests for require_role and
the Group 4 verification); these tests are about duplicate handling only.

What is covered
---------------
The handler behaviour (returning the stored row instead of inserting a second
one) and the database-level guarantee (the unique rule rejecting a duplicate
outright), including the lost-race path where another request commits the same
(trip_id, client_seq) between this request's pre-check and its insert.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.trip import Trip, TripStatusEnum
from app.models.user import User  # noqa: F401  (registers the table)
from app.routes.gps_routes import create_gps_log
from app.schemas.gps_schema import GPSLogCreate

pytestmark = pytest.mark.regression

TRIP_ID = "2026-11-05_TESTJEEP_MALANDAY-RECTO_test"

# The endpoint under test, without the slowapi rate-limit wrapper. The handler
# body never reads `request`, so None is passed for it.
handler = getattr(create_gps_log, "__wrapped__", create_gps_log)


def submit(db, seq, occupancy=1, lat=14.7187):
    """Call POST /log/ exactly as FastAPI would, against the SQLite session."""
    body = {"trip_id": TRIP_ID, "device_id": "RS-TEST0001", "latitude": lat,
            "longitude": 120.9570, "accuracy": 8.0, "occupancy_count": occupancy,
            "gps_timestamp": 1793811439492 + (seq or 0)}
    if seq is not None:
        body["client_seq"] = seq
    return handler(request=None, log=GPSLogCreate(**body), db=db)


@pytest.fixture
def db_session():
    """A fresh in-memory SQLite database per test.

    The models carry PostgreSQL server defaults — now() AT TIME ZONE 'UTC' —
    which SQLite cannot parse, so they are dropped for the duration of the
    test and every timestamp is supplied explicitly instead.
    """
    saved = {}
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if col.server_default is not None:
                saved[(table.name, col.name)] = col.server_default
                col.server_default = None

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autocommit=False, autoflush=False)()

    session.add(Trip(
        trip_id=TRIP_ID, route_id="MR-001", direction="MALANDAY-RECTO",
        recorder_id="RS-TEST0001", jeep_code="TESTJEEP",
        official_capacity=26, starting_occupancy=0,
        status=TripStatusEnum.ACTIVE,
        start_time=datetime(2026, 11, 5, 1, 0, 0),
        created_at=datetime(2026, 11, 5, 1, 0, 0)))
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
        for (tname, cname), default in saved.items():
            Base.metadata.tables[tname].columns[cname].server_default = default


def count(db, client_seq="__any__"):
    q = db.query(GPSLog).filter(GPSLog.trip_id == TRIP_ID)
    if client_seq != "__any__":
        q = q.filter(GPSLog.client_seq.is_(None) if client_seq is None
                     else GPSLog.client_seq == client_seq)
    return q.count()


def raw_log(seq, log_id, trip_id=TRIP_ID):
    return GPSLog(log_id=log_id, trip_id=trip_id, device_id="RS-TEST0001",
                  latitude=14.7187, longitude=120.9570, accuracy=8.0,
                  occupancy_count=1, over_capacity_flag=False,
                  gps_quality_flag=GPSQualityEnum.GOOD, client_seq=seq,
                  timestamp=datetime.now(timezone.utc).replace(tzinfo=None))


# ── first insert ─────────────────────────────────────────────────────────────

def test_first_log_is_inserted(db_session):
    stored = submit(db_session, 1)
    assert count(db_session) == 1
    assert stored.client_seq == 1
    assert stored.trip_id == TRIP_ID


def test_distinct_sequences_all_insert(db_session):
    for seq in (1, 2, 3):
        submit(db_session, seq)
    assert count(db_session) == 3


# ── exact replay ─────────────────────────────────────────────────────────────

def test_exact_replay_does_not_duplicate(db_session):
    """The interrupted-flush case: the client re-sends what it already sent."""
    submit(db_session, 1)
    submit(db_session, 1)
    assert count(db_session) == 1


def test_replay_returns_the_already_stored_row(db_session):
    """It must look like success so the client drops the log from its queue."""
    first = submit(db_session, 1)
    replay = submit(db_session, 1)
    assert replay.log_id == first.log_id


def test_replaying_a_whole_flush_creates_no_duplicates(db_session):
    for seq in range(1, 6):
        submit(db_session, seq)
    for seq in range(1, 6):          # the flush is replayed in full
        submit(db_session, seq)
    assert count(db_session) == 5


# ── replay carrying different data ───────────────────────────────────────────

def test_replay_with_different_payload_does_not_overwrite(db_session):
    """First write wins: a replay must never mutate recorded GPS data."""
    submit(db_session, 1, occupancy=1, lat=14.7187)
    submit(db_session, 1, occupancy=99, lat=14.9999)
    assert count(db_session) == 1
    stored = db_session.query(GPSLog).filter(GPSLog.client_seq == 1).one()
    assert stored.occupancy_count == 1
    assert stored.latitude == pytest.approx(14.7187)


# ── new sequence still inserts ───────────────────────────────────────────────

def test_new_sequence_inserts_after_a_replay(db_session):
    submit(db_session, 1)
    submit(db_session, 1)            # replay
    submit(db_session, 2)
    assert count(db_session) == 2


# ── NULL client_seq stays undeduplicated ─────────────────────────────────────

def test_multiple_null_client_seq_rows_are_allowed(db_session):
    """Legacy and offline payloads carry no sequence number and cannot be
    deduplicated; the unique rule must not collapse them into one row."""
    for _ in range(3):
        submit(db_session, None)
    assert count(db_session, client_seq=None) == 3


def test_null_sequences_coexist_with_numbered_ones(db_session):
    submit(db_session, 1)
    submit(db_session, None)
    submit(db_session, None)
    assert count(db_session) == 3
    assert count(db_session, client_seq=None) == 2


# ── database-level guarantee ─────────────────────────────────────────────────

def test_direct_duplicate_insert_is_rejected(db_session):
    """The guarantee lives in the schema, not only in the handler."""
    db_session.add(raw_log(1, "LOG-A"))
    db_session.commit()
    db_session.add(raw_log(1, "LOG-B"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert count(db_session) == 1


def test_same_sequence_on_a_different_trip_is_allowed(db_session):
    db_session.add(Trip(
        trip_id="OTHER-TRIP", route_id="MR-001", direction="MALANDAY-RECTO",
        recorder_id="RS-TEST0002", jeep_code="OTHERJEEP",
        official_capacity=26, starting_occupancy=0, status=TripStatusEnum.ACTIVE,
        start_time=datetime(2026, 11, 5, 1, 0, 0),
        created_at=datetime(2026, 11, 5, 1, 0, 0)))
    db_session.add(raw_log(1, "LOG-A"))
    db_session.add(raw_log(1, "LOG-C", trip_id="OTHER-TRIP"))
    db_session.commit()
    assert db_session.query(GPSLog).count() == 2


def test_unique_constraint_is_declared_on_the_model():
    names = {c.name for c in GPSLog.__table__.constraints if c.name}
    assert "uq_gps_logs_trip_seq" in names


# ── lost race between the pre-check and the insert ───────────────────────────

class _BlindFirstQuery:
    """Proxies a real Query but reports no existing row on its first use.

    That reproduces the window where another request commits the same
    (trip_id, client_seq) after this request's duplicate check but before its
    insert, so the handler falls through to the IntegrityError branch.
    """

    def __init__(self, inner, state):
        self._inner = inner
        self._state = state

    def filter(self, *a, **kw):
        return _BlindFirstQuery(self._inner.filter(*a, **kw), self._state)

    def first(self):
        if self._state["blind"]:
            self._state["blind"] = False
            return None
        return self._inner.first()

    def __getattr__(self, item):
        return getattr(self._inner, item)


class _RacySession:
    """Blinds only the GPSLog duplicate check.

    The handler queries Trip first to confirm the trip exists and is ACTIVE;
    blinding that lookup too would produce a 404 and never reach the code
    under test.
    """

    def __init__(self, inner, state):
        self._inner = inner
        self._state = state

    def query(self, *entities, **kw):
        real = self._inner.query(*entities, **kw)
        if entities and entities[0] is GPSLog:
            return _BlindFirstQuery(real, self._state)
        return real

    def __getattr__(self, item):
        return getattr(self._inner, item)


def test_lost_race_returns_the_existing_row_instead_of_failing(db_session):
    """Concurrency: the duplicate lands from elsewhere mid-request."""
    first = submit(db_session, 1)

    state = {"blind": True}          # the next pre-check sees nothing
    racy = _RacySession(db_session, state)
    second = submit(racy, 1)

    assert state["blind"] is False, "the blind pre-check should have been consumed"
    assert second.log_id == first.log_id, "must return the row that already exists"
    assert count(db_session) == 1


def test_lost_race_does_not_leave_the_session_broken(db_session):
    """After the rollback the session must still be usable."""
    submit(db_session, 1)
    submit(_RacySession(db_session, {"blind": True}), 1)
    submit(db_session, 2)
    assert count(db_session) == 2
