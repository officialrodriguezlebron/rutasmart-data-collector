from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class GPSLogCreate(BaseModel):
    trip_id:   str   = Field(..., min_length=1)
    device_id: str   = Field(..., min_length=3)
    latitude:  float
    longitude: float
    accuracy:  float = Field(..., gt=0)
    occupancy_count: int = Field(..., ge=0)

    # ── KPI instrumentation ──────────────────────────────────────────────────
    # All three are Optional so existing clients (queued offline payloads that
    # pre-date this change) continue to work without a breaking API change.

    # Browser GPS fix time (milliseconds since Unix epoch, from
    # GeolocationPosition.timestamp). Sent as epoch-ms; backend converts to
    # DateTime. Used to compute inter-arrival jitter (KPI #7).
    gps_timestamp: Optional[int] = Field(
        default=None,
        description="GeolocationPosition.timestamp (epoch ms)"
    )

    # Monotonically-increasing integer reset to 0 when a trip starts. The
    # backend stores it as-is; gaps in the sequence = confirmed lost logs
    # (KPI #5).
    client_seq: Optional[int] = Field(
        default=None,
        ge=0,
        description="Per-trip payload counter; gaps = lost logs"
    )

    # ISO-8601 string of the browser 'online' event that triggered a flush,
    # sent only on the FIRST log dispatched after reconnect. NULL on all
    # subsequent logs. Backend stores as DateTime (KPI #6).
    client_online_event_at: Optional[str] = Field(
        default=None,
        description="ISO timestamp of browser 'online' event; first-log-after-reconnect only"
    )


class GPSLogResponse(BaseModel):
    log_id:    str
    trip_id:   str
    device_id: str
    latitude:  float
    longitude: float
    accuracy:  float
    occupancy_count:    int
    over_capacity_flag: bool
    gps_quality_flag:   str
    timestamp:          datetime

    # KPI fields echoed back so the PWA can confirm receipt
    gps_timestamp:          Optional[datetime] = None
    client_seq:             Optional[int]      = None
    client_online_event_at: Optional[datetime] = None

    class Config:
        from_attributes = True
