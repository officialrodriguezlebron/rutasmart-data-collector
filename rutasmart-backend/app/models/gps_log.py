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
    Index
)
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

    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
