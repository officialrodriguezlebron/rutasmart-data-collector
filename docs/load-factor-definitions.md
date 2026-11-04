# Load factor: two definitions, one label

**Status:** open decision — documented only, no code changed.
**Raised:** Phase 2 UI review, 2026-11-04.
**Blocking:** nothing today. Needs a decision before the figure is cited in the manuscript.

## The symptom

For the same trip (`2026-06-04_MR-J08_MALANDAY-RECTO_4b80`) the Analytics Engine
shows two different numbers under the same words, **on the same screen**:

| Where | Figure | Label shown |
|---|---|---|
| Analytics results panel | **56.0%** | "HOW FULL" / avg load factor |
| Trip Map inspection header | **63%** | "avg load factor" |

Neither is wrong arithmetically. They measure different things.

## What the backend 56.0% represents

Computed in `rutasmart-backend/app/analytics/algorithms.py` and served by
`GET /analytics/{trip_id}/load-factor` as `overall.avg_lf`.

It is the mean load factor **per GPS log**, across every log in the trip:

```
avg_lf = mean( occupancy_count / official_capacity )   over all N logs
```

For this trip: 546 logs, capacity 26 → **56.0%** (max 96.15%, min 3.85%).

Because logs are emitted on a roughly fixed interval, every log carries equal
weight, so this is effectively **time-weighted**: it answers *"on average, how
full was this jeepney over the course of the run?"* The same quantity is
aggregated across trips by `GET /admin/aggregate` as `avg_lf_pct`, which is what
the Admin Overview "Utilization Rate" card reports.

## What the TripMap 63% represents

Computed in the frontend, `rutas-frontend/src/pages/TripMap.jsx:345-346`:

```js
const avgLF = clusterList.length
  ? clusterList.reduce((s, c) => s + (c.load_factor_pct || 0), 0) / clusterList.length
  : 0;
```

It is the **unweighted mean of the per-cluster load factors** of the DBSCAN stop
clusters — 5 clusters for this trip (35%, 60%, 82%, 77%, 76.9% → ≈63%).

Two consequences worth being explicit about:

1. **It only covers dwell points.** Logs that are not in any stop cluster — the
   moving segments, which are the majority of the trip — contribute nothing.
   It answers *"how full was the vehicle at the places it stopped?"*, not
   *"how full was it on this run?"*
2. **It is unweighted.** A 3-point cluster counts as much as a 16-point cluster,
   so a brief stop influences the figure as much as a long one.

## Which definition the thesis should select

**Recommendation: adopt the backend per-log mean (56.0%) as *the* load factor**,
and stop presenting the cluster mean under that name.

Reasons:

- It matches the conventional transport-engineering meaning of load factor
  (passenger-distance or passenger-time over capacity offered). The cluster mean
  corresponds to no standard definition.
- It uses the whole trip, so it is not sensitive to DBSCAN's `eps` and
  `min_samples`. The cluster mean moves whenever those parameters move, which
  would make a headline thesis figure depend on a tuning choice — awkward to
  defend, and it interacts badly with the sensitivity analysis.
- It is already the figure used by `/admin/aggregate`, the Admin Overview
  Utilization Rate card, and the demand-tier logic, so the rest of the system is
  consistent with it.

The per-cluster figure is still useful and should be **kept, relabelled** — it is
a genuine finding about boarding pressure at stops. Suggested wording:
*"avg occupancy at detected stops"*, with the caveat that it is an unweighted
mean over clusters. If it is retained as a headline number, weighting each
cluster by `point_count` would at least make it defensible.

## Exact files that would change

Presentation only. **No analytics, clustering or model code is involved**, so
this cannot alter any research calculation.

| File | Change |
|---|---|
| `rutas-frontend/src/pages/TripMap.jsx:345-346` | Keep the computation; rename the variable to `avgStopLF` to stop it reading as the trip load factor. |
| `rutas-frontend/src/pages/TripMap.jsx:426` | Relabel the header chip from "avg load factor" to "avg occupancy at stops". |
| `rutas-frontend/src/pages/TripMap.jsx` (header strip) | *Optional:* also surface the trip-level figure from `run-all` → `load_factor.overall.avg_lf` so both appear, each correctly named. |

If instead the decision is to show the trip-level figure in the map header, the
value is already fetched — `TripMap` receives the `run-all` payload — so it is a
read from `load_factor.overall.avg_lf` rather than a new request.

## Not changed here

Per the Phase 2 scope, no load-factor calculation was modified. This document
exists so the decision is made deliberately, on the record, rather than by
whichever component happens to render last.
