from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import uuid

from app.database import get_db
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.trip import Trip, TripStatusEnum
from app.schemas.gps_schema import GPSLogCreate, GPSLogResponse

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/log", tags=["GPS Logs"])


@router.post("/", response_model=GPSLogResponse)
@limiter.limit("30/minute")
def create_gps_log(request: Request, log: GPSLogCreate, db: Session = Depends(get_db)):

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

    # ── GPS bounding box ──────────────────────────────────────────────────────
    # Production: 14.55–14.75°N, 120.95–121.05°E (Malanday-Recto corridor)
    # Testing: set DISABLE_BBOX=true in env to skip this check
    import os as _os
    if not _os.getenv("DISABLE_BBOX", "").lower() == "true":
        LAT_MIN, LAT_MAX =  14.55,  14.75
        LON_MIN, LON_MAX = 120.95, 121.05
        if not (LAT_MIN <= log.latitude  <= LAT_MAX and
                LON_MIN <= log.longitude <= LON_MAX):
            raise HTTPException(
                status_code=422,
                detail=f"Coordinates ({log.latitude:.4f}, {log.longitude:.4f}) are outside "
                       f"the Malanday-Recto corridor bounding box."
            )

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
