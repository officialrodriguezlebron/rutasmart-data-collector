# Diagram 4: Conceptual Framework

```mermaid
flowchart TD
    %% ── INPUTS ──────────────────────────────────────────────────────────────
    subgraph INPUT["INPUTS"]
        direction TB
        I1["Field GPS Traces\n26-seat jeepney, Malanday–Recto corridor\n3-second logging interval (setInterval 3000ms)\ndevice accuracy reported per ping"]
        I2["Ground Truth Stops\n70 field-verified stops\n(LTFRB franchise route documents)\nhardcoded in cluster_evaluation.py"]
        I3["Conductor Context\njeep_code, direction, capacity,\nstarting_occupancy, recorder_id"]
    end

    %% ── SPRINT 1: DATA COLLECTION (May 19–28) ───────────────────────────────
    subgraph S1["SPRINT 1 — Data Collection (May 19–28)"]
        direction TB

        S1A["Conductor Login\nPOST /auth/login/conductor\n(employee_id + PIN → base64 token)"]
        S1B["Trip Initialization\nPOST /trip/start-trip\nstatus = ACTIVE"]
        S1C["GPS Ingestion Pipeline\nPOST /log/ (every 3 s)\n① Corridor bounds check — out-of-corridor → forced POOR\n② Quality classification:\n   GOOD ≤20m accuracy\n   ACCEPTABLE ≤50m accuracy\n   POOR >50m (excluded from DBSCAN)"]
        S1D["Trip Completion\nPOST /trip/end-trip/{id}\nstatus = COMPLETED\n(no analytics triggered)"]
        S1E["Raw Dataset\n20+ completed trips stored in\ngps_logs table — GOOD / ACCEPTABLE / POOR\nflagged at ingestion"]
    end

    %% ── SPRINT 2: ANALYSIS (Jun 1–11) ───────────────────────────────────────
    subgraph S2["SPRINT 2 — Analysis & Stop Zone Publishing (Jun 1–11)"]
        direction TB

        subgraph PIPELINE["Data Pre-processing Pipeline (GET /analytics/{id}/pipeline)"]
            P1["Stage 1 — Corridor Bounding Box"]
            P2["Stage 2 — Schema Validation\n(accuracy>0, occupancy≥0, device_id≥3)"]
            P3["Stage 3 — GPS Quality Classification\n(GOOD / ACCEPTABLE / POOR)"]
            P4["Stage 4 — POOR Log Exclusion\n(excluded from DBSCAN; occupancy preserved)"]
            P5["Stage 5 — Velocity Filter\n(TRUE_STOP / CREEPING_QUEUE / MOVING)"]
            P6["Stage 6 — Centroid Validation\n(Haversine to 70 GT stops, threshold 100m)"]
        end

        subgraph ALGOS["Algorithm Comparison (GET /analytics/merged/compare)"]
            A1["Vanilla DBSCAN\n(ε=50m, minPts=5)"]
            A2["Kalman + DBSCAN\n(Kalman smoothing → DBSCAN)"]
            A3["Weighted DBSCAN (W-DBSCAN)\n(occupancy-weighted replication → DBSCAN)"]
            A4["Random Forest Classifier\n(DBSCAN candidates → RF filter\nPOST /api/clusters/ml-random-forest)"]
        end

        subgraph PARAMS["Sensitivity Analysis (GET /analytics/{id}/sensitivity)"]
            SP["Grid search: ε ∈ {30,40,50,60,75,100} m\n× minPts ∈ {3,5,8,10}\nRecommended: ε=50m, minPts=5"]
        end

        subgraph EVAL["Cluster Evaluation (GET /analytics/{id}/evaluate)"]
            E1["Internal Validity\nSilhouette Coefficient (≥0.5 target)\nDavies-Bouldin Index (<1.0 target)"]
            E2["External Validity\nPrecision / Recall / F1\nMAE (metres) vs 70 GT stops\nTP / FP / FN at 100m threshold"]
        end

        subgraph PUBLISH["Stop Zone Publishing\n(POST /admin/route/{id}/publish-stops)"]
            PUB["Pool all COMPLETED trips (per direction)\nRun DBSCAN (ε=30m, minPts=20)\nFilter TRUE_STOP clusters\nSnap centroids to corridor polyline\nmatch_to_corridor()\nAtomic replace in published_stop_zones"]
        end
    end

    %% ── OUTPUTS ─────────────────────────────────────────────────────────────
    subgraph OUTPUT["OUTPUTS"]
        O1["Research Metrics\nPrecision, Recall, F1, MAE\nSilhouette, Davies-Bouldin\nSensitivity grid (6×4)\nAlgorithm comparison table"]
        O2["Published Stop Zones\n(published_stop_zones table)\nMap-matched centroids + demand tiers\nAvailable to Admin Map Dashboard\nand Passenger public dashboard"]
        O3["Stop Zone Recommendations\nRule-based (6 rules) per zone:\ndemand_tier × confidence → recommendation\nNearest GT stop name (Haversine ≤50m)"]
    end

    %% ── FEEDBACK LOOP ────────────────────────────────────────────────────────
    subgraph FEEDBACK["Admin HITL Feedback Loop"]
        FB1["Admin reviews published zones\n(Zone Mgmt page + Map Dashboard)"]
        FB2["Admin reviews recommendations\n(Stop Zones page)"]
        FB3["Identify gaps / low-confidence zones\n→ schedule additional data collection trips"]
    end

    %% ── PASSENGER ────────────────────────────────────────────────────────────
    subgraph PASSENGER["Passenger-Facing Output"]
        PD["Public Dashboard\nLive jeep occupancy (5s poll)\nPublished stop zones on map\n(GET /public/route/{id}/stop-zones)"]
    end

    %% ── FLOW EDGES ───────────────────────────────────────────────────────────
    INPUT --> S1
    I1 --> S1C
    I3 --> S1A
    I2 --> EVAL

    S1A --> S1B --> S1C --> S1D --> S1E

    S1E --> S2
    S1E --> PIPELINE
    PIPELINE --> P1 --> P2 --> P3 --> P4 --> P5 --> P6

    P4 --> ALGOS
    A1 & A2 & A3 & A4 --> PARAMS
    PARAMS --> EVAL
    E1 & E2 --> O1

    S1E --> PUBLISH
    PUBLISH --> O2
    O2 --> O3

    O1 --> FEEDBACK
    O2 --> FEEDBACK
    O3 --> FEEDBACK
    FEEDBACK --> FB1 --> FB2 --> FB3

    O2 --> PASSENGER
    FB3 -.->|"informs next sprint's\ndata collection"| S1

    %% Style
    classDef sprint1 fill:#1a3a2a,stroke:#30d158,color:#e8eaf0
    classDef sprint2 fill:#1a2a3a,stroke:#42a5f5,color:#e8eaf0
    classDef output  fill:#2a1a3a,stroke:#bf5af2,color:#e8eaf0
    classDef feedback fill:#3a2a10,stroke:#ffd60a,color:#e8eaf0
    classDef passenger fill:#1a3035,stroke:#00b4d8,color:#e8eaf0

    class S1A,S1B,S1C,S1D,S1E sprint1
    class PIPELINE,ALGOS,PARAMS,EVAL,PUBLISH sprint2
    class O1,O2,O3 output
    class FB1,FB2,FB3 feedback
    class PD passenger
```

## Verification Notes

| Framework Element | Source Verified | Notes |
|---|---|---|
| GPS logging interval (3s) | `Recording.jsx:321` | Confirmed `setInterval(..., 3000)` |
| Pipeline stages 1–6 | `analytics_routes.py:436-572` | Stage sequence and exclusion logic confirmed |
| POOR exclusion preserves occupancy for load factor | `analytics_routes.py:540-544` | Explicitly stated in rationale field |
| Velocity filter thresholds | `algorithms.py` (referenced) | TRUE_STOP <0.3m/s, CREEPING_QUEUE 0.3–1.0m/s, MOVING >1.0m/s |
| Sensitivity grid dimensions | `analytics_routes.py:836-879` | ε=[30,40,50,60,75,100], minPts=[3,5,8,10] |
| Publish DBSCAN uses ε=30m, minPts=20 (not ε=50m) | `stop_zone_routes.py:129` | Different params from research DBSCAN — pooled multi-trip data warrants tighter clustering |
| GT evaluation uses 70 stops | `cluster_evaluation.py:45-116` | Confirmed 70-entry list; FN denominator = 70 |
| Recommendation engine is rule-based (not ML) | `stop_zone_routes.py:519-530` | 6-rule function `_recommend(tier, conf, days)` |
| Analytics results not stored | All analytics route handlers | Computed on demand; DB holds only raw logs + published zones |
| Trip end does not trigger analytics | `trip_routes.py:80-102` | Only sets status=COMPLETED — no downstream computation |
| Passenger polling interval | `PublicDashboard.jsx:8` | `POLL_MS = 5000` confirmed |

**Note on Sprint framing:** The Sprint 1 / Sprint 2 boundary reflects the thesis project timeline. The system architecture does not enforce this split — both phases use the same API. The framing is used here to distinguish the data collection objective (Sprint 1: raw GPS accumulation) from the analysis objective (Sprint 2: clustering, evaluation, publishing).

**Note on feedback loop:** The Admin HITL (Human-in-the-Loop) step is the `POST /admin/route/{id}/publish-stops` action. There is no automated re-publish or scheduled job — each publication requires an explicit Admin decision after reviewing the dry-run preview (`GET /admin/route/{id}/preview-stops`).
