from pydantic import BaseModel
from datetime import datetime


class GPSLogCreate(BaseModel):
    trip_id: str
    device_id: str  # 🔹 NEW
    latitude: float
    longitude: float
    accuracy: float
    occupancy_count: int


class GPSLogResponse(BaseModel):
    log_id: str
    trip_id: str
    device_id: str  # 🔹 NEW
    latitude: float
    longitude: float
    accuracy: float
    occupancy_count: int
    over_capacity_flag: bool
    gps_quality_flag: str
    timestamp: datetime

    class Config:
        from_attributes = True
