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
]

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
if FRONTEND_URL and FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key"],
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
    from sqlalchemy import desc

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

    new_trip = Trip(
        trip_id=trip_id,
        route_id=first.get("route_id", "MR-001"),
        direction=first.get("direction", "Malanday-Recto"),
        recorder_id=first.get("device_id", "IMPORTED"),
        jeep_code=jeep_code,
        official_capacity=capacity,
        starting_occupancy=int(first.get("occupancy_count", 0)),
        status=TripStatusEnum.COMPLETED,
        start_time=datetime.utcnow(),
        end_time=datetime.utcnow(),
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

        # Classify quality from accuracy
        if acc <= 20:
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
