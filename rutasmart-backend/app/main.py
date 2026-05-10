from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
import os

from app.database import engine, Base, get_db
from app.models.trip import Trip
from app.models.gps_log import GPSLog
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
    # Vercel deployments — main + preview URLs
    "https://rutasmart-data-collector.vercel.app",
    "https://rutas-frontend.vercel.app",
]

# Also allow any origin set via env var (paste your exact Vercel URL here)
FRONTEND_URL = os.getenv("FRONTEND_URL", "")
if FRONTEND_URL and FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
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

@app.get("/admin/trips", tags=["Admin"])
def get_all_trips(db: Session = Depends(get_db)):
    trips = db.query(Trip).order_by(Trip.start_time.desc()).limit(100).all()
    return [{"trip_id": t.trip_id, "jeep_code": t.jeep_code, "route_id": t.route_id,
             "direction": t.direction, "status": t.status,
             "start_time": str(t.start_time),
             "end_time": str(t.end_time) if t.end_time else None,
             "official_capacity": t.official_capacity} for t in trips]

@app.get("/admin/stats", tags=["Admin"])
def get_system_stats(db: Session = Depends(get_db)):
    from app.models.trip import TripStatusEnum
