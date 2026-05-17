# RutaSmart

**A Multi-Feature GPS Analytics System for Modern Jeepney Route Utilization and Occupancy**

RutaSmart is an integrated software system for collecting, processing, and presenting
operational data from modern e-jeepneys serving the Malanday–Recto corridor in
Manila City. It combines a Progressive Web App for in-field data capture, a FastAPI
backend with PostgreSQL persistence, an administrative analytics dashboard, and a
public route-status dashboard accessible without authentication.

This repository is an undergraduate Computer Science thesis at FEU Institute of
Technology. The focus is **software engineering** — system design, multi-tier
architecture, role-based access control, offline resilience, and field deployment
— with classical computational methods (DBSCAN, Haversine, demand classification)
used as one part of the processing pipeline rather than as the central artifact.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Repository Layout](#repository-layout)
4. [Local Setup](#local-setup)
5. [Environment Variables](#environment-variables)
6. [Deployment](#deployment)
7. [API Reference](#api-reference)
8. [Role-Based Access Control](#role-based-access-control)
9. [Offline Resilience](#offline-resilience)
10. [Field-Readiness Features](#field-readiness-features)
11. [Default Credentials](#default-credentials)

---

## System Overview

RutaSmart has three presentation surfaces backed by one data source:

| Surface | Audience | Auth | Function |
|---|---|---|---|
| **Conductor PWA** | Jeepney conductors | Employee ID + PIN | Capture GPS coordinates and passenger counts during active trips |
| **Admin Dashboard** | Transport planners, LGU staff | Email + password | Review trip data, manage conductor accounts, inspect analytics |
| **Public Dashboard** | Passengers (anonymous) | None | View live per-jeepney occupancy and direction on the corridor |

All three are served from the same React frontend deployed on Vercel. They
communicate over HTTPS with a FastAPI backend on Railway, backed by a
PostgreSQL 15 database. A shared API key middleware protects every endpoint
except the public dashboard route and the API root.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  React PWA (Vite, deployed on Vercel)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Conductor    │  │ Admin        │  │ Public Route Dashboard   │ │
│  │ Recording    │  │ Analytics    │  │ /route/MR-001            │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘ │
└─────────┼─────────────────┼───────────────────────┼───────────────┘
          │   HTTPS         │                       │
          ▼                 ▼                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (Python 3.11, deployed on Railway)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Auth Routes  │  │ Trip & GPS   │  │ Analytics Engine         │ │
│  │ JWT + RBAC   │  │ Pydantic     │  │ DBSCAN + Haversine       │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
│  Six-stage GPS pre-processing pipeline                             │
│  API key middleware · Rate limiting (slowapi)                      │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ Internal network
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  PostgreSQL 15 (Railway)                                          │
│  users  ·  trips  ·  gps_logs  ·  devices                         │
│  FK constraints · DB-level integrity constraints                   │
└────────────────────────────────────────────────────────────────────┘
```

**Why this architecture:**

- **Separation of concerns.** The PWA, backend, and database evolve
  independently. Frontend redeploys on every push without touching backend
  state. Backend can swap hosting or harden middleware without modifying
  frontend code.
- **Stateless backend.** The FastAPI service holds no user session state.
  Tokens travel on every request, the database is the only source of truth.
  This is what lets the system run on a free Railway dyno and still recover
  cleanly from restarts.
- **One data source, three audiences.** A single conductor-recorded GPS log
  stream feeds the planner-facing analytics dashboard, the passenger-facing
  public dashboard, and the conductor's own end-of-trip summary — without
  imposing additional capture overhead on the conductor.

---

## Repository Layout

```
rutasmart-data-collector/
├── rutas-frontend/              # React 18 + Vite PWA
│   ├── src/
│   │   ├── components/          # ErrorBoundary, shared components
│   │   ├── hooks/               # useBackendHealth, etc.
│   │   ├── pages/               # Login, Recording, AdminDashboard, ...
│   │   └── services/            # api.js, authService.js, tripService.js
│   ├── .env.example
│   └── package.json
│
├── rutasmart-backend/           # FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── analytics/           # algorithms.py, cluster_evaluation.py
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── routes/              # FastAPI routers per concern
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── database.py
│   │   └── main.py              # App entry — middleware, public endpoints
│   ├── .env.example
│   ├── .gitignore
│   └── requirements.txt
│
├── .gitignore
└── README.md
```

---

## Local Setup

**Prerequisites:** Python 3.11+, Node.js 20+, PostgreSQL 15 (or a Railway-hosted DB URL).

### Backend

```bash
cd rutasmart-backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with your DATABASE_URL, RUTASMART_API_KEY, etc.

uvicorn app.main:app --reload --port 8000
```

The backend exposes Swagger docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd rutas-frontend
npm install

cp .env.example .env.local
# Edit .env.local with VITE_API_URL=http://localhost:8000 and the API key

npm run dev
```

The frontend runs at `http://localhost:5173`.

### Seeding default users

For local development, seed default accounts:

```bash
curl -X POST http://localhost:8000/auth/seed \
     -H "X-API-Key: <your-api-key>"
```

This is disabled when `ENV=production`.

---

## Environment Variables

### Backend (`rutasmart-backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `RUTASMART_API_KEY` | Yes | Shared API key for protected routes |
| `FRONTEND_URL` | No | Production frontend origin for CORS |
| `ENV` | No | `production` disables `/auth/seed`; otherwise development |

### Frontend (`rutas-frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend base URL (no trailing slash) |
| `VITE_API_KEY` | Yes | Must match `RUTASMART_API_KEY` on backend |

Missing `VITE_API_URL` no longer falls back to localhost — the dashboard
prints a clear console error so misconfiguration is caught immediately.

---

## Deployment

### Frontend — Vercel

1. Connect the GitHub repo, set the project root to `rutas-frontend/`.
2. Build command: `npm run build`, output: `dist/`.
3. Environment variables: `VITE_API_URL`, `VITE_API_KEY`.
4. Auto-deploys on every push to `main`.

### Backend — Railway

1. Create a new Railway project, add a PostgreSQL plugin.
2. Add a service from this repo, root: `rutasmart-backend/`.
3. Set environment variables: `DATABASE_URL` (Railway auto-injects),
   `RUTASMART_API_KEY`, `FRONTEND_URL`, `ENV=production`.
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

After both deploys are green, the conductor PWA, admin dashboard, and
public route dashboard at `/route/MR-001` are all live.

---

## API Reference

Full interactive Swagger docs at `<backend>/docs`. Summary:

### Public
| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/public/route/{route_id}` | List active jeepneys on a route — used by the public dashboard |

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login/admin` | Admin login (email + password) |
| POST | `/auth/login/conductor` | Conductor login (employee_id + PIN) |
| POST | `/auth/create` | Public conductor signup |
| POST | `/auth/seed` | Dev only — seed default accounts |
| GET | `/auth/conductors` | List conductor accounts |

### Trips
| Method | Path | Description |
|---|---|---|
| POST | `/trip/start-trip` | Open a new ACTIVE trip |
| POST | `/trip/end-trip/{trip_id}` | Close a trip (COMPLETED) |
| GET | `/trip/export/{trip_id}` | Export trip + GPS logs as CSV |

### GPS Logs
| Method | Path | Description |
|---|---|---|
| POST | `/log/` | Submit a single GPS log |

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/admin/trips` | List all trips |
| GET | `/admin/stats` | Aggregate counts |
| DELETE | `/admin/trip/{trip_id}` | Hard-delete a trip + its logs |
| POST | `/admin/import` | Import a CSV-formatted trip + logs |
| POST | `/admin/clean-stale-trips` | Auto-end ACTIVE trips older than `hours` |

### Analytics
| Method | Path | Description |
|---|---|---|
| GET | `/analytics/{trip_id}/run-all` | Run the entire pipeline at once |
| GET | `/analytics/{trip_id}/pipeline` | Pre-processing pipeline metadata |
| GET | `/analytics/{trip_id}/quality` | GPS quality distribution |
| GET | `/analytics/{trip_id}/dbscan` | Stop cluster detection |
| GET | `/analytics/{trip_id}/load-factor` | Load factor per trip & period |
| GET | `/analytics/{trip_id}/demand` | Demand intensity distribution |
| GET | `/analytics/{trip_id}/time` | Time categorization |
| GET | `/analytics/{trip_id}/sensitivity` | DBSCAN parameter grid |
| GET | `/analytics/{trip_id}/evaluate` | Cluster quality vs ground truth |

---

## Role-Based Access Control

Two roles: **ADMIN** and **CONDUCTOR**.

- **Admin** accounts authenticate with email + password, can access every
  authenticated route, and manage conductor accounts through the admin
  dashboard. Created manually only — not exposed through public signup.
- **Conductor** accounts authenticate with a numeric PIN (4–8 digits) and
  an employee ID. Can create trips, submit GPS logs, end trips, and view
  their own trip summaries. Cannot access analytics or admin routes.

**Hashing.** Passwords and PINs are stored as bcrypt hashes via `passlib`.
Legacy SHA-256 hashes from older deployments are still accepted on login
and silently upgraded to bcrypt on successful authentication.

**Token format.** Currently base64-encoded payload; pre-production migration
to signed JWT via `python-jose` is documented in code comments.

**API key middleware.** Every request except `/`, `/docs`, `/redoc`, and
`/openapi.json` must carry a valid `X-API-Key` header. This is independent
of the user-level JWT and protects the API surface from anonymous traffic.

**Rate limiting.** `slowapi` enforces per-IP limits: 10 logins/minute,
5 signups/minute, 30 GPS submissions/minute.

---

## Offline Resilience

Mobile data along the Malanday–Recto corridor is intermittent — segments
under the LRT-2 viaduct, indoor terminals, and bursts of high cell
congestion routinely cause connection drops. The PWA is designed so that
no GPS log is lost when this happens.

**Implementation:**

1. The Recording screen uses `navigator.geolocation` to capture a position
   every 3 seconds and `navigator.onLine` to detect connectivity.
2. Every captured GPS log is appended to a per-trip queue in
   `localStorage` (`gps_offline_queue_<trip_id>`).
3. When `navigator.onLine` is true (and on a recurring interval), the queue
   is flushed to the backend in order. Successfully transmitted logs are
   removed from the queue.
4. If the device crashes or the browser is closed mid-trip, the queue
   survives. On the next session, the conductor resumes the trip and the
   queue continues to flush.
5. On End Trip, the queue is flushed one final time before the trip is
   marked COMPLETED. End-trip submission retries up to 3 times with
   exponential backoff to handle transient backend errors.

The `useBackendHealth` hook polls the backend root every 30 seconds. The
Recording UI shows a distinct **"Backend unreachable"** banner when the
device has internet but the API is down — distinguishing this from a
plain device-offline state.

---

## Field-Readiness Features

| Feature | What it does |
|---|---|
| **Screen Wake Lock API** | Prevents the phone screen from sleeping during active recording (with an iOS fallback banner where unsupported). |
| **Offline queue + auto-flush** | GPS logs queued in localStorage during connectivity loss, flushed automatically when signal returns. |
| **End-trip retry** | 3 attempts with backoff so a network blip doesn't leave a trip ACTIVE forever. |
| **Backend health banner** | Conductor sees a clear distinct warning when the backend is unreachable vs when the device itself is offline. |
| **Stale-trip cleanup** | `POST /admin/clean-stale-trips` auto-ends trips older than a configurable threshold (default 8h) so the public dashboard stays accurate even if a conductor's phone dies. |
| **React ErrorBoundary** | Top-level boundary so a malformed render in any page never produces a white screen. The conductor can reload and resume. |
| **Route ID locked** | Conductors cannot mis-type the route identifier — it is fixed to `MR-001` in software for the Malanday–Recto corridor. |
| **Per-jeep duplicate ACTIVE guard** | The backend rejects starting a new trip when an ACTIVE trip already exists for the same jeep code. |
| **Database constraints** | The `gps_logs` table rejects negative occupancy values and malformed coordinates at the DB layer, not just at the API layer. |
| **GPS quality classification** | Every log is tagged GOOD / ACCEPTABLE / POOR at ingestion; POOR logs are excluded from spatial clustering to prevent ghost clusters in urban-canyon conditions. |

---

## Default Credentials

After running `/auth/seed` in a development environment:

| Role | Credentials |
|---|---|
| Admin | `admin@rutasmart.ph` / `Admin2026!` |
| Conductor 1 | Employee ID `CDR-2024-042`, PIN `1234`, Jeep `JPN-001` |
| Conductor 2 | Employee ID `CDR-2024-043`, PIN `5678`, Jeep `JPN-002` |

These are seed values for local development and demo only. Production
environments must set `ENV=production` to disable the seed endpoint, then
create accounts manually through the admin dashboard.

---

## License

Academic use only. Developed at FEU Institute of Technology, College of
Computer Studies, as an undergraduate thesis project.
