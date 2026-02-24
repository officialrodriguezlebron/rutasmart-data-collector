from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base

# Models
from app.models.trip import Trip
from app.models.gps_log import GPSLog

# Routers
from app.routes.trip_routes import router as trip_router
from app.routes.gps_routes import router as gps_router

app = FastAPI()

# CORS Config
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://rutasmart-data-collector.onrender.com",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables
Base.metadata.create_all(bind=engine)

# Include routers
app.include_router(trip_router)
app.include_router(gps_router)

@app.get("/")
def read_root():
    return {"message": "RutaSmart Backend Connected to Database"}
