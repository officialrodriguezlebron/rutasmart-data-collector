from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime
import uuid
import csv
import io

from app.database import get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog
from app.schemas.trip_schema import TripStartRequest, TripStartResponse

router = APIRouter(prefix="/trip", tags=["Trip Management"])


# 🔹 START TRIP
@router.post("/start-trip", response_model=TripStartResponse)
def start_trip(request: TripStartRequest, db: Session = Depends(get_db)):

    # 1️⃣ Prevent impossible occupancy
    if request.starting_occupancy > request.official_capacity:
        raise HTTPException(
            status_code=400,
            detail="Starting occupancy cannot exceed official capacity"
        )

    # 2️⃣ Ensure no duplicate ACTIVE trip per jeep
    existing_active = (
        db.query(Trip)
        .filter(
            Trip.jeep_code == request.jeep_code,
            Trip.status == TripStatusEnum.ACTIVE
        )
        .first()
    )

    if existing_active:
        raise HTTPException(
            status_code=409,
            detail=f"Jeep {request.jeep_code} already has an ACTIVE trip"
        )

    # 3️⃣ Generate trip_id
    trip_id = f"{datetime.utcnow().date()}_{request.jeep_code}_{request.direction}_{uuid.uuid4().hex[:4]}"

    # 4️⃣ Create trip
    new_trip = Trip(
        trip_id=trip_id,
        route_id=request.route_id,
        direction=request.direction,
        recorder_id=request.recorder_id,
        jeep_code=request.jeep_code,
        official_capacity=request.official_capacity,
        starting_occupancy=request.starting_occupancy,
        status=TripStatusEnum.ACTIVE,
        start_time=datetime.utcnow()
    )

    db.add(new_trip)
    db.commit()
    db.refresh(new_trip)

    return TripStartResponse(
        trip_id=new_trip.trip_id,
        start_time=new_trip.start_time
    )


# 🔹 END TRIP
@router.post("/end-trip/{trip_id}")
def end_trip(trip_id: str, db: Session = Depends(get_db)):

    trip = db.query(Trip).filter(Trip.trip_id == trip_id).first()

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if trip.status != TripStatusEnum.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail="Only ACTIVE trips can be ended"
        )

    trip.status = TripStatusEnum.COMPLETED
    trip.end_time = datetime.utcnow()

    db.commit()
    db.refresh(trip)

    return {
        "message": "Trip completed successfully",
        "trip_id": trip.trip_id,
        "end_time": trip.end_time
    }


# 🔹 EXPORT TRIP CSV
@router.get("/export/{trip_id}")
def export_trip_csv(trip_id: str, db: Session = Depends(get_db)):

    trip = db.query(Trip).filter(Trip.trip_id == trip_id).first()

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    # 🔒 Only allow export if COMPLETED
    if trip.status != TripStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Trip must be COMPLETED before export"
        )

    logs = (
        db.query(GPSLog)
        .filter(GPSLog.trip_id == trip_id)
        .order_by(GPSLog.timestamp.asc())
        .all()
    )

    if not logs:
        raise HTTPException(
            status_code=404,
            detail="No GPS logs found for this trip"
        )

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "log_id",
        "trip_id",
        "device_id",
        "latitude",
        "longitude",
        "accuracy",
        "gps_quality_flag",
        "occupancy_count",
        "over_capacity_flag",
        "timestamp"
    ])

    # Rows
    for log in logs:
        writer.writerow([
            log.log_id,
            log.trip_id,
            log.device_id,
            log.latitude,
            log.longitude,
            log.accuracy,
            log.gps_quality_flag,
            log.occupancy_count,
            log.over_capacity_flag,
            log.timestamp
        ])

    output.seek(0)

    filename = f"{trip_id}_export.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
