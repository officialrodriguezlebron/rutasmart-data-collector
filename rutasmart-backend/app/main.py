from fastapi import FastAPI, Request, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
from datetime import datetime
import os, csv, io, uuid

from app.database import engine, Base, get_db
from app.models.trip import Trip, TripStatusEnum
from app.models.gps_log import GPSLog, GPSQualityEnum
from app.models.user import User

from app.routes.auth_routes import router as auth_router
from app.routes.trip_routes import router as trip_router
from app.routes.gps_routes import router as gps_router
from app.routes.analytics_routes import router as analytics_router

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="RutaSmart API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://rutasmart-data-collector.onrender.com",
    "https://rutasmart-data-collector.vercel.app",
    "https://rutas-frontend.vercel.app",
    "https://rutasmart-data-collector-2asmhbpm.vercel.app",
    "https://rutasmart-data-collector-7dnn1rvqq.vercel.app",
]

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
if FRONTEND_URL and FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

API_KEY = os.getenv("RUTASMART_API_KEY", "")
EXEMPT_PATHS = {"/", "/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    if API_KEY and request.url.path not in EXEMPT_PATHS:
        client_key = request.headers.get("X-API-Key", "")
        if client_key != API_KEY:
            raise HTTPException(status_code=401, detail="Missing or invalid API key.")
    return await call_next(request)

Base.metadata.create_all(bind=engine)

app.include_router(auth_router)
app.include_router(trip_router)
app.include_router(gps_router)
app.include_router(analytics_router)


@app.get("/")
def read_root():
    return {"message": "RutaSmart Backend Connected to Database"}


# ── Public live route dashboard endpoint ──────────────────────────────────

@app.get("/public/route/{route_id}", tags=["Public"])
def get_live_route(route_id: str, db: Session = Depends(get_db)):
    """
    Public read-only endpoint — no authentication required.
    Returns all ACTIVE jeepneys on a given route with their last known
    GPS position and occupancy status. Polled every 5 seconds by the
    passenger-facing dashboard at /route/{route_id}.

    Occupancy tiers:
      EMPTY    — 0–40% of official capacity
      MODERATE — 41–75%
      FULL     — 76–100%
      OVERCAP  — over official capacity
    """
    from sqlalchemy import desc, func

    # Normalize route_id — strip whitespace, uppercase, remove dashes for comparison
    # This catches "mr-001", "MR001", " MR-001 " etc. so they all match MR-001.
    normalized = route_id.strip().upper().replace(" ", "")
    if normalized in ("MR-001", "MR001", "MR_001"):
        # Match all common variants in the database for the Malanday-Recto corridor
        active_trips = (
            db.query(Trip)
            .filter(
                Trip.status == TripStatusEnum.ACTIVE,
                func.replace(func.replace(func.upper(Trip.route_id), "_", ""), "-", "").in_(["MR001"])
            )
            .all()
        )
    else:
        active_trips = (
            db.query(Trip)
            .filter(Trip.route_id == route_id, Trip.status == TripStatusEnum.ACTIVE)
            .all()
        )

    jeepneys = []
    for trip in active_trips:
        # Get the most recent GPS log for this trip
        last_log = (
            db.query(GPSLog)
            .filter(GPSLog.trip_id == trip.trip_id)
            .order_by(desc(GPSLog.timestamp))
            .first()
        )

        if not last_log:
            continue

        occ = last_log.occupancy_count
        cap = trip.official_capacity or 26
        pct = (occ / cap * 100) if cap > 0 else 0

        if occ > cap:
            tier = "OVERCAP"
            color = "#c62828"
        elif pct > 75:
            tier = "FULL"
            color = "#ef6c00"
        elif pct > 40:
            tier = "MODERATE"
            color = "#f9a825"
        else:
            tier = "AVAILABLE"
            color = "#2e7d32"

        jeepneys.append({
            "trip_id":          trip.trip_id,
            "jeep_code":        trip.jeep_code,
            "direction":        trip.direction,
            "occupancy":        occ,
            "capacity":         cap,
            "occupancy_pct":    round(pct, 1),
            "tier":             tier,
            "color":            color,
            "last_lat":         last_log.latitude,
            "last_lon":         last_log.longitude,
            "last_accuracy":    last_log.accuracy,
            "last_updated":     last_log.timestamp.isoformat() if last_log.timestamp else None,
            "gps_quality":      str(last_log.gps_quality_flag.value
                                    if hasattr(last_log.gps_quality_flag, "value")
                                    else last_log.gps_quality_flag),
        })

    # Sort: most crowded first so passengers see the worst situation upfront
    jeepneys.sort(key=lambda j: j["occupancy_pct"], reverse=True)

    return {
        "route_id":    route_id,
        "route_name":  "Malanday – Recto" if route_id == "MR-001" else route_id,
        "active_count": len(jeepneys),
        "jeepneys":    jeepneys,
        "polled_at":   __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }


# ── Admin endpoints ────────────────────────────────────────────────────────

@app.get("/admin/trips", tags=["Admin"])
def get_all_trips(db: Session = Depends(get_db)):
    """Latest 100 trips for the admin dashboard."""
    trips = db.query(Trip).order_by(Trip.start_time.desc()).limit(100).all()
    return [
        {
            "trip_id": t.trip_id, "jeep_code": t.jeep_code, "route_id": t.route_id,
            "direction": t.direction, "status": t.status,
            "start_time": str(t.start_time),
            "end_time": str(t.end_time) if t.end_time else None,
            "official_capacity": t.official_capacity,
        }
        for t in trips
    ]


@app.get("/admin/stats", tags=["Admin"])
def get_system_stats(db: Session = Depends(get_db)):
    """Overview metrics for admin dashboard."""
    total_logs   = db.query(GPSLog).count()
    total_trips  = db.query(Trip).count()
    active_trips = db.query(Trip).filter(Trip.status == TripStatusEnum.ACTIVE).count()
    total_users  = db.query(User).filter(User.is_active == True).count()
    active_jeeps = (
        db.query(Trip.jeep_code)
        .filter(Trip.status == TripStatusEnum.ACTIVE)
        .distinct().all()
    )
    return {
        "total_logs":   total_logs,
        "total_trips":  total_trips,
        "active_trips": active_trips,
        "total_users":  total_users,
        "active_jeeps": [j[0] for j in active_jeeps],
    }


@app.delete("/admin/trip/{trip_id}", tags=["Admin"])
def delete_trip(trip_id: str, db: Session = Depends(get_db)):
    """
    Hard-delete a trip and ALL its GPS logs.
    Used by admin to clean up test trips and synthetic data.
    """
    trip = db.query(Trip).filter(Trip.trip_id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    log_count = db.query(GPSLog).filter(GPSLog.trip_id == trip_id).count()

    db.query(GPSLog).filter(GPSLog.trip_id == trip_id).delete()
    db.delete(trip)
    db.commit()

    return {
        "deleted": trip_id,
        "logs_removed": log_count,
        "message": f"Trip {trip_id} and {log_count} associated logs deleted.",
    }


@app.post("/admin/import", tags=["Admin"])
async def import_trip_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Import a trip and its GPS logs from a CSV file.
    CSV must have the same 13-column format as /trip/export/{trip_id}.

    Creates a new trip with auto-generated trip_id and bulk-inserts the GPS logs.
    Useful for restoring backups, importing synthetic data, or replaying field rides.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    try:
        content = (await file.read()).decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV is empty")

    # Required columns from the standard export
    required = {"latitude", "longitude", "accuracy", "occupancy_count", "timestamp"}
    missing  = required - set(reader.fieldnames or [])
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {sorted(missing)}"
        )

    # Build a new trip from the first row (or use trip_id if provided)
    first = rows[0]
    trip_id = first.get("trip_id") or (
        f"IMPORT_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    )

    if db.query(Trip).filter(Trip.trip_id == trip_id).first():
        # Auto-suffix with timestamp instead of hard failing
        from datetime import datetime as _dt
        trip_id = f"{trip_id}_{_dt.utcnow().strftime('%H%M%S')}"

    jeep_code = first.get("jeep_code", "IMPORT")
    capacity  = int(first.get("official_capacity", 25))

    # ── Derive start/end times from CSV rows ───────────────────────────────
    # The import previously used utcnow() for both, meaning all imported trips
    # appeared to start "now" regardless of the CSV timestamps. This broke:
    #   - By Day filtering (PHT date wrong)
    #   - Time period categorisation (Morning Peak vs Off-Peak)
    #   - Timeline analytics
    def _parse_ts(val: str):
        if not val or val in ("None", "null", ""):
            return None
        try:
            return datetime.fromisoformat(val.replace("Z", ""))
        except Exception:
            return None

    ts_first = _parse_ts(first.get("timestamp") or first.get("gps_timestamp"))
    ts_last  = _parse_ts(rows[-1].get("timestamp") or rows[-1].get("gps_timestamp"))
    trip_start = ts_first or datetime.utcnow()
    trip_end   = ts_last  or datetime.utcnow()

    # Clamp starting_occupancy to official_capacity so the DB constraint
    # (starting_occupancy <= official_capacity) never fires on overcrowded trips.
    raw_start_occ = int(first.get("occupancy_count", 0))
    safe_start_occ = min(raw_start_occ, capacity)

    new_trip = Trip(
        trip_id=trip_id,
        route_id=first.get("route_id", "MR-001"),
        direction=first.get("direction", "MALANDAY-RECTO"),
        recorder_id=first.get("device_id", "IMPORTED"),
        jeep_code=jeep_code,
        official_capacity=capacity,
        starting_occupancy=safe_start_occ,
        status=TripStatusEnum.COMPLETED,
        start_time=trip_start,
        end_time=trip_end,
        created_at=datetime.utcnow(),
    )
    db.add(new_trip)
    db.flush()

    # Bulk insert GPS logs
    log_objects = []
    skipped = 0
    for row in rows:
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            acc = float(row["accuracy"])
            occ = int(row["occupancy_count"])
        except (ValueError, KeyError):
            skipped += 1
            continue

        # ── Coordinate range sanity (WGS-84) ───────────────────────────────
        # Reject impossible coordinates and non-positive accuracy that the
        # table-level CheckConstraint would otherwise convert into an opaque
        # IntegrityError on commit.
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0) or acc <= 0 or occ < 0:
            skipped += 1
            continue

        # ── GPS quality classify — same logic as POST /log/ ────────────────
        # Out-of-corridor logs are forced to POOR so they are excluded from
        # DBSCAN spatial clustering on imported data, matching live behaviour.
        LAT_MIN, LAT_MAX =  14.55,  14.75
        LON_MIN, LON_MAX = 120.95, 121.05
        out_of_corridor = not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX)

        if out_of_corridor:
            quality = GPSQualityEnum.POOR
        elif acc <= 20:
            quality = GPSQualityEnum.GOOD
        elif acc <= 50:
            quality = GPSQualityEnum.ACCEPTABLE
        else:
            quality = GPSQualityEnum.POOR

        # Parse timestamp
        ts_str = row.get("timestamp") or row.get("gps_timestamp")
        try:
            from datetime import datetime as _dt
            ts = _dt.fromisoformat(ts_str.replace("Z","")) if ts_str else None
        except Exception:
            ts = None

        log_objects.append(GPSLog(
            log_id=str(uuid.uuid4()),
            trip_id=trip_id,
            device_id=row.get("device_id", "IMPORTED"),
            latitude=lat,
            longitude=lon,
            accuracy=acc,
            occupancy_count=occ,
            over_capacity_flag=(occ > capacity),
            gps_quality_flag=quality,
            timestamp=ts or datetime.utcnow(),
            gps_timestamp=ts,
            client_seq=int(row["client_seq"]) if row.get("client_seq") else None,
        ))

    db.bulk_save_objects(log_objects)
    db.commit()

    return {
        "imported": trip_id,
        "logs_imported": len(log_objects),
        "logs_skipped":  skipped,
        "message": f"Imported {len(log_objects)} logs into trip {trip_id}",
    }


# ── Stale trip cleanup ──────────────────────────────────────────────────
# Field-readiness: if a conductor's phone dies or the End-Trip call fails
# permanently, the trip stays ACTIVE and pollutes the public dashboard.
# An admin can call this endpoint to auto-end trips older than the
# threshold so the dashboard stays accurate.

@app.get("/admin/aggregate", tags=["Admin"])
def get_aggregate_dashboard(date: str = None, db: Session = Depends(get_db)):
    """
    Aggregate analytics across completed trips.
    Optional ?date=YYYY-MM-DD filters to trips that started on that date (PHT).
    Without a date, aggregates all completed trips.
    """
    from datetime import timedelta, date as dt_date
    from app.analytics.algorithms import categorise_time, classify_demand

    PHT_OFFSET = timedelta(hours=8)

    trips_q = db.query(Trip).filter(Trip.status == TripStatusEnum.COMPLETED)

    # Filter by date if provided (compare in PHT = UTC+8)
    if date:
        try:
            target = dt_date.fromisoformat(date)
            # start_time is stored as UTC — shift to PHT for comparison
            from datetime import datetime
            day_start_pht = datetime(target.year, target.month, target.day, 0,  0,  0)
            day_end_pht   = datetime(target.year, target.month, target.day, 23, 59, 59)
            day_start_utc = day_start_pht - PHT_OFFSET
            day_end_utc   = day_end_pht   - PHT_OFFSET
            trips_q = trips_q.filter(
                Trip.start_time >= day_start_utc,
                Trip.start_time <= day_end_utc,
            )
        except ValueError:
            pass  # invalid date format — fall through to all trips

    trips = trips_q.order_by(Trip.start_time.desc()).all()

    if not trips:
        return {
            "total_trips":         0,
            "total_logs":          0,
            "avg_load_factor_pct": 0,
            "time_distribution":   {"Morning Peak": 0, "Midday": 0, "Afternoon Peak": 0, "Off-Peak": 0},
            "demand_distribution": {"Normal": 0, "Moderate": 0, "High": 0, "Critical": 0},
            "peak_critical_period": None,
            "trip_summaries":       [],
        }

    # Aggregate across all trips
    time_dist    = {"Morning Peak": 0, "Midday": 0, "Afternoon Peak": 0, "Off-Peak": 0}
    demand_dist  = {"Normal": 0, "Moderate": 0, "High": 0, "Critical": 0}
    critical_by_period = {"Morning Peak": 0, "Midday": 0, "Afternoon Peak": 0, "Off-Peak": 0}

    all_lf_values = []
    trip_summaries = []

    for trip in trips:
        logs = (
            db.query(GPSLog)
            .filter(GPSLog.trip_id == trip.trip_id)
            .all()
        )
        if not logs:
            continue

        cap = trip.official_capacity or 26
        trip_lf_values = []
        trip_demand = {"Normal": 0, "Moderate": 0, "High": 0, "Critical": 0}
        trip_time   = {"Morning Peak": 0, "Midday": 0, "Afternoon Peak": 0, "Off-Peak": 0}

        for log in logs:
            # Load factor
            lf = log.occupancy_count / cap
            trip_lf_values.append(lf)
            all_lf_values.append(lf)

            # Time period
            if log.timestamp:
                period = categorise_time(log.timestamp)
                time_dist[period]   = time_dist.get(period, 0) + 1
                trip_time[period]   = trip_time.get(period, 0) + 1

                # Demand tier
                tier = classify_demand(log.occupancy_count, cap)
                demand_dist[tier]  = demand_dist.get(tier, 0) + 1
                trip_demand[tier]  = trip_demand.get(tier, 0) + 1

                # Critical by period
                if tier == "Critical":
                    critical_by_period[period] = critical_by_period.get(period, 0) + 1

        avg_lf = sum(trip_lf_values) / len(trip_lf_values) if trip_lf_values else 0
        max_occ = max((l.occupancy_count for l in logs), default=0)
        dominant_tier = max(trip_demand, key=trip_demand.get)
        dominant_period = max(trip_time, key=trip_time.get)

        trip_summaries.append({
            "trip_id":          trip.trip_id,
            "jeep_code":        trip.jeep_code,
            "direction":        trip.direction,
            "date":             trip.start_time.strftime("%Y-%m-%d") if trip.start_time else "—",
            "log_count":        len(logs),
            "avg_lf_pct":       round(avg_lf * 100, 1),
            "max_occupancy":    max_occ,
            "capacity":         cap,
            "dominant_tier":    dominant_tier,
            "dominant_period":  dominant_period,
        })

    grand_avg_lf = sum(all_lf_values) / len(all_lf_values) if all_lf_values else 0
    peak_critical = max(critical_by_period, key=critical_by_period.get) if any(critical_by_period.values()) else None

    return {
        "total_trips":          len(trip_summaries),
        "total_logs":           sum(t["log_count"] for t in trip_summaries),
        "avg_load_factor_pct":  round(grand_avg_lf * 100, 1),
        "time_distribution":    time_dist,
        "demand_distribution":  demand_dist,
        "critical_by_period":   critical_by_period,
        "peak_critical_period": peak_critical,
        "trip_summaries":       trip_summaries,
    }


@app.post("/admin/clean-stale-trips", tags=["Admin"])
def clean_stale_trips(hours: int = 8, db: Session = Depends(get_db)):
    """
    Auto-end any ACTIVE trip whose start_time is older than `hours`.
    Default threshold is 8 hours — longer than any reasonable jeepney shift.
    Returns the list of trip_ids that were closed.
    """
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    stale = (
        db.query(Trip)
        .filter(Trip.status == TripStatusEnum.ACTIVE, Trip.start_time < cutoff)
        .all()
    )

    closed = []
    for trip in stale:
        trip.status   = TripStatusEnum.COMPLETED
        trip.end_time = datetime.utcnow()
        closed.append(trip.trip_id)

    db.commit()

    return {
        "closed_trips": closed,
        "threshold_hours": hours,
        "message": f"Closed {len(closed)} stale trip(s) older than {hours}h.",
    }

