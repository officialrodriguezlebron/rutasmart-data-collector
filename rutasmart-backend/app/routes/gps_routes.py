from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import uuid, logging

from app.database import get_db
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.trip import Trip, TripStatusEnum
from app.schemas.gps_schema import GPSLogCreate, GPSLogResponse

logger = logging.getLogger(__name__)
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

    # ── GPS corridor check (soft — never rejects, flags instead) ─────────────
    # Hard rejection was removed: a conductor detouring slightly or GPS drifting
    # outside the bounding box would silently produce an empty trip.
    # Instead we flag out-of-corridor logs as POOR quality — they are excluded
    # from DBSCAN spatial clustering but their occupancy_count is preserved for
    # load factor and demand intensity computation.
    #
    # Corridor bounds: Malanday-Recto ±0.05° buffer
    LAT_MIN, LAT_MAX =  14.55,  14.75
    LON_MIN, LON_MAX = 120.95, 121.05
    out_of_corridor = not (
        LAT_MIN <= log.latitude  <= LAT_MAX and
        LON_MIN <= log.longitude <= LON_MAX
    )

    # ── GPS quality classification ───────────────────────────────────────────
    # Out-of-corridor logs are forced to POOR regardless of reported accuracy
    # so they are automatically excluded from DBSCAN (same pipeline as multipath)
    if out_of_corridor:
        gps_quality = GPSQualityEnum.POOR
    elif log.accuracy <= 20:
        gps_quality = GPSQualityEnum.GOOD
    elif log.accuracy <= 50:
        gps_quality = GPSQualityEnum.ACCEPTABLE
    else:
        gps_quality = GPSQualityEnum.POOR

    over_capacity = log.occupancy_count > trip.official_capacity
    if over_capacity:
        logger.warning("Over capacity | trip=%s occ=%d cap=%d",
                       log.trip_id, log.occupancy_count, trip.official_capacity)
    if out_of_corridor:
        logger.warning("Out-of-corridor GPS | trip=%s lat=%.5f lon=%.5f",
                       log.trip_id, log.latitude, log.longitude)

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
