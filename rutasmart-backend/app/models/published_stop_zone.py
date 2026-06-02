from sqlalchemy import Column, Integer, String, Float, DateTime, text
from datetime import datetime
from app.database import Base


class PublishedStopZone(Base):
    """
    Admin-validated stop zone centroids for a route, per direction.

    Populated by POST /admin/route/{route_id}/publish-stops?direction=...
    Read by GET /public/route/{route_id}/stop-zones?direction=...

    direction values: MALANDAY-RECTO | RECTO-MALANDAY
    Each direction is published independently and stored separately.
    """
    __tablename__ = "published_stop_zones"

    id             = Column(Integer, primary_key=True, index=True)
    route_id       = Column(String,  nullable=False, index=True)
    direction      = Column(String,  nullable=False, index=True, default="MALANDAY-RECTO")
    cluster_id     = Column(Integer, nullable=False)
    lat            = Column(Float,   nullable=False)
    lon            = Column(Float,   nullable=False)
    point_count    = Column(Integer, nullable=False)
    demand_tier    = Column(String,  nullable=False)
    avg_occupancy  = Column(Float,   nullable=False)
    peak_period    = Column(String,  nullable=False)
    load_factor_pct= Column(Float,   nullable=False)
    color          = Column(String,  nullable=False)
    rank           = Column(Integer, nullable=False)
    published_at   = Column(DateTime, nullable=False,
                            server_default=text("(now() AT TIME ZONE 'UTC')"))
    trips_analyzed = Column(Integer, nullable=False, default=0)
    logs_analyzed  = Column(Integer, nullable=False, default=0)
