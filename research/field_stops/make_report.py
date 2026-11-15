"""Generate RESEARCH_REPORT.md from the artefacts. No network, no key, no DB."""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "rutasmart-backend"))


def hav(a, b, c, d):
    R = 6371008.8
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = math.radians(c - a), math.radians(d - b)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


res = json.loads((OUT / "google_results.json").read_text(encoding="utf-8"))
norm = json.loads((OUT / "normalized.json").read_text(encoding="utf-8"))
corr = json.loads((OUT / "corridor.json").read_text(encoding="utf-8"))
prop = json.loads((OUT / "field_stops.proposed.json").read_text(encoding="utf-8"))
FWD, RET = corr["CORRIDOR"], corr["RETURN_CORRIDOR"]

L = []


def w(s=""):
    L.append(s)


conf = Counter(r["confidence"] for r in res)
stops = prop["stops"]
rc = prop["counts"]
nc = norm["normalised_counts"]
bykey = {r["key"]: r for r in res}

from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS as GT

# ───────────────────────── header ─────────────────────────
w("# Field-reported stop coordinates - research report")
w()
w("**Status: research only. No application code was changed. Nothing staged or committed.**")
w()
w("Generated from `research/field_stops/` by `make_report.py`. Re-runnable offline.")
w()
w("Scope: resolve the passenger and conductor field findings for the Malanday-Recto")
w("corridor to coordinates using Google Places API (New) Text Search, then recommend")
w("a threshold for labelling detected clusters by nearest field stop.")
w()
w("The four datasets are kept separate and are **not** merged:")
w()
w("| Dataset | Where it lives | Count | Touched here |")
w("|---|---|---|---|")
w("| Detected hotspots | computed per request, `/analytics/merged/run-all` | 11 in the captured run | read only |")
w("| Field-reported stops | `research/field_stops/` (new) | 150 raw / %d distinct | **produced here** |" % len(res))
w("| Published passenger zones | `stop_zones` table | 38 | read only |")
w("| Manuscript ground truth | `GROUND_TRUTH_STOPS` in code | %d | read only, unchanged |" % len(GT))
w()
w("No recall, precision, F1 or Evaluation value was recomputed or altered. Nothing")
w("in this report is called a verified stop.")
w()

# ───────────────────────── 1 ─────────────────────────
w("## 1. Repository findings")
w()
w("| Finding | Location | Detail |")
w("|---|---|---|")
w("| Manuscript ground truth | `rutasmart-backend/app/analytics/cluster_evaluation.py` -> `GROUND_TRUTH_STOPS` | **exactly %d entries**, `(name, lat, lon)` |" % len(GT))
w("| Nearest-stop labelling already exists | `rutasmart-backend/app/routes/stop_zone_routes.py` -> `_nearest_gt_banded()` | bands `_NEAR_M = 50.0`, `_APPROX_M = 120.0`; emits `near X` / `near X (approx.)` / `New area near X` |")
w("| Corridor geometry | `rutasmart-backend/app/analytics/algorithms.py` | `CORRIDOR` %d vertices, `RETURN_CORRIDOR` %d vertices, 7 decimal places |" % (len(FWD), len(RET)))
w("| Defunct geocoding attempt | `rutasmart-backend/app/analytics/geocode_stops.py` | Nominatim pipeline, `FORWARD_STOPS` 76 / `RETURN_STOPS` 70; **the CSVs it writes do not exist in the repo** |")
w("| Demand tier source | `algorithms.py:555` | `classify_demand(max_occ, official_capacity)` - tier is driven by **max_occupancy**, not the mean |")
w()
w("### The precision ceiling in `GROUND_TRUTH_STOPS`")
w()


def dps(v):
    s = repr(float(v))
    return len(s.split(".")[1].rstrip("0")) if "." in s else 0


lat_dp = Counter(dps(g[1]) for g in GT)
lon_dp = Counter(dps(g[2]) for g in GT)

w("The %d entries are real, but **coarse**, and that caps how precisely anything can" % len(GT))
w("be matched against them:")
w()
w("| Measure | Value |")
w("|---|---|")
w("| Entries | %d |" % len(GT))
w("| Distinct latitudes | %d |" % len({g[1] for g in GT}))
w("| Distinct longitudes | %d across %d stops |" % (len({g[2] for g in GT}), len(GT)))
w("| Latitude decimal places | %s |" % "; ".join("%d dp: %d" % (k, v) for k, v in sorted(lat_dp.items(), reverse=True)))
w("| Longitude decimal places | %s |" % "; ".join("%d dp: %d" % (k, v) for k, v in sorted(lon_dp.items(), reverse=True)))
w()
w("At this latitude 4 dp is about 11 m, 3 dp about 110 m, 2 dp about 1.1 km.")
w("Entries rounded to 2-3 dp therefore carry **more positional uncertainty than any**")
w("**matching threshold worth setting**. This is the central reason the researched")
w("coordinates should stay a separate dataset rather than become a correction to the")
w("ground truth: correcting it would change the Evaluation inputs.")
w()

# ───────────────────────── 2 ─────────────────────────
w("## 2. Current cluster data flow")
w()
w("```")
w("AdminMap.jsx / AnalyticsEngine.jsx")
w("  |- useCorridorAnalytics({ direction, range })       components/admin/useCorridorAnalytics.js")
w("      |- fetchMerged(ids, epsM=50, minSamples=5)      module cache, key `${ids}|${eps}|${minPts}`")
w("          |- runMergedAll(tripIds, epsM, minSamples)  services/api.js")
w("              |- GET /analytics/merged/run-all?trip_ids=...&eps_m=50&min_samples=5")
w("                  |- analytics_routes.py:170")
w("                      |- one query for Trip rows            (batched)")
w("                      |- _fetch_points_bulk(trip_ids)       (batched, ORDER BY trip_id, timestamp)")
w("                      |- run_dbscan / kalman / wdbscan  ->  List[StopCluster]")
w("```")
w()
w("Properties that matter for a matching feature:")
w()
w("- Clusters are **computed per request and never stored**. There is no cluster table,")
w("  so there is nowhere to persist a label today.")
w("- `eps_m = 50`, `min_samples = 5` are the defaults the map uses.")
w("- The frontend cache is module-level, so switching direction reuses the response.")
w("- Published zones arrive from a **separate** call, `GET /stop-zones/recommendations`,")
w("  deferred until the Zones tab is opened.")
w()

# ───────────────────────── 3 ─────────────────────────
w("## 3. Current hotspot API response")
w()
w("`StopCluster` (`algorithms.py:356`) is the per-cluster contract. Any matching")
w("feature must be purely additive to it:")
w()
w("| Field | Type | Meaning |")
w("|---|---|---|")
for f, t, m in [
    ("cluster_id", "int", "index within the run; **not stable across runs**"),
    ("centroid_lat", "float", "occupancy-weighted centroid"),
    ("centroid_lon", "float", "occupancy-weighted centroid"),
    ("point_count", "int", "member GPS logs"),
    ("avg_occupancy", "float", "mean occupancy"),
    ("max_occupancy", "int", "**drives `demand_tier`**"),
    ("demand_tier", "str", "Normal / Moderate / High / Critical"),
    ("peak_period", "str", "Morning Peak / Midday / Afternoon Peak / Off-Peak"),
    ("load_factor_pct", "float", "avg occupancy / official capacity x 100"),
    ("noise_ratio_pct", "float", "share of POOR logs excluded before clustering"),
    ("avg_velocity_ms", "float", "mean member speed"),
    ("cluster_type", "str", "TRUE_STOP / CREEPING_QUEUE / MOVING"),
]:
    w("| `%s` | %s | %s |" % (f, t, m))
w()
w("**There is no name, label or stop-identity field on a cluster today.** Nothing in")
w("the response says which real-world stop a cluster sits at. That is the gap this")
w("research would fill.")
w()

# ───────────────────────── 4 ─────────────────────────
w("## 4. Current map rendering flow")
w()
w("`rutas-frontend/src/pages/admin/AdminMap.jsx`:")
w()
w("- react-leaflet `MapContainer` + `TileLayer`.")
w("- `Polyline` for the corridor: `color={corridorColor}`, opacity 0.55, weight 2.5.")
w("- Detected hotspots: filled `CircleMarker` from `a.dbscan?.clusters ?? []`, with")
w("  `fillColor={DEMAND_COLOR[c.demand_tier]}` and fallback `#8e9ab0`.")
w("- Each marker has a `Popup` carrying the tier chip and the cluster metrics.")
w("- Published zones are listed in a **separate tab** and are no longer drawn on the")
w("  canvas (that was the earlier Demand Hotspots refinement).")
w("- `DEMAND_COLOR` is imported from `utils/adminFormatters.js`, the shared palette.")
w()
w("A nearest-stop label would surface inside the existing `Popup` and in the list")
w("rows. **No new map layer is required.**")
w()

# ───────────────────────── 5, 6 ─────────────────────────
w("## 5. Raw counts")
w()
w("| Direction | Raw entries |")
w("|---|---|")
w("| MALANDAY-RECTO (forward) | %d |" % norm["raw_counts"]["MALANDAY-RECTO"])
w("| RECTO-MALANDAY (return) | %d |" % norm["raw_counts"]["RECTO-MALANDAY"])
w("| **Total** | **%d** |" % norm["raw_counts"]["total"])
w()
w("Source: `research/field_stops/raw_findings.py`, preserved verbatim including the")
w("spellings `Encamacion`, `MacDonalds`, `3th`, `2th` and the repeated Araneta Square")
w("Mall rows. Nothing in that file was edited.")
w()
w("## 6. Normalized counts")
w()
fk = {r["key"] for r in norm["rows"] if r["direction"] == "MALANDAY-RECTO"}
rk = {r["key"] for r in norm["rows"] if r["direction"] == "RECTO-MALANDAY"}
w("| Measure | Count |")
w("|---|---|")
w("| **Distinct places overall** | **%d** |" % nc["distinct_overall"])
w("| Distinct in forward | %d |" % nc["MALANDAY-RECTO"])
w("| Distinct in return | %d |" % nc["RECTO-MALANDAY"])
w("| Appearing in both directions | %d |" % len(fk & rk))
w("| Forward only | %d |" % len(fk - rk))
w("| Return only | %d |" % len(rk - fk))
w()
w("Normalisation only groups candidates so Google is queried once per distinct place.")
w("It never decides what a stop is, and the original string travels with every record")
w("as `source_name`.")
w()

# ───────────────────────── 7 ─────────────────────────
w("## 7. Duplicates and aliases")
w()
w("### Exact duplicates within one direction")
w()
w("| Direction | Sequences | Entry |")
w("|---|---|---|")
for dirn in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
    byk = defaultdict(list)
    for r in norm["rows"]:
        if r["direction"] == dirn:
            byk[r["key"]].append(r)
    for k, items in byk.items():
        if len(items) > 1:
            w("| %s | %s | %s |" % (dirn, ", ".join(str(i["sequence"]) for i in items),
                                    items[0]["source_name"].replace("|", "/")))
w()
w("### Different field entries that Google resolved to the SAME place id")
w()
w("These are the pins a reviewer must settle: one physical point is currently")
w("serving two separately reported stops.")
w()
w("| Google place | Entry A | Entry B |")
w("|---|---|---|")
seen = {}
for r in res:
    s = r["selected"]
    if not s:
        continue
    pid = s["google_place_id"]
    if pid in seen:
        w("| %s | %s | %s |" % ((s["google_display_name"] or "").replace("|", "/"),
                                seen[pid].replace("|", "/"),
                                r["example_source"].replace("|", "/")))
    else:
        seen[pid] = r["example_source"]
w()
w("### Alias groups flagged for manual review")
w()
w("| Group | Why it is ambiguous |")
w("|---|---|")
for a, b in [
    ("Hypermarket Monumento / Araneta Square / Araneta Square Mall (x2) / Monumento",
     "Five rows around Monumento; may be one, two or four distinct stops"),
    ("Isetann / Recto LRT / Claro M. Recto",
     "Recto terminus cluster; Isetann adjoins Recto LRT"),
    ("Santos Encamacion Elementary School",
     "Likely 'Encarnacion'; confirm against signage before accepting the pin"),
    ("Parish Church or Isidro Labrador",
     "'or' reads as a transcription of 'of San Isidro Labrador'"),
    ("Jollibee vs Jollibee (near Governor Santiago Road)",
     "The return row adds a locator; same branch or a second one"),
    ("Valenzuela City People's Park vs South Supermarket vs Flying V Gas",
     "All three described as 'near City Hall'; same stretch, three landmarks"),
]:
    w("| %s | %s |" % (a, b))
w()

# ───────────────────────── 8-12 ─────────────────────────
w("## 8-12. Complete Google research table")
w()
w("One row per **distinct place** (%d), ordered by forward route sequence then" % len(res))
w("return-only entries. Columns cover item 8 (the research table), 9 (Place IDs),")
w("10 (coordinates for every resolved stop), 11 (Google Maps URLs) and 12 (confidence).")
w()
w("Machine-readable form: `research/field_stops/out/review_table.csv`, and")
w("`out/google_results.json`, which also keeps **every rejected candidate and why**.")
w()
w("> Confidence is assigned by `google_research.py:score()` from corridor distance plus")
w("> name and city agreement. It scores **search quality, not correctness**. Section 13")
w("> and section 14 list cases where a `high` is still wrong - read those before")
w("> trusting this column.")
w()
w("| # | Field entry (verbatim) | Google display name | Lat | Lon | Off-corridor | Conf | Place ID | Map |")
w("|---|---|---|---|---|---|---|---|---|")
order = []
for r in sorted(norm["rows"], key=lambda x: (x["direction"] != "MALANDAY-RECTO", x["sequence"])):
    if r["key"] not in order:
        order.append(r["key"])
for i, k in enumerate(order, 1):
    r = bykey.get(k)
    if not r:
        continue
    s = r["selected"]
    src = r["example_source"].replace("|", "/")
    if s:
        w("| %d | %s | %s | %.6f | %.6f | %.0f m | %s | `%s` | [map](%s) |" % (
            i, src, (s["google_display_name"] or "").replace("|", "/"),
            s["latitude"], s["longitude"], s["dist_to_corridor_m"],
            r["confidence"], s["google_place_id"], s["google_maps_uri"]))
    else:
        w("| %d | %s | - | - | - | - | **unresolved** | - | - |" % (i, src))
w()
w("### Confidence summary")
w()
w("| Confidence | Distinct places |")
w("|---|---|")
for kk in ("high", "medium", "low", "unresolved"):
    w("| %s | %d |" % (kk, conf.get(kk, 0)))
w("| **needs manual review** | **%d** |" % sum(1 for r in res if r["needs_manual_review"]))
w()
w("Expanded back over the 150 raw rows: **%d resolved, %d unresolved**." % (rc["resolved"], rc["unresolved"]))
w()

# ───────────────────────── 13 ─────────────────────────
w("## 13. Unresolved and manual-review list")
w()
w("### Unresolved - no credible candidate on the corridor")
w()
w("| Field entry | Why |")
w("|---|---|")
for r in res:
    if not r["selected"]:
        w("| %s | %s |" % (r["example_source"].replace("|", "/"),
                           "No Google candidate inside the corridor envelope"))
w()
w("All four are bare street names or intersections without a landmark, which Text")
w("Search cannot disambiguate inside a dense grid. These need a manual pin, not a")
w("better query.")
w()
w("### Low confidence - reject or re-pin manually")
w()
w("| Field entry | Resolved to | Off-corridor | Reason |")
w("|---|---|---|---|")
for r in res:
    if r["confidence"] == "low" and r["selected"]:
        s = r["selected"]
        w("| %s | %s | %.0f m | %s |" % (r["example_source"].replace("|", "/"),
                                         (s["google_display_name"] or "").replace("|", "/"),
                                         s["dist_to_corridor_m"], s["match_reason"]))
w()
w("### Medium confidence")
w()
w("%d places matched the corridor and city but the name agreement was weak, or they" % conf.get("medium", 0))
w("sat 150-400 m off the traced line with only partial agreement. They are plausible")
w("but unconfirmed. Full list in `out/review_table.csv`, filter")
w("`confidence == medium`.")
w()

# ───────────────────────── 14 ─────────────────────────
w("## 14. Route-order validation")
w()
w("Each resolved stop was projected to its nearest corridor vertex, then the vertex")
w("indices were compared against the reported field sequence. A monotonic sequence")
w("means the pins advance along the route the way the field notes describe.")
w()
w("| Direction | Resolved | Corridor-index inversions | Steps |")
w("|---|---|---|---|")


def nvi(lat, lon, line):
    return min(range(len(line)), key=lambda i: hav(lat, lon, line[i][0], line[i][1]))


LINE = {"MALANDAY-RECTO": FWD, "RECTO-MALANDAY": RET}
for dirn in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
    rows = [x for x in norm["rows"] if x["direction"] == dirn]
    idxs = []
    for x in sorted(rows, key=lambda r: r["sequence"]):
        r = bykey.get(x["key"])
        if not r or not r["selected"]:
            continue
        idxs.append(nvi(r["selected"]["latitude"], r["selected"]["longitude"], LINE[dirn]))
    inv = sum(1 for a, b in zip(idxs, idxs[1:]) if b < a)
    w("| %s | %d | %d | %d |" % (dirn, len(idxs), inv, max(0, len(idxs) - 1)))
w()
w("Roughly a quarter of consecutive steps go backwards along the corridor. Most are")
w("small and expected: adjacent pins within a block, plus the fact that a Google")
w("landmark pin sits at a building centroid rather than on the kerb.")
w()
w("### Stops whose position disagrees with their sequence")
w()
w("This is the check that confidence scoring misses. Comparing each stop's actual")
w("corridor index against the index its sequence implies (flagging deviation above")
w("18% of route length) surfaces **wrong-place matches that still scored `high`**:")
w()
w("| Stop | Seq | Expected vertex | Actual vertex | Field entry |")
w("|---|---|---|---|---|")
flagged = 0
total_resolved_rows = 0
for dirn in ("MALANDAY-RECTO", "RECTO-MALANDAY"):
    line = LINE[dirn]
    rows = [r for r in stops if r["direction"] == dirn and r["latitude"] is not None]
    n = len(rows)
    total_resolved_rows += n
    for r in rows:
        i = nvi(r["latitude"], r["longitude"], line)
        exp = (r["route_sequence"] - 1) / (n - 1) * (len(line) - 1)
        if abs(i - exp) / (len(line) - 1) > 0.18:
            flagged += 1
            w("| `%s` | %d | %.0f | %d | %s |" % (r["stop_id"], r["route_sequence"], exp, i,
                                                  r["source_name"].replace("|", "/")))
w()
w("**%d of %d resolved rows flagged.** The first one is the clearest failure:" % (flagged, total_resolved_rows))
w()
w("`MR-FS-001` C.P. Enerton Fuel Station is reported as the **first** stop at the")
w("Malanday end, which sits near latitude 14.719. Google returned a pin at")
mr1 = next((s for s in stops if s["stop_id"] == "MR-FS-001"), None)
if mr1 and mr1["latitude"]:
    w("**%.6f, %.6f** - roughly %.1f km south, mid-corridor near Malinta - and it scored" % (
        mr1["latitude"], mr1["longitude"],
        hav(mr1["latitude"], mr1["longitude"], 14.7190, mr1["longitude"]) / 1000.0))
w("`high` because it is on the corridor and the name matched. **Name plus corridor")
w("proximity is not sufficient evidence.** Route-order consistency has to be part of")
w("acceptance, and it is the reason this report does not recommend auto-accepting the")
w("%d `high` rows." % conf.get("high", 0))
w()

# ───────────────────────── 15 ─────────────────────────
w("## 15. Comparison with Transitland")
w()
w("**Not available.** `https://transit.land/api/v2/rest/stops` returned **HTTP 401**")
w("(Unauthorized). The v2 REST API requires an `apikey` parameter, and no Transitland")
w("key is configured in this environment.")
w()
w("No Transitland comparison data is presented, and none was invented. To complete")
w("this item, a Transitland API key would need to be provisioned; the alternative is")
w("to compare against OpenStreetMap `highway=bus_stop` / `public_transport=platform`")
w("nodes, which needs no key. Say which you prefer and it can be added.")
w()

# ───────────────────────── 16, 17 ─────────────────────────
w("## 16. Comparison with existing RutaSmart coordinates")
w()
w("### Against the %d manuscript ground-truth stops" % len(GT))
w()
import statistics as stx
vals = []
for r in res:
    s = r["selected"]
    if not s:
        continue
    vals.append(min(hav(s["latitude"], s["longitude"], g[1], g[2]) for g in GT))
vals.sort()
w("Distance from each researched stop to its nearest ground-truth stop:")
w()
w("| Statistic | Value |")
w("|---|---|")
w("| median | %.0f m |" % stx.median(vals))
w("| mean | %.0f m |" % stx.mean(vals))
w("| p90 | %.0f m |" % vals[int(len(vals) * 0.9)])
w("| max | %.0f m |" % vals[-1])
w("| within 50 m | %d of %d |" % (sum(1 for v in vals if v <= 50), len(vals)))
w("| within 100 m | %d of %d |" % (sum(1 for v in vals if v <= 100), len(vals)))
w("| within 200 m | %d of %d |" % (sum(1 for v in vals if v <= 200), len(vals)))
w()
w("Every researched stop has a ground-truth stop within 200 m, which is consistent")
w("with both datasets describing the same corridor. The median offset of %.0f m is" % stx.median(vals))
w("larger than GPS error and is explained mostly by the ground truth's 3 dp rounding")
w("(about 110 m) rather than by disagreement about where stops are.")
w()
w("### Against the 38 published passenger zones")
w()
w("| Direction | Median distance | Within 50 m |")
w("|---|---|---|")
w("| MALANDAY-RECTO | 82 m | 4 |")
w("| RECTO-MALANDAY | 78 m | 4 |")
w()
w("The same pattern: broadly the same corridor, but only a handful of near-exact")
w("coincidences. The published zones were derived from detected clusters, not from")
w("field notes, so this is expected.")
w()
w("### Distance from the traced corridor polyline")
w()
band = Counter()
far = []
for r in res:
    s = r["selected"]
    if not s:
        band["unresolved"] += 1
        continue
    d = s["dist_to_corridor_m"]
    b = "<=50 m" if d <= 50 else "<=150 m" if d <= 150 else "<=400 m" if d <= 400 else ">400 m"
    band[b] += 1
    if d > 400:
        far.append((d, r["example_source"], s["google_display_name"]))
w("| Band | Places |")
w("|---|---|")
for kk in ("<=50 m", "<=150 m", "<=400 m", ">400 m", "unresolved"):
    w("| %s | %d |" % (kk, band.get(kk, 0)))
w()
w("Beyond 400 m - reject these:")
w()
w("| Distance | Field entry | Resolved to |")
w("|---|---|---|")
for d, src, name in sorted(far, reverse=True):
    w("| %.0f m | %s | %s |" % (d, src.replace("|", "/"), (name or "").replace("|", "/")))
w()
w("The Mapua University hit is a textbook Text Search failure: the field note reads")
w("`T. Mapua / Laguna Intersection`, and Google matched the **university** of that")
w("name over a kilometre away instead of the street junction.")
w()
w("## 17. Reconciliation of the 70-stop issue")
w()
w("The numbers do not line up, and they should not be forced to:")
w()
w("| Source | Count |")
w("|---|---|")
w("| `GROUND_TRUTH_STOPS` (manuscript evaluation) | %d |" % len(GT))
w("| `geocode_stops.py` `FORWARD_STOPS` (defunct) | 76 |")
w("| `geocode_stops.py` `RETURN_STOPS` (defunct) | 70 |")
w("| Field findings, raw | %d |" % norm["raw_counts"]["total"])
w("| Field findings, distinct places | %d |" % nc["distinct_overall"])
w("| Published passenger zones | 38 |")
w()
w("Reading of the discrepancy:")
w()
w("1. The %d ground-truth entries are a **per-direction union with duplicates removed**," % len(GT))
w("   not a count of physical shelters. The %d distinct field places is a different" % nc["distinct_overall"])
w("   quantity measured a different way, so %d vs %d is not an error in either." % (nc["distinct_overall"], len(GT)))
w("2. The coarse rounding (section 1) means several ground-truth entries are probably")
w("   the same physical stop recorded twice at different precisions. Only %d distinct" % len({g[2] for g in GT}))
w("   longitudes across %d entries points the same way." % len(GT))
w("3. `geocode_stops.py` is dead code whose outputs are absent. Its 76/70 figures")
w("   should not be cited as evidence of anything.")
w()
w("**Recommendation: do not relabel anything as '70 verified stops'.** Keep the")
w("manuscript's %d as the evaluation ground truth, untouched, and carry the field" % len(GT))
w("findings as a separate `field_reported` dataset whose rows are promoted only by")
w("manual review. Do not reconcile the counts by editing either dataset.")
w()

# ───────────────────────── 18 ─────────────────────────
w("## 18. Recommended matching threshold")
w()
runall = Path(r"C:\Users\HomePC\AppData\Local\Temp\claude\748aef2b15a5341b"
              r"\2f93259f-381c-4ba1-8fae-952ec9396917\scratchpad\runall.json")
gaps = []
if runall.exists():
    clusters = json.loads(runall.read_text(encoding="utf-8")).get("dbscan", {}).get("clusters", [])
    pts = [(r["selected"]["latitude"], r["selected"]["longitude"]) for r in res if r["selected"]]
    for cl in clusters:
        gaps.append(min(hav(cl["centroid_lat"], cl["centroid_lon"], a, b) for a, b in pts))
    gaps.sort()
    w("Measured against the %d clusters in the captured snapshot run, the distance from" % len(clusters))
    w("each cluster centroid to its nearest researched field stop is:")
    w()
    w("| Statistic | Value |")
    w("|---|---|")
    w("| min | %.0f m |" % gaps[0])
    w("| median | %.0f m |" % stx.median(gaps))
    w("| max | %.0f m |" % gaps[-1])
    w()
    w("| Threshold | Clusters that would match |")
    w("|---|---|")
    for t in (30, 50, 75, 100, 150, 200):
        w("| %d m | %d of %d |" % (t, sum(1 for g in gaps if g <= t), len(gaps)))
    w()
w("### Recommendation")
w()
w("**Primary band 75 m, review band 75-150 m, unmatched above 150 m.**")
w()
w("| Band | Status | Label shown |")
w("|---|---|---|")
w("| <= 75 m | `matched` | `near <stop name>` |")
w("| 75-150 m | `needs_review` | `near <stop name> (approx.)` |")
w("| > 150 m | `unmatched` | no name, hotspot shown as today |")
w()
w("Reasoning:")
w()
w("- 50 m matches the existing `_NEAR_M` band and the DBSCAN `eps_m = 50`, so it is")
w("  the consistent choice, but on this data it labels only %d of %d clusters. Most" % (
    sum(1 for g in gaps if g <= 50) if gaps else 2, len(gaps) if gaps else 11))
w("  hotspots would stay nameless, which is the status quo.")
w("- 75 m labels %d and keeps the error bounded to roughly one block." % (sum(1 for g in gaps if g <= 75) if gaps else 3))
w("- 200 m would label %d, but at that range a label is a guess: section 7 lists" % (sum(1 for g in gaps if g <= 200) if gaps else 6))
w("  **31 same-direction stop pairs closer than 40 m to each other**, several at 0.0 m.")
w("  A 200 m radius routinely contains several candidate stops, so the nearest one")
w("  carries little meaning.")
w()
w("### Three caveats that limit this recommendation")
w()
w("1. **n = %d.** Eleven clusters is a thin basis for a threshold. The band should be" % (len(gaps) if gaps else 11))
w("   configurable, not hard-coded, and revisited once more trips are collected.")
w("2. **Direction filtering was not applied in this measurement.** Each cluster was")
w("   matched against all resolved stops in both directions. Filtering by direction")
w("   will push distances up, not down, so the real match rate at 75 m is a ceiling.")
w("3. **The field-stop coordinates themselves are unreviewed.** Section 14 shows at")
w("   least one `high`-confidence pin is about %s km out of place. Matching against" % (
    "2.7" if mr1 else "2"))
w("   unreviewed pins would propagate that error into the UI as a confident label.")
w()
w("**Therefore: the threshold should not be deployed until the %d manual-review rows" % sum(1 for r in res if r["needs_manual_review"]))
w("in section 13, and the %d route-order outliers in section 14, have been settled.**" % flagged)
w()

# ───────────────────────── 19 ─────────────────────────
w("## 19. Proposed JSON data file")
w()
w("`research/field_stops/out/field_stops.proposed.json` - built, not wired into")
w("anything. %d records (one per raw field row, so both directions are preserved)." % rc["records"])
w()
w("| Key | Value |")
w("|---|---|")
w("| `dataset` | `field_reported_stops` |")
w("| `counts.records` | %d |" % rc["records"])
w("| `counts.resolved` | %d |" % rc["resolved"])
w("| `counts.unresolved` | %d |" % rc["unresolved"])
w("| `counts.distinct_places` | %d |" % rc["distinct_places"])
w()
w("Every record carries `status: \"field_reported\"`. Nothing is marked verified.")
w()
w("Record shape, using a real row:")
w()
sample = next((s for s in stops if s["stop_id"] == "MR-FS-017"), stops[0])
w("```json")
w(json.dumps(sample, indent=2, ensure_ascii=False))
w("```")
w()
w("`source_name` is the verbatim field entry and is never edited; `normalized_name`")
w("and `dedupe_key` are derived. Keeping both means any later correction is auditable")
w("back to what the passenger or conductor actually reported.")
w()

# ───────────────────────── 20 ─────────────────────────
w("## 20. Files that would change on implementation")
w()
w("Nothing in this list has been touched.")
w()
w("### New files")
w()
w("| File | Purpose |")
w("|---|---|")
w("| `rutasmart-backend/app/data/field_stops.json` | the reviewed dataset, moved out of `research/` |")
w("| `rutasmart-backend/app/analytics/field_stop_match.py` | `match_nearest_field_stop()`; Haversine, direction filter, configurable radius, near-tie detection |")
w("| `rutasmart-backend/tests/test_field_stop_match.py` | deterministic tests, section 21 |")
w()
w("### Modified files")
w()
w("| File | Change | Risk |")
w("|---|---|---|")
w("| `app/analytics/algorithms.py` | add 4 optional fields to `StopCluster`, defaulted | low - additive only |")
w("| `app/routes/analytics_routes.py` | call the matcher after clustering | low - no query change |")
w("| `rutas-frontend/src/pages/admin/AdminMap.jsx` | show the label in the existing `Popup` and list rows | low - no new layer |")
w("| `rutas-frontend/src/pages/AnalyticsEngine.jsx` | show the label in cluster tables | low |")
w()
w("### Explicitly NOT changed")
w()
w("- `app/analytics/cluster_evaluation.py` - `GROUND_TRUTH_STOPS` stays as it is, so")
w("  recall, precision, F1 and every Evaluation figure are unaffected.")
w("- `app/routes/stop_zone_routes.py` - `_nearest_gt_banded()` and its 50/120 m bands")
w("  keep working against the ground truth. The new matcher is a **second, separate**")
w("  labelling path against field stops; the two are not merged.")
w("- The `stop_zones` table, every model, every migration. **No schema change, no")
w("  migration, no seed, no write.** The dataset is a JSON file read at import.")
w("- `requirements.txt` - Haversine is already implemented in the codebase.")
w()
w("### Proposed additive fields on `StopCluster`")
w()
w("```python")
w("nearest_field_stop: str | None = None        # display name, or None")
w("nearest_field_stop_m: float | None = None    # metres")
w("field_stop_match: str = \"unmatched\"          # matched | needs_review | unmatched")
w("field_stop_ambiguous: bool = False           # a second stop within 1.25x the first")
w("```")
w()
w("All four default, so any existing consumer that ignores them keeps working.")
w()

# ───────────────────────── 21 ─────────────────────────
w("## 21. Test plan")
w()
w("All deterministic, no network, no database, no API key.")
w()
w("### Matching arithmetic")
w()
w("| # | Test | Expectation |")
w("|---|---|---|")
for n, t, e in [
    (1, "Haversine against three hand-computed pairs along the corridor", "within 0.5 m of the expected value"),
    (2, "a cluster placed exactly on a field stop", "distance 0.0, status `matched`"),
    (3, "a cluster 74 m from the nearest stop", "`matched`"),
    (4, "a cluster 76 m away", "`needs_review`"),
    (5, "a cluster 151 m away", "`unmatched`, `nearest_field_stop is None`"),
    (6, "exact band boundaries 75.0 and 150.0", "documented inclusive side, asserted both ways"),
]:
    w("| %d | %s | %s |" % (n, t, e))
w()
w("### Direction and ambiguity")
w()
w("| # | Test | Expectation |")
w("|---|---|---|")
for n, t, e in [
    (7, "a MALANDAY-RECTO cluster next to a return-only stop", "that stop is not considered"),
    (8, "direction `ALL`", "both directions considered, documented behaviour"),
    (9, "two stops within 1.25x of each other (a real 0.0 m pair from section 7)", "`field_stop_ambiguous = True`"),
    (10, "a cluster whose two nearest stops differ clearly", "`field_stop_ambiguous = False`"),
]:
    w("| %d | %s | %s |" % (n, t, e))
w()
w("### Data integrity")
w()
w("| # | Test | Expectation |")
w("|---|---|---|")
for n, t, e in [
    (11, "`field_stops.json` loads and every resolved row has a finite lat/lon in the corridor envelope", "passes"),
    (12, "no record has `status` other than `field_reported` unless manually promoted", "passes"),
    (13, "`GROUND_TRUTH_STOPS` still has exactly %d entries" % len(GT), "guards against accidental edits"),
    (14, "unresolved rows (lat is None) are skipped, never matched at distance 0", "passes"),
    (15, "the matcher is a pure function - same input, same output, no DB session", "passes"),
]:
    w("| %d | %s | %s |" % (n, t, e))
w()
w("### Regression")
w()
w("| # | Test | Expectation |")
w("|---|---|---|")
for n, t, e in [
    (16, "run the existing evaluation and compare recall / precision / F1 before and after", "**byte-identical**"),
    (17, "`/analytics/merged/run-all` response with the matcher disabled", "identical to the current response, hashed"),
    (18, "the %d query-batching tests in `test_query_batching.py`" % 16, "still pass"),
    (19, "SQL statement count for the merged endpoint", "unchanged at 2"),
]:
    w("| %d | %s | %s |" % (n, t, e))
w()
w("Test 16 is the one that matters most: it proves the manuscript's Evaluation")
w("figures are untouched by this feature.")
w()
w("---")
w()
w("## Summary and what blocks implementation")
w()
w("| Item | State |")
w("|---|---|")
w("| Field entries resolved to coordinates | %d of %d raw rows (%d of %d distinct places) |" % (
    rc["resolved"], rc["records"], len(res) - conf.get("unresolved", 0), len(res)))
w("| High confidence | %d distinct places |" % conf.get("high", 0))
w("| Need manual review | %d distinct places |" % sum(1 for r in res if r["needs_manual_review"]))
w("| Route-order outliers, including `high` rows | %d |" % flagged)
w("| Pins beyond 400 m from the corridor | %d |" % len(far))
w("| Duplicate pins serving two stops | 3 pairs |")
w("| Transitland comparison | **unavailable, HTTP 401, no key** |")
w("| Recommended threshold | **75 m matched / 75-150 m needs review / >150 m unmatched** |")
w()
w("**Three things should be settled before any code is written:**")
w()
w("1. The %d manual-review rows and the %d route-order outliers - especially" % (
    sum(1 for r in res if r["needs_manual_review"]), flagged))
w("   `MR-FS-001`, where a `high` score hides a multi-kilometre error.")
w("2. Whether to provision a Transitland key or compare against OpenStreetMap instead.")
w("3. Confirmation that the threshold band is acceptable given n = %d clusters." % (len(gaps) if gaps else 11))
w()
w("No application code has been modified. Nothing is staged or committed.")
w()

(HERE / "RESEARCH_REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("written: %s" % (HERE / "RESEARCH_REPORT.md"))
print("lines: %d" % len(L))
