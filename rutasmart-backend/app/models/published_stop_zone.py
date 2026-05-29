# FILE: rutasmart-backend/app/models/published_stop_zone.py
# New file — create this file in the models folder

from sqlalchemy import Column, Integer, String, Float, DateTime, text
from datetime import datetime
from app.database import Base


class PublishedStopZone(Base):
    """
    Admin-validated stop zone centroids for a route.
    Populated by POST /admin/route/{route_id}/publish-stops.
    Read by GET /public/route/{route_id}/stop-zones.

    One row per detected cluster centroid. All rows for a route are
    replaced atomically on each publish so the public map is always
    consistent — never showing a partial update.
    """
    __tablename__ = "published_stop_zones"

    id             = Column(Integer, primary_key=True, index=True)
    route_id       = Column(String,  nullable=False, index=True)
    cluster_id     = Column(Integer, nullable=False)
    lat            = Column(Float,   nullable=False)
    lon            = Column(Float,   nullable=False)
    point_count    = Column(Integer, nullable=False)
    demand_tier    = Column(String,  nullable=False)   # Normal | Moderate | High | Critical
    avg_occupancy  = Column(Float,   nullable=False)
    peak_period    = Column(String,  nullable=False)
    load_factor_pct= Column(Float,   nullable=False)
    color          = Column(String,  nullable=False)   # hex colour for frontend
    rank           = Column(Integer, nullable=False)   # 1 = busiest
    published_at   = Column(DateTime, nullable=False,
                            server_default=text("(now() AT TIME ZONE 'UTC')"))
    trips_analyzed = Column(Integer, nullable=False, default=0)
    logs_analyzed  = Column(Integer, nullable=False, default=0)
