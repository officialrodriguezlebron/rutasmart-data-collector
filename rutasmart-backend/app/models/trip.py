from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    CheckConstraint,
    Enum,
    Index
)
from datetime import datetime
from app.database import Base
import enum


# 🔹 Trip Status ENUM (DB enforced)
class TripStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class Trip(Base):
    __tablename__ = "trips"

    __table_args__ = (
        CheckConstraint("official_capacity > 0", name="check_capacity_positive"),
        CheckConstraint("starting_occupancy >= 0", name="check_start_occ_non_negative"),
        CheckConstraint(
            "starting_occupancy <= official_capacity",
            name="check_start_occ_within_capacity"
        ),
        Index("idx_status", "status"),
    )

    trip_id = Column(String, primary_key=True, index=True)

    route_id = Column(String, nullable=False)  # 🔹 now required
    direction = Column(String, nullable=False)
    recorder_id = Column(String, nullable=False)
    jeep_code = Column(String, nullable=False)

    official_capacity = Column(Integer, nullable=False)
    starting_occupancy = Column(Integer, nullable=False)

    status = Column(
        Enum(TripStatusEnum),
        default=TripStatusEnum.ACTIVE,
        nullable=False
    )

    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
