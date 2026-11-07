from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Enum,
    Index,
    UniqueConstraint,
    text,
)
from sqlalchemy.sql import func
from datetime import datetime
from app.database import Base
import enum


class GPSQualityEnum(str, enum.Enum):
    GOOD = "GOOD"
    ACCEPTABLE = "ACCEPTABLE"
    POOR = "POOR"


class GPSLog(Base):
    __tablename__ = "gps_logs"

    __table_args__ = (
        CheckConstraint("accuracy > 0", name="check_accuracy_positive"),
        CheckConstraint("occupancy_count >= 0", name="check_occupancy_non_negative"),
        Index("idx_trip_id", "trip_id"),
        Index("idx_device_id", "device_id"),  # 🔹 NEW
        # One row per (trip, client sequence number).
        #
        # The PWA stamps client_seq per trip and only empties its offline queue
        # once a flush finishes, so a flush interrupted by a reload or a crash
        # re-sends logs the backend already stored. log_id is minted fresh on
        # every request, so it cannot catch that — the replay simply became a
        # second row, inflating the point counts DBSCAN clusters on.
        #
        # Postgres treats NULLs as distinct in a unique index, so legacy and
        # offline payloads that carry no client_seq are unaffected: any number
        # of them may coexist for the same trip.
        UniqueConstraint("trip_id", "client_seq", name="uq_gps_logs_trip_seq"),
    )

    id = Column(Integer, primary_key=True, index=True)

    log_id = Column(String, unique=True, index=True, nullable=False)
    trip_id = Column(String, ForeignKey("trips.trip_id"), nullable=False)

    device_id = Column(String, nullable=False)  # 🔹 NEW

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=False)

    occupancy_count = Column(Integer, nullable=False)
    over_capacity_flag = Column(Boolean, nullable=False)

    gps_quality_flag = Column(
        Enum(GPSQualityEnum),
        nullable=False
    )

    # ── KPI instrumentation fields ──────────────────────────────────────────
    # gps_timestamp : browser's GPS fix time (from position.timestamp).
    #                 Distinct from server insert time; used to compute
    #                 inter-arrival jitter (KPI #7 on-time interval delivery).
    # client_seq    : monotonically-increasing counter per trip, incremented
    #                 by the PWA for every payload it constructs. Missing
    #                 sequence numbers = confirmed lost logs (KPI #5).
    # client_online_event_at : ISO timestamp the browser fired the 'online'
    #                 event, carried on the first log after reconnect.
    #                 Diff vs. server timestamp = reconnect flush latency
    #                 (KPI #6). NULL on normal (always-online) logs.
    gps_timestamp          = Column(DateTime, nullable=True)
    client_seq             = Column(Integer,  nullable=True)
    client_online_event_at = Column(DateTime, nullable=True)

    # server insert time — set explicitly in gps_routes.py to UTC,
    # server_default acts as a DB-level fallback for raw inserts only.
    timestamp = Column(
        DateTime,
        server_default=text("(now() AT TIME ZONE 'UTC')"),
        nullable=False,
    )
