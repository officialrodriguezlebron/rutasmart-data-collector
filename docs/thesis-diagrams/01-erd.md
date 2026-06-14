# Diagram 1: Entity-Relationship Diagram

```mermaid
erDiagram
    TRIPS {
        string  trip_id          PK "date_jeepcode_dir_hex4"
        string  route_id         "e.g. MR-001"
        string  direction        "MALANDAY-RECTO | RECTO-MALANDAY"
        string  recorder_id      "user_id value — no FK constraint"
        string  jeep_code
        int     official_capacity
        int     starting_occupancy
        enum    status           "ACTIVE | COMPLETED | CANCELLED"
        datetime start_time
        datetime end_time        "nullable"
        datetime created_at
    }

    GPS_LOGS {
        int      id                      PK "auto-increment"
        string   log_id                  UK "trip_id_hex6"
        string   trip_id                 FK
        string   device_id
        float    latitude
        float    longitude
        float    accuracy                "metres"
        int      occupancy_count
        bool     over_capacity_flag
        enum     gps_quality_flag        "GOOD | ACCEPTABLE | POOR"
        datetime gps_timestamp           "nullable — device fix time (KPI)"
        int      client_seq              "nullable — sequence counter (KPI)"
        datetime client_online_event_at  "nullable — reconnect event (KPI)"
        datetime timestamp               "server insert UTC"
    }

    USERS {
        string  user_id       PK "USR-xxxxxx"
        enum    role          "ADMIN | CONDUCTOR"
        string  email         UK "nullable — admin only"
        string  password_hash    "nullable — bcrypt, admin only"
        string  employee_id   UK "nullable — conductor only"
        string  pin_hash         "nullable — bcrypt, conductor only"
        string  jeep_code        "nullable — conductor only"
        string  display_name
        bool    is_active
        datetime created_at
    }

    PUBLISHED_STOP_ZONES {
        int      id              PK
        string   route_id        "string match to trips.route_id — no FK"
        string   direction       "MALANDAY-RECTO | RECTO-MALANDAY"
        int      cluster_id
        float    lat             "map-matched centroid"
        float    lon             "map-matched centroid"
        int      point_count
        string   demand_tier     "Normal | Moderate | High | Critical"
        float    avg_occupancy
        string   peak_period
        float    load_factor_pct
        string   color           "hex color for UI"
        int      rank
        datetime published_at
        int      trips_analyzed  "aggregate count — not a FK"
        int      logs_analyzed   "aggregate count — not a FK"
    }

    GROUND_TRUTH_STOPS_LIST {
        string  name  "stop name"
        float   lat
        float   lon
    }

    GPS_LOGS }o--|| TRIPS : "trip_id (DB FK constraint)"
    TRIPS }o--o| USERS : "recorder_id = user_id (app-level only, no FK)"
    PUBLISHED_STOP_ZONES }o--o{ TRIPS : "route_id string match (no FK)"
    PUBLISHED_STOP_ZONES }o--o{ GROUND_TRUTH_STOPS_LIST : "Haversine <= 50m at query time (no stored link)"
```

## Verification Notes

| Claim | Verified Against | Result |
|---|---|---|
| `gps_logs.trip_id` is a FK | `app/models/gps_log.py:39` — `ForeignKey("trips.trip_id")` | ✅ Confirmed DB constraint |
| `trips.recorder_id` is FK to `users` | `app/models/trip.py:38` — bare `Column(String, nullable=False)`, no ForeignKey | ❌ App-level match only |
| `published_stop_zones.trips_analyzed` is a FK | `app/models/published_stop_zone.py:33-34` — `Column(Integer, ...)` aggregate counts | ❌ No FK — just counters |
| GROUND_TRUTH_STOPS is a DB table | `app/analytics/cluster_evaluation.py:45-116` | ❌ Hardcoded Python list (70 entries), no table |
| published_stop_zones ↔ GROUND_TRUTH link | `app/routes/stop_zone_routes.py:511-517` — `_nearest_gt()` uses Haversine ≤50m loop at request time | ✅ Computed, no stored link |
| API key enforcement | `app/main.py:62-75` — middleware checks `X-API-Key` header on all routes except `/docs`, `/openapi.json`, `/redoc` | ✅ Server-enforced |
| Role enforcement | All route handlers — no role check found in any handler | ❌ Client-side only (React guards) |

**Note for Chapter 3:** `recorder_id` stores the conductor's `user_id` value but is not a relational FK. The schema intentionally avoids cascading deletes — deleting a user account does not delete their trip history.

**Note for Chapter 3:** `GROUND_TRUTH_STOPS` is represented as a logical entity because it participates in the evaluation pipeline, but it has no corresponding database table. It is a constant Python list embedded in `cluster_evaluation.py` (70 field-verified stops, sourced from LTFRB franchise route documents).
