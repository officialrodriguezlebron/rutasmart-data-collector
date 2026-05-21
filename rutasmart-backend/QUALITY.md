# RutaSmart — Software Engineering & Quality Assurance

This document describes how the RutaSmart backend is engineered and verified as
**software**, mapped to the ISO/IEC 25010 product-quality model used in SOP6.
It complements (it does not replace) the analytical evaluation of the stop-
detection algorithm. The distinction matters: the analytical metrics
(Silhouette, Davies-Bouldin, F1, MAE) describe how well a *feature* performs on
data; the material below describes how the *system* is built, validated, and
maintained.

---

## 1. Quality model alignment (ISO/IEC 25010)

| Characteristic | How it is engineered and evidenced |
|---|---|
| **Functional Suitability** | Each analytics function has a documented contract (input/output/edge cases) and an automated test asserting it. 58 tests cover stop detection, load factor, demand tiers, time categorisation, and GPS-quality classification. |
| **Reliability** | Defensive guards on empty/short/malformed input (no unhandled exceptions on degenerate data); the offline queue, end-trip retry with backoff, stale-trip cleanup, and backend health polling provide fault tolerance and recoverability in the field. |
| **Performance Efficiency** | DBSCAN uses a ball-tree index with the Haversine metric (sub-linear neighbour queries); the velocity gate reduces the clustering input by excluding moving points, lowering compute on large merged datasets. |
| **Usability** | Plain-language labels, tooltips, and help banners in the analytics UI translate technical terms for non-technical inspectors (covered by the SOP6 usability criteria). |
| **Security** | Passwords and PINs are bcrypt-hashed with per-record salts; legacy SHA-256 hashes are accepted and transparently upgraded on next login; an API-key middleware gates non-public routes. |
| **Maintainability** | Separation of concerns (models / schemas / routes / analytics); typed function signatures; an automated test suite and CI workflow that runs on every push; named contracts so regressions fail loudly. |
| **Compatibility / Portability** | Stateless FastAPI service; configuration via environment variables (`DATABASE_URL`, `RUTASMART_API_KEY`, `FRONTEND_URL`); deployable on any container host (currently Railway). |

---

## 2. Test suite

The suite lives in `rutasmart-backend/tests/` and is run with `pytest`.

```
tests/
  conftest.py                     # shared fixtures (realistic GPS-point builders)
  test_algorithms_unit.py         # pure-function unit tests
  test_analytics_contracts.py     # aggregation output contracts (SOP4/SOP5)
  test_clustering_integration.py  # DBSCAN pipeline + velocity-gate regression
  test_security.py                # auth, hashing, backward compatibility
```

Test categories (pytest markers):

- `unit` — pure functions, no DB or network
- `contract` — input/output contracts and edge cases (empty input, boundaries,
  parameter extremes)
- `integration` — multiple modules exercised together (full DBSCAN pipeline)
- `regression` — locks in fixed bugs so they can never silently return

### Running the tests

```bash
cd rutasmart-backend
pip install -r requirements.txt
pytest                          # run everything
pytest -m unit                  # only unit tests
pytest -m regression            # only regression guards
pytest --cov=app --cov-report=term-missing   # with coverage
```

---

## 3. Defects found and fixed through testing

Writing the test suite surfaced and fixed real defects — evidence that the
QA process works rather than rubber-stamping the code:

1. **`compute_velocities([])` returned `[0.0]` instead of `[]`.** An empty GPS
   list produced a one-element velocity list, breaking the one-velocity-per-
   point contract that downstream `zip()` calls rely on. Fixed with an explicit
   empty-input guard; locked in by `test_empty_input_returns_empty`.

2. **DBSCAN density chaining on merged traces.** Plain DBSCAN over dense,
   continuous GPS traces (e.g. a full day of trips merged) connected every stop
   into a single chained cluster, so "All Trips" reported 1 stop instead of
   ~68. Fixed with a velocity gate that clusters only dwell points (≤1.0 m/s),
   excluding moving-segment points that bridge stops. Locked in by
   `test_merged_trips_do_not_collapse_to_one_cluster`.

---

## 4. Continuous integration

`.github/workflows/backend-ci.yml` runs the full suite on every push and pull
request that touches `rutasmart-backend/`. A change that breaks a documented
contract fails CI before it can reach the deployed system. The workflow also
enforces a minimum coverage threshold on the analytics core.

---

## 5. The algorithm as an engineered component

The stop-detection pipeline is treated as a software component with an explicit
specification, not an ad-hoc script:

- **Defined inputs:** a list of validated `GPSPoint` records (schema-checked at
  ingestion by Pydantic and table-level constraints).
- **Defined parameters:** `eps_m`, `min_samples`, `exclude_moving`,
  `apply_kalman` — all with documented defaults and ranges.
- **Defined output:** a result dict with a fixed key contract
  (`clusters`, `noise_ratio`, `total_input`, `dbscan_input`, `noise_points`,
  `moving_excluded`), asserted by `test_result_has_required_keys`.
- **Defined failure behaviour:** empty or sub-threshold input returns a
  well-formed empty result rather than raising; parameter extremes degrade to
  "no clusters" rather than crashing (important for the sensitivity-analysis
  grid that sweeps many parameter combinations).
- **Reversible enhancement:** the velocity gate can be disabled
  (`exclude_moving=False`) to reproduce the baseline behaviour for before/after
  comparison in the thesis.

This is what "aligned with software engineering" means here: the algorithm's
correctness is asserted by tests against a written contract, its failure modes
are defined and handled, and any regression is caught automatically.
