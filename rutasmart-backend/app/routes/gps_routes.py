from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid

from app.database import get_db
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.trip import Trip, TripStatusEnum
from app.schemas.gps_schema import GPSLogCreate, GPSLogResponse


router = APIRouter(prefix="/log", tags=["GPS Logs"])


@router.post("/", response_model=GPSLogResponse)
def create_gps_log(log: GPSLogCreate, db: Session = Depends(get_db)):

    # 1️⃣ Validate device_id (stronger validation)
    if not log.device_id or len(log.device_id.strip()) < 3:
        raise HTTPException(
            status_code=400,
            detail="Valid Device ID is required"
        )

    # 2️⃣ Check if trip exists
    trip = db.query(Trip).filter(Trip.trip_id == log.trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    # 3️⃣ Enforce ACTIVE trip only (proper enum comparison)
    if trip.status != TripStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=400,
            detail="Cannot log data. Trip is not ACTIVE."
        )

    # 4️⃣ Validate accuracy
    if log.accuracy is None or log.accuracy <= 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid GPS accuracy value"
        )

    # 5️⃣ Validate occupancy
    if log.occupancy_count < 0:
        raise HTTPException(
            status_code=400,
            detail="Occupancy cannot be negative"
        )

    # 6️⃣ GPS Quality Classification
    if log.accuracy <= 20:
        gps_quality = GPSQualityEnum.GOOD
    elif log.accuracy <= 50:
        gps_quality = GPSQualityEnum.ACCEPTABLE
    else:
        gps_quality = GPSQualityEnum.POOR

    # 7️⃣ Overcapacity Detection
    over_capacity = log.occupancy_count > trip.official_capacity

    # 8️⃣ Generate log_id
    log_id = f"{log.trip_id}_{uuid.uuid4().hex[:6]}"

    # 9️⃣ Create log object (remove manual timestamp — DB handles it)
    new_log = GPSLog(
        log_id=log_id,
        trip_id=log.trip_id,
        device_id=log.device_id,
        latitude=log.latitude,
        longitude=log.longitude,
        accuracy=log.accuracy,
        occupancy_count=log.occupancy_count,
        over_capacity_flag=over_capacity,
        gps_quality_flag=gps_quality
    )

    db.add(new_log)
    db.commit()
    db.refresh(new_log)

    return new_log
