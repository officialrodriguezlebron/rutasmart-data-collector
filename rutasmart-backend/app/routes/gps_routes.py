from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import uuid

from app.database import get_db
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.trip import Trip, TripStatusEnum
from app.schemas.gps_schema import GPSLogCreate, GPSLogResponse


router = APIRouter(prefix="/log", tags=["GPS Logs"])


@router.post("/", response_model=GPSLogResponse)
def create_gps_log(log: GPSLogCreate, db: Session = Depends(get_db)):

    # device_id already validated by Pydantic Field(min_length=3)
    # but keep an explicit strip-check for whitespace-only strings
    if not log.device_id.strip():
        raise HTTPException(
            status_code=400,
            detail="Valid Device ID is required"
        )

    trip = db.query(Trip).filter(Trip.trip_id == log.trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if trip.status != TripStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=400,
            detail="Cannot log data. Trip is not ACTIVE."
        )

    # accuracy and occupancy_count already validated by Pydantic Field(gt=0 / ge=0)

    # ── GPS quality classification ───────────────────────────────────────────
    if log.accuracy <= 20:
        gps_quality = GPSQualityEnum.GOOD
    elif log.accuracy <= 50:
        gps_quality = GPSQualityEnum.ACCEPTABLE
    else:
        gps_quality = GPSQualityEnum.POOR

    over_capacity = log.occupancy_count > trip.official_capacity

    log_id = f"{log.trip_id}_{uuid.uuid4().hex[:6]}"

    # ── Convert KPI instrumentation fields ───────────────────────────────────
    # gps_timestamp: sent as epoch-ms integer → convert to UTC DateTime
    gps_ts = None
    if log.gps_timestamp is not None:
        try:
            gps_ts = datetime.fromtimestamp(
                log.gps_timestamp / 1000.0, tz=timezone.utc
            ).replace(tzinfo=None)  # store as naive UTC, consistent with other cols
        except (OSError, OverflowError, ValueError):
            gps_ts = None  # malformed value — store NULL rather than reject

    # client_online_event_at: sent as ISO-8601 string → parse to DateTime
    online_at = None
    if log.client_online_event_at is not None:
        try:
            online_at = datetime.fromisoformat(
                log.client_online_event_at.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except ValueError:
            online_at = None

    new_log = GPSLog(
        log_id=log_id,
        trip_id=log.trip_id,
        device_id=log.device_id,
        latitude=log.latitude,
        longitude=log.longitude,
        accuracy=log.accuracy,
        occupancy_count=log.occupancy_count,
        over_capacity_flag=over_capacity,
        gps_quality_flag=gps_quality,
        gps_timestamp=gps_ts,
        client_seq=log.client_seq,
        client_online_event_at=online_at,
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
    )

    db.add(new_log)
    db.commit()
    db.refresh(new_log)

    return new_log
