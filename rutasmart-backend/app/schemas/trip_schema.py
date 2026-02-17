from pydantic import BaseModel, Field
from datetime import datetime


class TripStartRequest(BaseModel):
    route_id: str = Field(..., min_length=1)
    direction: str = Field(..., min_length=1)
    recorder_id: str = Field(..., min_length=1)
    jeep_code: str = Field(..., min_length=1)
    official_capacity: int = Field(..., gt=0)
    starting_occupancy: int = Field(..., ge=0)


class TripStartResponse(BaseModel):
    trip_id: str
    start_time: datetime
