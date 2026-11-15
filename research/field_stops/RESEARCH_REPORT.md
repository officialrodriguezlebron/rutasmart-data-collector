# Field-reported stop coordinates - research report

**Status: research only. No application code was changed. Nothing staged or committed.**

Generated from `research/field_stops/` by `make_report.py`. Re-runnable offline.

Scope: resolve the passenger and conductor field findings for the Malanday-Recto
corridor to coordinates using Google Places API (New) Text Search, then recommend
a threshold for labelling detected clusters by nearest field stop.

The four datasets are kept separate and are **not** merged:

| Dataset | Where it lives | Count | Touched here |
|---|---|---|---|
| Detected hotspots | computed per request, `/analytics/merged/run-all` | 11 in the captured run | read only |
| Field-reported stops | `research/field_stops/` (new) | 150 raw / 90 distinct | **produced here** |
| Published passenger zones | `stop_zones` table | 38 | read only |
| Manuscript ground truth | `GROUND_TRUTH_STOPS` in code | 70 | read only, unchanged |

No recall, precision, F1 or Evaluation value was recomputed or altered. Nothing
in this report is called a verified stop.

## 1. Repository findings

| Finding | Location | Detail |
|---|---|---|
| Manuscript ground truth | `rutasmart-backend/app/analytics/cluster_evaluation.py` -> `GROUND_TRUTH_STOPS` | **exactly 70 entries**, `(name, lat, lon)` |
| Nearest-stop labelling already exists | `rutasmart-backend/app/routes/stop_zone_routes.py` -> `_nearest_gt_banded()` | bands `_NEAR_M = 50.0`, `_APPROX_M = 120.0`; emits `near X` / `near X (approx.)` / `New area near X` |
| Corridor geometry | `rutasmart-backend/app/analytics/algorithms.py` | `CORRIDOR` 110 vertices, `RETURN_CORRIDOR` 156 vertices, 7 decimal places |
| Defunct geocoding attempt | `rutasmart-backend/app/analytics/geocode_stops.py` | Nominatim pipeline, `FORWARD_STOPS` 76 / `RETURN_STOPS` 70; **the CSVs it writes do not exist in the repo** |
| Demand tier source | `algorithms.py:555` | `classify_demand(max_occ, official_capacity)` - tier is driven by **max_occupancy**, not the mean |

### The precision ceiling in `GROUND_TRUTH_STOPS`

The 70 entries are real, but **coarse**, and that caps how precisely anything can
be matched against them:

| Measure | Value |
|---|---|
| Entries | 70 |
| Distinct latitudes | 69 |
| Distinct longitudes | 26 across 70 stops |
| Latitude decimal places | 4 dp: 60; 3 dp: 8; 2 dp: 2 |
| Longitude decimal places | 3 dp: 65; 2 dp: 5 |

At this latitude 4 dp is about 11 m, 3 dp about 110 m, 2 dp about 1.1 km.
Entries rounded to 2-3 dp therefore carry **more positional uncertainty than any**
**matching threshold worth setting**. This is the central reason the researched
coordinates should stay a separate dataset rather than become a correction to the
ground truth: correcting it would change the Evaluation inputs.

## 2. Current cluster data flow

```
AdminMap.jsx / AnalyticsEngine.jsx
  |- useCorridorAnalytics({ direction, range })       components/admin/useCorridorAnalytics.js
      |- fetchMerged(ids, epsM=50, minSamples=5)      module cache, key `${ids}|${eps}|${minPts}`
          |- runMergedAll(tripIds, epsM, minSamples)  services/api.js
              |- GET /analytics/merged/run-all?trip_ids=...&eps_m=50&min_samples=5
                  |- analytics_routes.py:170
                      |- one query for Trip rows            (batched)
                      |- _fetch_points_bulk(trip_ids)       (batched, ORDER BY trip_id, timestamp)
                      |- run_dbscan / kalman / wdbscan  ->  List[StopCluster]
```

Properties that matter for a matching feature:

- Clusters are **computed per request and never stored**. There is no cluster table,
  so there is nowhere to persist a label today.
- `eps_m = 50`, `min_samples = 5` are the defaults the map uses.
- The frontend cache is module-level, so switching direction reuses the response.
- Published zones arrive from a **separate** call, `GET /stop-zones/recommendations`,
  deferred until the Zones tab is opened.

## 3. Current hotspot API response

`StopCluster` (`algorithms.py:356`) is the per-cluster contract. Any matching
feature must be purely additive to it:

| Field | Type | Meaning |
|---|---|---|
| `cluster_id` | int | index within the run; **not stable across runs** |
| `centroid_lat` | float | occupancy-weighted centroid |
| `centroid_lon` | float | occupancy-weighted centroid |
| `point_count` | int | member GPS logs |
| `avg_occupancy` | float | mean occupancy |
| `max_occupancy` | int | **drives `demand_tier`** |
| `demand_tier` | str | Normal / Moderate / High / Critical |
| `peak_period` | str | Morning Peak / Midday / Afternoon Peak / Off-Peak |
| `load_factor_pct` | float | avg occupancy / official capacity x 100 |
| `noise_ratio_pct` | float | share of POOR logs excluded before clustering |
| `avg_velocity_ms` | float | mean member speed |
| `cluster_type` | str | TRUE_STOP / CREEPING_QUEUE / MOVING |

**There is no name, label or stop-identity field on a cluster today.** Nothing in
the response says which real-world stop a cluster sits at. That is the gap this
research would fill.

## 4. Current map rendering flow

`rutas-frontend/src/pages/admin/AdminMap.jsx`:

- react-leaflet `MapContainer` + `TileLayer`.
- `Polyline` for the corridor: `color={corridorColor}`, opacity 0.55, weight 2.5.
- Detected hotspots: filled `CircleMarker` from `a.dbscan?.clusters ?? []`, with
  `fillColor={DEMAND_COLOR[c.demand_tier]}` and fallback `#8e9ab0`.
- Each marker has a `Popup` carrying the tier chip and the cluster metrics.
- Published zones are listed in a **separate tab** and are no longer drawn on the
  canvas (that was the earlier Demand Hotspots refinement).
- `DEMAND_COLOR` is imported from `utils/adminFormatters.js`, the shared palette.

A nearest-stop label would surface inside the existing `Popup` and in the list
rows. **No new map layer is required.**

## 5. Raw counts

| Direction | Raw entries |
|---|---|
| MALANDAY-RECTO (forward) | 79 |
| RECTO-MALANDAY (return) | 71 |
| **Total** | **150** |

Source: `research/field_stops/raw_findings.py`, preserved verbatim including the
spellings `Encamacion`, `MacDonalds`, `3th`, `2th` and the repeated Araneta Square
Mall rows. Nothing in that file was edited.

## 6. Normalized counts

| Measure | Count |
|---|---|
| **Distinct places overall** | **90** |
| Distinct in forward | 77 |
| Distinct in return | 70 |
| Appearing in both directions | 57 |
| Forward only | 20 |
| Return only | 13 |

Normalisation only groups candidates so Google is queried once per distinct place.
It never decides what a stop is, and the original string travels with every record
as `source_name`.

## 7. Duplicates and aliases

### Exact duplicates within one direction

| Direction | Sequences | Entry |
|---|---|---|
| MALANDAY-RECTO | 41, 42 | Araneta Square Mall, Samson Road, Caloocan City |
| MALANDAY-RECTO | 69, 74 | Felix Huertas, City of Manila |
| RECTO-MALANDAY | 2, 8 | Oroquieta, City of Manila |

### Different field entries that Google resolved to the SAME place id

These are the pins a reviewer must settle: one physical point is currently
serving two separately reported stops.

| Google place | Entry A | Entry B |
|---|---|---|
| Tomas mapua sta.Cruz manila | Tomas Mapua / Batangas Intersection, City of Manila | Tomas Mapua / Camarines Intersection, City of Manila |
| Barangay 378 Barangay Hall | Oroquieta / Alvarez Intersection, City of Manila | Oroquieta / Mayhaligue Intersection, City of Manila |
| McDonald's Rizal Ave Grace Park East | Rizal Avenue / Asistio Intersection, Caloocan City | MacDonalds, Rizal Avenue, Caloocan City |

### Alias groups flagged for manual review

| Group | Why it is ambiguous |
|---|---|
| Hypermarket Monumento / Araneta Square / Araneta Square Mall (x2) / Monumento | Five rows around Monumento; may be one, two or four distinct stops |
| Isetann / Recto LRT / Claro M. Recto | Recto terminus cluster; Isetann adjoins Recto LRT |
| Santos Encamacion Elementary School | Likely 'Encarnacion'; confirm against signage before accepting the pin |
| Parish Church or Isidro Labrador | 'or' reads as a transcription of 'of San Isidro Labrador' |
| Jollibee vs Jollibee (near Governor Santiago Road) | The return row adds a locator; same branch or a second one |
| Valenzuela City People's Park vs South Supermarket vs Flying V Gas | All three described as 'near City Hall'; same stretch, three landmarks |

## 8-12. Complete Google research table

One row per **distinct place** (90), ordered by forward route sequence then
return-only entries. Columns cover item 8 (the research table), 9 (Place IDs),
10 (coordinates for every resolved stop), 11 (Google Maps URLs) and 12 (confidence).

Machine-readable form: `research/field_stops/out/review_table.csv`, and
`out/google_results.json`, which also keeps **every rejected candidate and why**.

> Confidence is assigned by `google_research.py:score()` from corridor distance plus
> name and city agreement. It scores **search quality, not correctness**. Section 13
> and section 14 list cases where a `high` is still wrong - read those before
> trusting this column.

| # | Field entry (verbatim) | Google display name | Lat | Lon | Off-corridor | Conf | Place ID | Map |
|---|---|---|---|---|---|---|---|---|
| 1 | C.P. Enerton Fuel Station, MacArthur Highway, Valenzuela City, Philippines | Orange Fuel - Valenzuela | 14.694540 | 120.964329 | 32 m | high | `ChIJPzH3UT-1lzMRKAzJpS6_63w` | [map](https://maps.google.com/?cid=9001498487300885544&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 2 | MacArthur Highway / E. Pantaleon Intersection, Valenzuela City | 593 Mcarthur Highway, Valenxuela, Metro Manila | 14.716334 | 120.957461 | 30 m | medium | `ChIJvWwxRgCzlzMRmE6jyWpvWfI` | [map](https://maps.google.com/?cid=17463111534545948312&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 3 | MacArthur / Del Pilar Intersection, Malanday, Valenzuela City | Total (Malanday) | 14.717961 | 120.956997 | 12 m | high | `ChIJhYuWqkmzlzMRGqGQImNksSI` | [map](https://maps.google.com/?cid=2499889645111779610&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 4 | Malanday Tricycle and Pedicab Terminal, MacArthur Highway, Malanday, Valenzuela City | Malanday Terminal | 14.718954 | 120.957454 | 11 m | high | `ChIJF3QFwL2zlzMRV-vbcLEw7XE` | [map](https://maps.google.com/?cid=8209271234427087703&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 5 | Mercury Drug Store, MacArthur Highway, Malanday, Valenzuela City | Mercury Drug Malanday McArthur Highway | 14.717484 | 120.957072 | 13 m | high | `ChIJ2ebiI5azlzMRzXWYPGGQRsg` | [map](https://maps.google.com/?cid=14431380803258185165&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 6 | Marisyl School, MacArthur Highway, Malanday Valenzuela City | Marisyl School | 14.715033 | 120.957724 | 29 m | high | `ChIJ62bqQpazlzMRA0bbJRCHvMQ` | [map](https://maps.google.com/?cid=14176354230479832579&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 7 | MacArthur Highway / Santiago Road Interchange, Dalandanan, Valenzuela City | T Santiago | 14.709288 | 120.959907 | 29 m | high | `ChIJoz-dMZKzlzMRhiM4btxfgJ4` | [map](https://maps.google.com/?cid=11421234055358194566&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 8 | Ign Pharmacy, MacArthur Highway, Dalandanan, Valenzuela City | Nightingale Pharmacy & Mini Mart Valenzuela | 14.709420 | 120.959902 | 43 m | high | `ChIJ29MRHz-zlzMRZLDm06aVkDA` | [map](https://maps.google.com/?cid=3499461454219096164&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 9 | Dalandanan, Fire sub station, MacArthur Highway, Dalandanan, Valenzuela City | Dalandanan Fire Sub Station | 14.704246 | 120.961319 | 36 m | high | `ChIJQ9_CUoyzlzMRKUztFpGwzkY` | [map](https://maps.google.com/?cid=5102209565058747433&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 10 | Dalandanan Health Centre, MacArthur Highway, Dalandanan, Valenzuela City | Dalandanan Health Station | 14.704208 | 120.961246 | 41 m | high | `ChIJHx0trY2zlzMRPWNtWxWoaeY` | [map](https://maps.google.com/?cid=16602986310959719229&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 11 | Santos Encamacion Elementary School, MacArthur Highway, Dalandanan, Valenzuela City | Santos Encarnacion E/S | 14.702621 | 120.964372 | 251 m | medium | `ChIJ3YXwyYyzlzMRghhJK1QCVqg` | [map](https://maps.google.com/?cid=12129885206895728770&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 12 | Iglesia Ni Cristo, MacArthur Highway, Dalandanan, Valenzuela City | Iglesia Ni Cristo [CaMaNaVa] - Karuhatan | 14.687362 | 120.973923 | 145 m | high | `ChIJcdRshVW1lzMROAx39g-pyzA` | [map](https://maps.google.com/?cid=3516089820117404728&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 13 | Galdrine Industrial Corp., MacArthur Highway, Dalandanan, Valenzuela City | Galdrine Industrial Corporation | 14.698559 | 120.962177 | 111 m | high | `ChIJP44f_4qzlzMRPovCl4NasBU` | [map](https://maps.google.com/?cid=1562848591930886974&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 14 | MacArthur Highway / San Miguel Interchange, Dalandanan, Valenzuela City | dalandanan | 14.692163 | 120.970120 | 44 m | medium | `ChIJM0ydAQC1lzMRW4L0BuO9hSc` | [map](https://maps.google.com/?cid=2847891122153620059&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 15 | Parish Church or Isidro Labrador, MacArthur Highway, Malinta, Valenzuela City | San Isidro Labrador Parish Church - Malinta, Valenzuela City (Diocese of Malolos) | 14.695253 | 120.964777 | 69 m | high | `ChIJ6fHGUnW0lzMRNydrHs5oV2I` | [map](https://maps.google.com/?cid=7086247773173655351&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 16 | Jollibee, MacArthur Highway, Malinta, Valenzuela City | Jollibee - Malanday Crossing | 14.709008 | 120.959782 | 13 m | high | `ChIJT6bpNNuzlzMR0cNcMpsyD2U` | [map](https://maps.google.com/?cid=7282094764627641297&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 17 | Malinta Elementary School, MacArthur Highway, Malinta, Valenzuela City | Malinta Elementary School - Valenzuela City | 14.691904 | 120.965862 | 86 m | high | `ChIJn0kgQgu0lzMRweSrxpmTz7Q` | [map](https://maps.google.com/?cid=13028794535678567617&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 18 | MacArthur Highway / Maysan Road Intersection, Malinta, Valenzuela City | 13 Maysan Road, Malinta, Valenzuela City | 14.693900 | 120.967094 | 116 m | high | `ChIJ34isHQC1lzMRYznQLloYPV8` | [map](https://maps.google.com/?cid=6862668182794025315&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 19 | Valenzuela City People's Park (near City Hall), MacArthur Highway, Valenzuela City | Valenzuela City People's Park | 14.692137 | 120.970164 | 48 m | high | `ChIJ0R4-1wu0lzMR477QSV-xY4A` | [map](https://maps.google.com/?cid=9251433082367557347&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 20 | Bureau of Telecom Training Institute, MacArthur Highway, Valenzuela City | DICT-Valenzuela Campus (formerly Telecom Training Institute) | 14.690969 | 120.973874 | 44 m | high | `ChIJsVPj7wi0lzMRq45SQHkqcBs` | [map](https://maps.google.com/?cid=1977126936674209451&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 21 | Karuhatan Public Market, MacArthur Highway, Valenzuela City | Jeepney Market Karuhatan | 14.689863 | 120.973794 | 27 m | high | `ChIJdbtP0gi0lzMRGBAwYs6rfIA` | [map](https://maps.google.com/?cid=9258463836865826840&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 22 | Macro LPG, MacArthur Highway, Valenzuela City | Macro Lpg | 14.696689 | 120.973773 | 580 m | low | `ChIJ54BYrvezlzMRVubF_O2py-M` | [map](https://maps.google.com/?cid=16414400106495075926&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 23 | MacArthur Highway / San Francisco, MacArthur Highway, Karuhatan, Valenzuela City | MacArthur Highway & San Francisco | 14.687694 | 120.975222 | 18 m | high | `ElNNYWNBcnRodXIgSGlnaHdheSAmIFNhbiBGcmFuY2lzY28sIEthcnVoYXRhbiwgVmFsZW56dWVsYSwgTWV0cm8gTWFuaWxhLCBQaGlsaXBwaW5lcyJmImQKFAoSCRVtCGkPtJczEd4ivRnbGKO8EhQKEgkVbQhpD7SXMxHeIr0Z2xijvBoUChIJfWrWd-PaljMRwOyTj1Ty0MsaFAoSCfvrdS4OtJczER-KWPyPydKhIgoNByrBCBWaWhtI` | [map](https://maps.google.com/?q=MacArthur+Highway+%26+San+Francisco,+Karuhatan,+Valenzuela,+Metro+Manila,+Philippines&ftid=0x3397b40f69086d15:0xbca318db19bd22de&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 24 | SM Center Valenzuela, MacArthur Highway, Valenzuela City | SM City Valenzuela | 14.685645 | 120.977116 | 64 m | high | `ChIJe3QNaAW0lzMRKb8qYMoI-38` | [map](https://maps.google.com/?cid=9221974327261052713&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 25 | MacArthur Highway / Cayetano Intersection, Valenzuela City | 377 Mac-Arthur Highway | 14.693092 | 120.963907 | 17 m | medium | `ChIJ0aVq-0O1lzMRj5pMNI_Bcrw` | [map](https://maps.google.com/?cid=13579128647277386383&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 26 | Novo Dep. Store, MacArthur Highway, Valenzuela City | NOVO Department Store | 14.683695 | 120.977666 | 30 m | high | `ChIJ4Z5zNQW0lzMR4-hJ43flDYY` | [map](https://maps.google.com/?cid=9659629078856722659&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 27 | Bread of Life, MacArthur Highway, Valenzuela City | Bread of Life - Valenzuela | 14.681535 | 120.978816 | 24 m | high | `ChIJk-TN_Bq0lzMR50b9rHFeO_k` | [map](https://maps.google.com/?cid=17959051781396580071&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 28 | Our Lady of Fatima University College of Medicine, MacArthur Highway, Valenzuela City | Our Lady of Fatima University OLFU - Main Building | 14.677726 | 120.980348 | 15 m | high | `ChIJ8eciXhm0lzMRPInVyG-tDWI` | [map](https://maps.google.com/?cid=7065494086036588860&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 29 | Bearsea Auto Supply, MacArthur Highway, Valenzuela City | Bearsea Auto Supply | 14.675256 | 120.981352 | 41 m | high | `ChIJDVbF0xi0lzMRVbQBJirSDpk` | [map](https://maps.google.com/?cid=11028983615945028693&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 30 | Calalang General Hospital, MacArthur Highway, Malabon City | Calalang General Hospital | 14.672606 | 120.982327 | 33 m | medium | `ChIJ6xl1Vx-0lzMRLmQka9Yo1FA` | [map](https://maps.google.com/?cid=5824325119482553390&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 31 | CDC Manufacturing, MacArthur Highway, Malabon City | Cdc Manufacturing Corporation | 14.669652 | 120.982412 | 40 m | high | `ChIJgaF49yG0lzMR64pvB9u3GWY` | [map](https://maps.google.com/?cid=7357113617636887275&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 32 | MacArthur Highway / Del Monte Intersection, Malabon City | Del monte | 14.668248 | 120.983016 | 88 m | high | `ChIJbzqRWgC1lzMRcump38yEnAQ` | [map](https://maps.google.com/?cid=332286487979223410&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 33 | Malabon City / Victoneta Avenue Intersection, Malabon City | Victoneta Avenue | 14.665571 | 120.984061 | 12 m | high | `ChIJGdNx5ia0lzMRsjIV7wuWrYs` | [map](https://maps.google.com/?cid=10064865720242877106&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 34 | Potrero Heights Elementary School, MacArthur Highway, Malabon City | Potrero Elementary School | 14.663187 | 120.983879 | 51 m | high | `ChIJl43fOCa0lzMRenpgJBL_bfY` | [map](https://maps.google.com/?cid=17757129359176530554&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 35 | MacArthur Highway / Lanzones Intersection, Malabon City | McDonald's | 14.661555 | 120.983869 | 39 m | high | `ChIJuy55DWm1lzMR2Hqt3Vu39vs` | [map](https://maps.google.com/?cid=18155900552979774168&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 36 | Floresco North Mortuary, MacArthur Highway, Caloocan City | Floresco North Mortuary Services | 14.660279 | 120.983876 | 50 m | high | `ChIJT2NT7ii0lzMRpcDhTVqxKlI` | [map](https://maps.google.com/?cid=5920739661543751845&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 37 | General Rosendo Simon / Calle Uno, Caloocan City | General Rosendo Simon & Calle Uno | 14.658749 | 120.985324 | 177 m | medium | `Em9HZW5lcmFsIFJvc2VuZG8gU2ltb24gJiBDYWxsZSBVbm8sIEJhcmFuZ2F5IDgxLCBNb3JuaW5nIEJyZWV6ZSBTdWJkaXZpc2lvbiwgQ2Fsb29jYW4sIE1ldHJvIE1hbmlsYSwgUGhpbGlwcGluZXMiZiJkChQKEgkvMrWvKbSXMxFI_Ee-NnHvtRIUChIJLzK1rym0lzMRSPxHvjZx77UaFAoSCcfv2lwotJczEeT7VI2bVqelGhQKEgk9L_sHKbSXMxHuQjeL_LG3ICIKDWe_vAgVO-UcSA` | [map](https://maps.google.com/?q=General+Rosendo+Simon+%26+Calle+Uno,+Barangay+81,+Morning+Breeze+Subdivision,+Caloocan,+Metro+Manila,+Philippines&ftid=0x3397b429afb5322f:0xb5ef7136be47fc48&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 38 | Bonifacio Market, MacArthur Highway, Caloocan City | Bonifacio Market | 14.657951 | 120.984204 | 42 m | high | `ChIJiQD5cim0lzMRrdDUd2aLFKI` | [map](https://maps.google.com/?cid=11679113005891899565&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 39 | Hypermarket Monumento | SM Hypermarket Monumento | 14.657593 | 120.983663 | 21 m | high | `ChIJi6qOaCm0lzMRBL-aKdzNqZE` | [map](https://maps.google.com/?cid=10496146752038158084&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 40 | Araneta Square | Araneta Square Mall | 14.656817 | 120.983375 | 27 m | high | `ChIJ8Uwh3iu0lzMRnUZ3eIwwAFg` | [map](https://maps.google.com/?cid=6341121655212295837&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 41 | Araneta Square Mall, Samson Road, Caloocan City | Araneta Square Mall | 14.656480 | 120.983756 | 30 m | high | `ChIJJ7bs2yu0lzMRIWfR5ynQY1k` | [map](https://maps.google.com/?cid=6441220770471438113&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 42 | Ever Gotesco Grand Central, Rizal Avenue, Caloocan City | Gotesco Grand Central Merchants Assoc. | 14.658064 | 120.983991 | 38 m | high | `ChIJ739EbSm0lzMRny-N057OG4Q` | [map](https://maps.google.com/?cid=9519429418927075231&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 43 | MacDonalds, Rizal Avenue, Caloocan City | McDonald's Rizal Ave Grace Park East | 14.647232 | 120.983814 | 26 m | medium | `ChIJl1spcQC1lzMR0SQm51gIux0` | [map](https://maps.google.com/?cid=2142315225672983761&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 44 | Rizal Avenue / Asistio Intersection, Caloocan City | McDonald's Rizal Ave Grace Park East | 14.647232 | 120.983814 | 26 m | high | `ChIJl1spcQC1lzMR0SQm51gIux0` | [map](https://maps.google.com/?cid=2142315225672983761&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 45 | Rizal Ave. / 8th Ave. West, Caloocan City | 8th Avenue & Rizal Avenue Extension | 14.648781 | 120.983781 | 39 m | high | `El44dGggQXZlICYgUml6YWwgQXZlbnVlIEV4dCwgQmFyYW5nYXkgMTA2LCBHcmFjZSBQYXJrIEVhc3QsIENhbG9vY2FuLCBNZXRybyBNYW5pbGEsIFBoaWxpcHBpbmVzImYiZAoUChIJw0TgW9S1lzMR9MBtpn5p-3kSFAoSCcNE4FvUtZczEfTAbaZ-aft5GhQKEgkznyl_f7aXMxEdjcT0Hx_qIRoUChIJrYkk1Na1lzMR1hDxGkmUbXIiCg0AOrsIFe6oHEg` | [map](https://maps.google.com/?q=8th+Ave+%26+Rizal+Avenue+Ext,+Barangay+106,+Grace+Park+East,+Caloocan,+Metro+Manila,+Philippines&ftid=0x3397b5d45be044c3:0x79fb697ea66dc0f4&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 46 | Rizal Ave. / 7th Ave. West, Caloocan City | Chinabank | 14.648623 | 120.983564 | 15 m | high | `ChIJ4SX3XNS1lzMR5ozFMkcfms8` | [map](https://maps.google.com/?cid=14959303502919470310&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 47 | Asia Trust Bank, Rizal Avenue, Caloocan City | Western Union - Asiatrust Bank-Howard Towers | 14.645866 | 120.983921 | 34 m | high | `ChIJLxubmta1lzMR2M_tZxiB5CM` | [map](https://maps.google.com/?cid=2586334027840344024&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 48 | JCSGO Caloocan, Rizal Ave. / 6th Ave. West, Caloocan City | Jcsg Jesus Christ Saves Global Outreach | 14.648894 | 120.986112 | 267 m | medium | `ChIJ3wjeCtW1lzMRB84lqCyrFjc` | [map](https://maps.google.com/?cid=3969548329861631495&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 49 | J. Teodoro / 5th Ave. West, Caloocan City | J.Teodoro & 5th Avenue | 14.644563 | 120.982818 | 83 m | high | `EllKLlRlb2Rvcm8gJiA1dGggQXZlbnVlLCBCYXJhbmdheSA1NSwgR3JhY2UgUGFyayBXZXN0LCBDYWxvb2NhbiwgTWV0cm8gTWFuaWxhLCBQaGlsaXBwaW5lcyJmImQKFAoSCbHhK9rWtZczEQ8xBpGsvdSVEhQKEgmx4Sva1rWXMxEPMQaRrL3UlRoUChIJ4yH7Y9S1lzMR4aUYu9wmRa4aFAoSCXHlrJZ4tpczEQe9incn3AiOIgoNOpW6CBVSgxxI` | [map](https://maps.google.com/?q=J.Teodoro+%26+5th+Avenue,+Barangay+55,+Grace+Park+West,+Caloocan,+Metro+Manila,+Philippines&ftid=0x3397b5d6da2be1b1:0x95d4bdac9106310f&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 50 | Circumferential Road 3 / M.H. Del Pilar St, Caloocan City | C-3 & MH del Pilar Street | 14.644318 | 120.984219 | 73 m | high | `EllDLTMgJiBNSCBkZWwgUGlsYXIgU3QsIEJhcmFuZ2F5IDExNywgR3JhY2UgUGFyayBFYXN0LCBDYWxvb2NhbiwgTWV0cm8gTWFuaWxhLCBQaGlsaXBwaW5lcyJmImQKFAoSCdt3wPvWtZczEV4nBV3C184sEhQKEgnbd8D71rWXMxFeJwVdwtfOLBoUChIJPYnguce1lzMRIYgWYuOdQFoaFAoSCStzuXPXtZczEet5feuITo1RIgoNqIu6CBUNuhxI` | [map](https://maps.google.com/?q=C-3+%26+MH+del+Pilar+St,+Barangay+117,+Grace+Park+East,+Caloocan,+Metro+Manila,+Philippines&ftid=0x3397b5d6fbc077db:0x2cced7c25d05275e&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 51 | 3th Avenue West, Caloocan City | 3rd Avenue | 14.641835 | 120.981969 | 153 m | medium | `ChIJPSNTCdq1lzMR6nryhP_BrpE` | [map](https://maps.google.com/?cid=10497541084638509802&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 52 | Banco De Oro, Rizal Avenue, Caloocan City | Banco De Oro Universal Bank - Grace Park Branch | 14.658064 | 120.983991 | 38 m | high | `ChIJ739EbSm0lzMRhLRexStLOqs` | [map](https://maps.google.com/?cid=12338256780501890180&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 53 | Baliwag Transit Bus Station, Rizal Avenue, Caloocan City | Baliwag Transit, Inc. | 14.639992 | 120.983211 | 50 m | high | `ChIJEe6PlNm1lzMRniOFkwrd-uY` | [map](https://maps.google.com/?cid=16643858410395476894&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 54 | Rizal Avenue / Road 1 Intersection, Caloocan City | North Mall | 14.654441 | 120.984440 | 56 m | high | `ChIJw6QbqSu0lzMRXf6aafODl9E` | [map](https://maps.google.com/?cid=15102684956882304605&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 55 | LRT Papa Station, Rizal Avenue, Caloocan City | LRT Caloocan Mall | 14.654438 | 120.983993 | 10 m | medium | `ChIJRQQnqiu0lzMR-7ySSyiCOuo` | [map](https://maps.google.com/?cid=16877945663102565627&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 56 | P. Sevilla Street / 2th Avenue West Intersection, Caloocan City | Second Avenue | 14.640826 | 120.981183 | 239 m | medium | `ChIJZyKF-PS1lzMRZ74Cp_rBj9Y` | [map](https://maps.google.com/?cid=15460789328074161767&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 57 | Rizal Avenue / Jose Abad Santos Avenue Interchange, Caloocan City | 353 Rizal Avenue Extension | 14.650575 | 120.983639 | 15 m | high | `ChIJ3V0tCuK1lzMRsmZRVG8Qduw` | [map](https://maps.google.com/?cid=17038824310544885426&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 58 | Jose Abad Santos Avenue / Morong Intersection, Quezon City | 5th Avenue | 14.644226 | 120.983335 | 24 m | medium | `ChIJKRmg4Na1lzMR8jV2eeCWqg4` | [map](https://maps.google.com/?cid=1056822953426433522&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 59 | Jose Abad Santos Avenue / Corregidor Intersection, Quezon City | Generika Abad Santos Tondo | 14.630834 | 120.981063 | 26 m | medium | `ChIJ80YL_ArJlzMRA0gAL5Iaye4` | [map](https://maps.google.com/?cid=17206313066501785603&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 60 | Jose Abad Santos Avenue, Quezon City | Abad Santos Avenue | 14.619629 | 120.977763 | 442 m | low | `ChIJcyOxw_q1lzMR4z3L0g80TR0` | [map](https://maps.google.com/?cid=2111401042872319459&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 61 | Jose Abad Santos Avenue / T Bugallon Street, Quezon City | McDonald's Abad Santos Hermosa | 14.631369 | 120.980475 | 44 m | medium | `ChIJV62UX-e1lzMRNxPb_o9a4rE` | [map](https://maps.google.com/?cid=12817907063952446263&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 62 | T Bugallon Street, Quezon City | Bugallon Street | 14.624794 | 120.980618 | 31 m | medium | `ChIJSaOwR-S1lzMRfQytH4KAqmU` | [map](https://maps.google.com/?cid=7325809040237071485&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 63 | T Bugallon Street / Cavite Intersection, Quezon City | - | - | - | - | **unresolved** | - | - |
| 64 | T. Mapua / Laguna Intersection, Quezon City | Mapúa University | 14.590488 | 120.977948 | 1547 m | low | `ChIJWRyxdxjKlzMR-sHK8KAllwI` | [map](https://maps.google.com/?cid=186659282723979770&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 65 | Tomas Mapua / Batangas Intersection, City of Manila | Tomas mapua sta.Cruz manila | 14.605215 | 120.980733 | 210 m | medium | `ChIJs-m7ZADLlzMRnoEzv4JOvWI` | [map](https://maps.google.com/?cid=7114929309775790494&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 66 | Tomas Mapua / Camarines Intersection, City of Manila | Tomas mapua sta.Cruz manila | 14.605215 | 120.980733 | 210 m | medium | `ChIJs-m7ZADLlzMRnoEzv4JOvWI` | [map](https://maps.google.com/?cid=7114929309775790494&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 67 | Camarines, City of Manila | Herrera Street | 14.618147 | 120.981841 | 138 m | low | `ChIJN9hMh_u1lzMRtAZLy79Z0Ok` | [map](https://maps.google.com/?cid=16848064886277342900&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 68 | Felix Huertas, City of Manila | Felix Huertas Road | 14.618073 | 120.984775 | 105 m | medium | `ChIJczhOif61lzMRvb23I4WWx0c` | [map](https://maps.google.com/?cid=5172268195632364989&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 69 | San Lazaro / Oroquieta Intersection, City of Manila | RedDoorz near SM San Lazaro Manila | 14.615969 | 120.983836 | 46 m | medium | `ChIJvxAoJfy1lzMROhBlmyJqMPY` | [map](https://maps.google.com/?cid=17739795629080907834&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 70 | Quiricada / Felix Huertas Intersection, City of Manila | Barangay Hall 339 Zone 34 | 14.613876 | 120.984428 | 40 m | medium | `ChIJN5Jy9P61lzMRvFWCZtIXTSY` | [map](https://maps.google.com/?cid=2759888339078370748&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 71 | Oroquieta / Alvarez Intersection, City of Manila | Barangay 378 Barangay Hall | 14.615830 | 120.983551 | 30 m | medium | `ChIJU-LJI_y1lzMRk6t1a-adUss` | [map](https://maps.google.com/?cid=14650946150760557459&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 72 | Oroquieta / Bambang Intersection, City of Manila | Bambang LRT Station | 14.611099 | 120.982494 | 88 m | medium | `ChIJLUy9T_-1lzMRm6qCUQPcBp8` | [map](https://maps.google.com/?cid=11459088208701336219&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 73 | Oroquieta / Mayhaligue Intersection, City of Manila | Barangay 378 Barangay Hall | 14.615830 | 120.983551 | 30 m | medium | `ChIJU-LJI_y1lzMRk6t1a-adUss` | [map](https://maps.google.com/?cid=14650946150760557459&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 74 | Sulu, City of Manila | Sulu Street | 14.617103 | 120.985152 | 44 m | medium | `ChIJ388XKOK1lzMRHeUof9HK3-k` | [map](https://maps.google.com/?cid=16852411331774047517&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 75 | Quezon Blvd. / P. Paredes Intersection, City of Manila | - | - | - | - | **unresolved** | - | - |
| 76 | Isetann | Isetann Cinerama Complex | 14.603123 | 120.984661 | 32 m | high | `ChIJm_qxrgPKlzMR8jLZ3Ie6jqM` | [map](https://maps.google.com/?cid=11785562367563739890&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 77 | Recto LRT | LRT 2 - Recto Station | 14.603515 | 120.983074 | 19 m | high | `ChIJSccuNJTLlzMRfU2UfQjpNyo` | [map](https://maps.google.com/?cid=3042156295987940733&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 78 | Oroquieta, City of Manila | Oroquieta Road | 14.615580 | 120.983670 | 1 m | medium | `ChIJ4zq93_61lzMRpJaHMQRaULY` | [map](https://maps.google.com/?cid=13137099087097075364&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 79 | Lope De Vega / Oroquieta Intersection, City of Manila | Lope de Vega Tower | 14.606504 | 120.983910 | 103 m | medium | `ChIJvbT8EwHKlzMR7J7-YW1W5nw` | [map](https://maps.google.com/?cid=8999975933142015724&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 80 | Oroquieta / Batangas Intersection, City of Manila | 2618 Oroquieta St Sta Cruz Manila | 14.625930 | 120.984128 | 115 m | medium | `ChIJJ1Hk1xO1lzMR9Fd8ut_a_JI` | [map](https://maps.google.com/?cid=10591581078109837300&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 81 | Cavite, Quezon City | - | - | - | - | **unresolved** | - | - |
| 82 | Light Rail Transit Line / Bulacan Intersection, Quezon City | Blumentritt | 14.622588 | 120.983500 | 11 m | low | `ChIJ4ahIAuO1lzMRRQO5OKd8nHs` | [map](https://maps.google.com/?cid=8907131220685030213&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 83 | Rizal Avenue near Aurora Blvd Intersection, Quezon City | - | - | - | - | **unresolved** | - | - |
| 84 | Rizal Avenue, Quezon City | Rizal Avenue | 14.614388 | 120.982606 | 107 m | medium | `ChIJmfIjzgbKlzMRnYMeFqsLztw` | [map](https://maps.google.com/?cid=15910667362984952733&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 85 | Rizal Avenue / Mt. Samat Intersection, Quezon City | Rizal avenue | 14.631145 | 120.980845 | 35 m | medium | `ChIJc4rqBgC1lzMRo5Mq4cVQmDk` | [map](https://maps.google.com/?cid=4150155867438355363&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 86 | 4th Ave. East / M.H. Del Pilar St, Caloocan City | Alpha Digital Printing | 14.645539 | 120.984285 | 77 m | high | `ChIJCUJDMs-1lzMROHjlX1yZiJM` | [map](https://maps.google.com/?cid=10630915542432970808&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 87 | 5th Ave. West / Maria Clara St, Caloocan City | R.B.M.T. Building Lessor | 14.644199 | 120.982986 | 61 m | high | `ChIJ739EbSm0lzMRrKlpK5fYiHY` | [map](https://maps.google.com/?cid=8541314837088151980&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 88 | Monumento, Rizal Avenue, Caloocan City | NOVO - Rizal Ave Monumento | 14.656106 | 120.983760 | 20 m | high | `ChIJccyTxCu0lzMRMznn4ObvaJc` | [map](https://maps.google.com/?cid=10910233872199792947&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 89 | South Supermarket (near City Hall), MacArthur Highway, Valenzuela City | South Supermarket | 14.692861 | 120.971207 | 87 m | high | `ChIJQQ4Mmwm0lzMRisrrRQTcvTk` | [map](https://maps.google.com/?cid=4160723541671266954&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |
| 90 | Flying V Gas (near City Hall), MacArthur Highway, Valenzuela City | Flying V | 14.693010 | 120.968380 | 29 m | high | `ChIJybfqTQq0lzMR0CWb0iZXb90` | [map](https://maps.google.com/?cid=15956067829050713552&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA) |

### Confidence summary

| Confidence | Distinct places |
|---|---|
| high | 52 |
| medium | 29 |
| low | 5 |
| unresolved | 4 |
| **needs manual review** | **38** |

Expanded back over the 150 raw rows: **146 resolved, 4 unresolved**.

## 13. Unresolved and manual-review list

### Unresolved - no credible candidate on the corridor

| Field entry | Why |
|---|---|
| Cavite, Quezon City | No Google candidate inside the corridor envelope |
| T Bugallon Street / Cavite Intersection, Quezon City | No Google candidate inside the corridor envelope |
| Quezon Blvd. / P. Paredes Intersection, City of Manila | No Google candidate inside the corridor envelope |
| Rizal Avenue near Aurora Blvd Intersection, Quezon City | No Google candidate inside the corridor envelope |

All four are bare street names or intersections without a landmark, which Text
Search cannot disambiguate inside a dense grid. These need a manual pin, not a
better query.

### Low confidence - reject or re-pin manually

| Field entry | Resolved to | Off-corridor | Reason |
|---|---|---|---|
| Light Rail Transit Line / Bulacan Intersection, Quezon City | Blumentritt | 11 m | Near corridor (11 m) but name and city disagree |
| Camarines, City of Manila | Herrera Street | 138 m | Near corridor (138 m) but name and city disagree |
| Jose Abad Santos Avenue, Quezon City | Abad Santos Avenue | 442 m | 442 m from the corridor |
| T. Mapua / Laguna Intersection, Quezon City | Mapúa University | 1547 m | 1547 m from the corridor |
| Macro LPG, MacArthur Highway, Valenzuela City | Macro Lpg | 580 m | 580 m from the corridor |

### Medium confidence

29 places matched the corridor and city but the name agreement was weak, or they
sat 150-400 m off the traced line with only partial agreement. They are plausible
but unconfirmed. Full list in `out/review_table.csv`, filter
`confidence == medium`.

## 14. Route-order validation

Each resolved stop was projected to its nearest corridor vertex, then the vertex
indices were compared against the reported field sequence. A monotonic sequence
means the pins advance along the route the way the field notes describe.

| Direction | Resolved | Corridor-index inversions | Steps |
|---|---|---|---|
| MALANDAY-RECTO | 77 | 19 | 76 |
| RECTO-MALANDAY | 69 | 18 | 68 |

Roughly a quarter of consecutive steps go backwards along the corridor. Most are
small and expected: adjacent pins within a block, plus the fact that a Google
landmark pin sits at a building centroid rather than on the kerb.

### Stops whose position disagrees with their sequence

This is the check that confidence scoring misses. Comparing each stop's actual
corridor index against the index its sequence implies (flagging deviation above
18% of route length) surfaces **wrong-place matches that still scored `high`**:

| Stop | Seq | Expected vertex | Actual vertex | Field entry |
|---|---|---|---|---|
| `MR-FS-001` | 1 | 0 | 23 | C.P. Enerton Fuel Station, MacArthur Highway, Valenzuela City, Philippines |
| `MR-FS-012` | 12 | 16 | 38 | Iglesia Ni Cristo, MacArthur Highway, Dalandanan, Valenzuela City |
| `RM-FS-021` | 21 | 46 | 75 | Banco De Oro, Rizal Avenue, Caloocan City |
| `RM-FS-047` | 47 | 105 | 133 | MacArthur Highway / Cayetano Intersection, Valenzuela City |

**4 of 146 resolved rows flagged.** The first one is the clearest failure:

`MR-FS-001` C.P. Enerton Fuel Station is reported as the **first** stop at the
Malanday end, which sits near latitude 14.719. Google returned a pin at
**14.694540, 120.964329** - roughly 2.7 km south, mid-corridor near Malinta - and it scored
`high` because it is on the corridor and the name matched. **Name plus corridor
proximity is not sufficient evidence.** Route-order consistency has to be part of
acceptance, and it is the reason this report does not recommend auto-accepting the
52 `high` rows.

## 15. Comparison with Transitland

**Not available.** `https://transit.land/api/v2/rest/stops` returned **HTTP 401**
(Unauthorized). The v2 REST API requires an `apikey` parameter, and no Transitland
key is configured in this environment.

No Transitland comparison data is presented, and none was invented. To complete
this item, a Transitland API key would need to be provisioned; the alternative is
to compare against OpenStreetMap `highway=bus_stop` / `public_transport=platform`
nodes, which needs no key. Say which you prefer and it can be added.

## 16. Comparison with existing RutaSmart coordinates

### Against the 70 manuscript ground-truth stops

Distance from each researched stop to its nearest ground-truth stop:

| Statistic | Value |
|---|---|
| median | 85 m |
| mean | 132 m |
| p90 | 273 m |
| max | 1566 m |
| within 50 m | 25 of 86 |
| within 100 m | 51 of 86 |
| within 200 m | 70 of 86 |

Every researched stop has a ground-truth stop within 200 m, which is consistent
with both datasets describing the same corridor. The median offset of 85 m is
larger than GPS error and is explained mostly by the ground truth's 3 dp rounding
(about 110 m) rather than by disagreement about where stops are.

### Against the 38 published passenger zones

| Direction | Median distance | Within 50 m |
|---|---|---|
| MALANDAY-RECTO | 82 m | 4 |
| RECTO-MALANDAY | 78 m | 4 |

The same pattern: broadly the same corridor, but only a handful of near-exact
coincidences. The published zones were derived from detected clusters, not from
field notes, so this is expected.

### Distance from the traced corridor polyline

| Band | Places |
|---|---|
| <=50 m | 55 |
| <=150 m | 21 |
| <=400 m | 7 |
| >400 m | 3 |
| unresolved | 4 |

Beyond 400 m - reject these:

| Distance | Field entry | Resolved to |
|---|---|---|
| 1547 m | T. Mapua / Laguna Intersection, Quezon City | Mapúa University |
| 580 m | Macro LPG, MacArthur Highway, Valenzuela City | Macro Lpg |
| 442 m | Jose Abad Santos Avenue, Quezon City | Abad Santos Avenue |

The Mapua University hit is a textbook Text Search failure: the field note reads
`T. Mapua / Laguna Intersection`, and Google matched the **university** of that
name over a kilometre away instead of the street junction.

## 17. Reconciliation of the 70-stop issue

The numbers do not line up, and they should not be forced to:

| Source | Count |
|---|---|
| `GROUND_TRUTH_STOPS` (manuscript evaluation) | 70 |
| `geocode_stops.py` `FORWARD_STOPS` (defunct) | 76 |
| `geocode_stops.py` `RETURN_STOPS` (defunct) | 70 |
| Field findings, raw | 150 |
| Field findings, distinct places | 90 |
| Published passenger zones | 38 |

Reading of the discrepancy:

1. The 70 ground-truth entries are a **per-direction union with duplicates removed**,
   not a count of physical shelters. The 90 distinct field places is a different
   quantity measured a different way, so 90 vs 70 is not an error in either.
2. The coarse rounding (section 1) means several ground-truth entries are probably
   the same physical stop recorded twice at different precisions. Only 26 distinct
   longitudes across 70 entries points the same way.
3. `geocode_stops.py` is dead code whose outputs are absent. Its 76/70 figures
   should not be cited as evidence of anything.

**Recommendation: do not relabel anything as '70 verified stops'.** Keep the
manuscript's 70 as the evaluation ground truth, untouched, and carry the field
findings as a separate `field_reported` dataset whose rows are promoted only by
manual review. Do not reconcile the counts by editing either dataset.

## 18. Recommended matching threshold

Measured against the 11 clusters in the captured snapshot run, the distance from
each cluster centroid to its nearest researched field stop is:

| Statistic | Value |
|---|---|
| min | 17 m |
| median | 182 m |
| max | 631 m |

| Threshold | Clusters that would match |
|---|---|
| 30 m | 1 of 11 |
| 50 m | 2 of 11 |
| 75 m | 3 of 11 |
| 100 m | 4 of 11 |
| 150 m | 5 of 11 |
| 200 m | 6 of 11 |

### Recommendation

**Primary band 75 m, review band 75-150 m, unmatched above 150 m.**

| Band | Status | Label shown |
|---|---|---|
| <= 75 m | `matched` | `near <stop name>` |
| 75-150 m | `needs_review` | `near <stop name> (approx.)` |
| > 150 m | `unmatched` | no name, hotspot shown as today |

Reasoning:

- 50 m matches the existing `_NEAR_M` band and the DBSCAN `eps_m = 50`, so it is
  the consistent choice, but on this data it labels only 2 of 11 clusters. Most
  hotspots would stay nameless, which is the status quo.
- 75 m labels 3 and keeps the error bounded to roughly one block.
- 200 m would label 6, but at that range a label is a guess: section 7 lists
  **31 same-direction stop pairs closer than 40 m to each other**, several at 0.0 m.
  A 200 m radius routinely contains several candidate stops, so the nearest one
  carries little meaning.

### Three caveats that limit this recommendation

1. **n = 11.** Eleven clusters is a thin basis for a threshold. The band should be
   configurable, not hard-coded, and revisited once more trips are collected.
2. **Direction filtering was not applied in this measurement.** Each cluster was
   matched against all resolved stops in both directions. Filtering by direction
   will push distances up, not down, so the real match rate at 75 m is a ceiling.
3. **The field-stop coordinates themselves are unreviewed.** Section 14 shows at
   least one `high`-confidence pin is about 2.7 km out of place. Matching against
   unreviewed pins would propagate that error into the UI as a confident label.

**Therefore: the threshold should not be deployed until the 38 manual-review rows
in section 13, and the 4 route-order outliers in section 14, have been settled.**

## 19. Proposed JSON data file

`research/field_stops/out/field_stops.proposed.json` - built, not wired into
anything. 150 records (one per raw field row, so both directions are preserved).

| Key | Value |
|---|---|
| `dataset` | `field_reported_stops` |
| `counts.records` | 150 |
| `counts.resolved` | 146 |
| `counts.unresolved` | 4 |
| `counts.distinct_places` | 90 |

Every record carries `status: "field_reported"`. Nothing is marked verified.

Record shape, using a real row:

```json
{
  "stop_id": "MR-FS-017",
  "status": "field_reported",
  "source_name": "Malinta Elementary School, MacArthur Highway, Malinta, Valenzuela City",
  "normalized_name": "Malinta Elementary School",
  "direction": "MALANDAY-RECTO",
  "route_sequence": 17,
  "city": "Valenzuela City",
  "barangay": "Malinta",
  "latitude": 14.691904,
  "longitude": 120.965862,
  "google_place_id": "ChIJn0kgQgu0lzMRweSrxpmTz7Q",
  "google_display_name": "Malinta Elementary School - Valenzuela City",
  "google_formatted_address": "1400 A. Pablo St, Valenzuela, 1400 Metro Manila",
  "google_maps_uri": "https://maps.google.com/?cid=13028794535678567617&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA",
  "dist_to_corridor_m": 85.6,
  "confidence": "high",
  "needs_manual_review": false,
  "match_reason": "On corridor (86 m), name and city agree",
  "dedupe_key": "malinta elementary school"
}
```

`source_name` is the verbatim field entry and is never edited; `normalized_name`
and `dedupe_key` are derived. Keeping both means any later correction is auditable
back to what the passenger or conductor actually reported.

## 20. Files that would change on implementation

Nothing in this list has been touched.

### New files

| File | Purpose |
|---|---|
| `rutasmart-backend/app/data/field_stops.json` | the reviewed dataset, moved out of `research/` |
| `rutasmart-backend/app/analytics/field_stop_match.py` | `match_nearest_field_stop()`; Haversine, direction filter, configurable radius, near-tie detection |
| `rutasmart-backend/tests/test_field_stop_match.py` | deterministic tests, section 21 |

### Modified files

| File | Change | Risk |
|---|---|---|
| `app/analytics/algorithms.py` | add 4 optional fields to `StopCluster`, defaulted | low - additive only |
| `app/routes/analytics_routes.py` | call the matcher after clustering | low - no query change |
| `rutas-frontend/src/pages/admin/AdminMap.jsx` | show the label in the existing `Popup` and list rows | low - no new layer |
| `rutas-frontend/src/pages/AnalyticsEngine.jsx` | show the label in cluster tables | low |

### Explicitly NOT changed

- `app/analytics/cluster_evaluation.py` - `GROUND_TRUTH_STOPS` stays as it is, so
  recall, precision, F1 and every Evaluation figure are unaffected.
- `app/routes/stop_zone_routes.py` - `_nearest_gt_banded()` and its 50/120 m bands
  keep working against the ground truth. The new matcher is a **second, separate**
  labelling path against field stops; the two are not merged.
- The `stop_zones` table, every model, every migration. **No schema change, no
  migration, no seed, no write.** The dataset is a JSON file read at import.
- `requirements.txt` - Haversine is already implemented in the codebase.

### Proposed additive fields on `StopCluster`

```python
nearest_field_stop: str | None = None        # display name, or None
nearest_field_stop_m: float | None = None    # metres
field_stop_match: str = "unmatched"          # matched | needs_review | unmatched
field_stop_ambiguous: bool = False           # a second stop within 1.25x the first
```

All four default, so any existing consumer that ignores them keeps working.

## 21. Test plan

All deterministic, no network, no database, no API key.

### Matching arithmetic

| # | Test | Expectation |
|---|---|---|
| 1 | Haversine against three hand-computed pairs along the corridor | within 0.5 m of the expected value |
| 2 | a cluster placed exactly on a field stop | distance 0.0, status `matched` |
| 3 | a cluster 74 m from the nearest stop | `matched` |
| 4 | a cluster 76 m away | `needs_review` |
| 5 | a cluster 151 m away | `unmatched`, `nearest_field_stop is None` |
| 6 | exact band boundaries 75.0 and 150.0 | documented inclusive side, asserted both ways |

### Direction and ambiguity

| # | Test | Expectation |
|---|---|---|
| 7 | a MALANDAY-RECTO cluster next to a return-only stop | that stop is not considered |
| 8 | direction `ALL` | both directions considered, documented behaviour |
| 9 | two stops within 1.25x of each other (a real 0.0 m pair from section 7) | `field_stop_ambiguous = True` |
| 10 | a cluster whose two nearest stops differ clearly | `field_stop_ambiguous = False` |

### Data integrity

| # | Test | Expectation |
|---|---|---|
| 11 | `field_stops.json` loads and every resolved row has a finite lat/lon in the corridor envelope | passes |
| 12 | no record has `status` other than `field_reported` unless manually promoted | passes |
| 13 | `GROUND_TRUTH_STOPS` still has exactly 70 entries | guards against accidental edits |
| 14 | unresolved rows (lat is None) are skipped, never matched at distance 0 | passes |
| 15 | the matcher is a pure function - same input, same output, no DB session | passes |

### Regression

| # | Test | Expectation |
|---|---|---|
| 16 | run the existing evaluation and compare recall / precision / F1 before and after | **byte-identical** |
| 17 | `/analytics/merged/run-all` response with the matcher disabled | identical to the current response, hashed |
| 18 | the 16 query-batching tests in `test_query_batching.py` | still pass |
| 19 | SQL statement count for the merged endpoint | unchanged at 2 |

Test 16 is the one that matters most: it proves the manuscript's Evaluation
figures are untouched by this feature.

---

## Summary and what blocks implementation

| Item | State |
|---|---|
| Field entries resolved to coordinates | 146 of 150 raw rows (86 of 90 distinct places) |
| High confidence | 52 distinct places |
| Need manual review | 38 distinct places |
| Route-order outliers, including `high` rows | 4 |
| Pins beyond 400 m from the corridor | 3 |
| Duplicate pins serving two stops | 3 pairs |
| Transitland comparison | **unavailable, HTTP 401, no key** |
| Recommended threshold | **75 m matched / 75-150 m needs review / >150 m unmatched** |

**Three things should be settled before any code is written:**

1. The 38 manual-review rows and the 4 route-order outliers - especially
   `MR-FS-001`, where a `high` score hides a multi-kilometre error.
2. Whether to provision a Transitland key or compare against OpenStreetMap instead.
3. Confirmation that the threshold band is acceptable given n = 11 clusters.

No application code has been modified. Nothing is staged or committed.
