"""Validate the researched coordinates and recommend a matching threshold.

Offline: reads out/google_results.json, the corridor geometry, the
manuscript ground truth and the detected clusters already captured from
the local snapshot. No network, no key, no database writes.
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
sys.path.insert(0, r"C:\Users\HomePC\rutasmart-data-collector\rutasmart-backend")


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_vertex_index(lat, lon, line):
    best, bi = float("inf"), -1
    for i, (a, b) in enumerate(line):
        d = haversine_m(lat, lon, a, b)
        if d < best:
            best, bi = d, i
    return bi, best


def hdr(t):
    print("\n" + "=" * 74 + "\n" + t + "\n" + "=" * 74)


def main():
    res = json.loads((OUT / "google_results.json").read_text(encoding="utf-8"))
    norm = json.loads((OUT / "normalized.json").read_text(encoding="utf-8"))
    corr = json.loads((OUT / "corridor.json").read_text(encoding="utf-8"))
    fwd, ret = corr["CORRIDOR"], corr["RETURN_CORRIDOR"]
    bykey = {r["key"]: r for r in res}

    # ── confidence summary ──────────────────────────────────────────────
    hdr("1. CONFIDENCE SUMMARY (90 distinct places)")
    c = Counter(r["confidence"] for r in res)
    for k in ("high", "medium", "low", "unresolved"):
        print("  %-12s %d" % (k, c.get(k, 0)))
    print("  needs manual review: %d"
          % sum(1 for r in res if r["needs_manual_review"]))

    # ── duplicate coordinates across different places ───────────────────
    hdr("2. DUPLICATE COORDINATES (different field stops, same pin)")
    seen = {}
    dupes = []
    for r in res:
        s = r["selected"]
        if not s:
            continue
        pid = s["google_place_id"]
        if pid in seen:
            dupes.append((seen[pid], r["example_source"], s["google_display_name"]))
        else:
            seen[pid] = r["example_source"]
    if not dupes:
        print("  none")
    for a, b, name in dupes:
        print("  same Google place '%s':" % name)
        print("      %s" % a[:64])
        print("      %s" % b[:64])

    # ── distance off the corridor ───────────────────────────────────────
    hdr("3. DISTANCE FROM THE TRACED CORRIDOR")
    band = Counter()
    far = []
    for r in res:
        s = r["selected"]
        if not s:
            band["unresolved"] += 1
            continue
        d = s["dist_to_corridor_m"]
        b = ("<=50 m" if d <= 50 else "<=150 m" if d <= 150
             else "<=400 m" if d <= 400 else ">400 m")
        band[b] += 1
        if d > 400:
            far.append((d, r["example_source"], s["google_display_name"]))
    for k in ("<=50 m", "<=150 m", "<=400 m", ">400 m", "unresolved"):
        print("  %-12s %d" % (k, band.get(k, 0)))
    if far:
        print("\n  beyond 400 m - reject or review:")
        for d, src, name in sorted(far, reverse=True):
            print("    %6.0f m  %-44s -> %s" % (d, src[:44], (name or "")[:28]))

    # ── route-order validation ──────────────────────────────────────────
    hdr("4. ROUTE-ORDER VALIDATION")
    for direction, line in (("MALANDAY-RECTO", fwd), ("RECTO-MALANDAY", ret)):
        rows = [x for x in norm["rows"] if x["direction"] == direction]
        idxs = []
        for x in sorted(rows, key=lambda r: r["sequence"]):
            r = bykey.get(x["key"])
            if not r or not r["selected"]:
                continue
            i, _ = nearest_vertex_index(r["selected"]["latitude"],
                                        r["selected"]["longitude"], line)
            idxs.append((x["sequence"], i, x["source_name"]))
        inversions = sum(1 for a, b in zip(idxs, idxs[1:]) if b[1] < a[1])
        print("  %-16s resolved=%-3d corridor-index inversions=%d of %d steps"
              % (direction, len(idxs), inversions, max(0, len(idxs) - 1)))
        worst = sorted(
            [(a[1] - b[1], a, b) for a, b in zip(idxs, idxs[1:]) if b[1] < a[1]],
            reverse=True)[:4]
        for delta, a, b in worst:
            print("      back %3d vertices: #%d %s" % (delta, b[0], b[2][:46]))

    # ── comparison with the manuscript ground truth ─────────────────────
    hdr("5. COMPARISON WITH THE EXISTING 70 GROUND-TRUTH STOPS")
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS as GT
    print("  ground-truth entries: %d" % len(GT))
    ds = []
    for r in res:
        s = r["selected"]
        if not s:
            continue
        d = min(haversine_m(s["latitude"], s["longitude"], g[1], g[2]) for g in GT)
        ds.append((d, r["example_source"]))
    ds.sort()
    if ds:
        import statistics
        vals = [d for d, _ in ds]
        print("  distance from each researched stop to its nearest GT stop:")
        print("    median %.0f m   mean %.0f m   p90 %.0f m   max %.0f m"
              % (statistics.median(vals), statistics.mean(vals),
                 vals[int(len(vals) * 0.9)], vals[-1]))
        print("    within  50 m: %d" % sum(1 for v in vals if v <= 50))
        print("    within 100 m: %d" % sum(1 for v in vals if v <= 100))
        print("    within 200 m: %d" % sum(1 for v in vals if v <= 200))
        print("\n  furthest from any ground-truth stop:")
        for d, src in ds[-5:][::-1]:
            print("    %6.0f m  %s" % (d, src[:58]))

    # ── threshold recommendation from real clusters ─────────────────────
    hdr("6. DETECTED CLUSTERS vs RESEARCHED FIELD STOPS")
    runall = Path(r"C:\Users\HomePC\AppData\Local\Temp\claude"
                  r"\748aef2b15a5341b\2f93259f-381c-4ba1-8fae-952ec9396917"
                  r"\scratchpad\runall.json")
    if not runall.exists():
        print("  captured cluster file not found; skipping")
        return
    clusters = json.loads(runall.read_text(encoding="utf-8")).get("dbscan", {}).get("clusters", [])
    stops = [(r["selected"]["latitude"], r["selected"]["longitude"],
              r["example_source"], r["confidence"])
             for r in res if r["selected"]]
    print("  clusters: %d   resolved field stops: %d" % (len(clusters), len(stops)))
    print("\n  %-4s %-9s %-10s %s" % ("id", "nearest", "2nd", "nearest field stop"))
    print("  " + "-" * 70)
    gaps = []
    for cl in clusters:
        d = sorted((haversine_m(cl["centroid_lat"], cl["centroid_lon"], a, b), src, conf)
                   for a, b, src, conf in stops)
        gaps.append(d[0][0])
        near2 = d[1][0] if len(d) > 1 else float("inf")
        print("  %-4s %7.0f m %8.0f m  %s" % (cl["cluster_id"], d[0][0], near2,
                                              d[0][1].split(",")[0][:40]))
    if gaps:
        import statistics
        gaps_sorted = sorted(gaps)
        print("\n  cluster-to-nearest-stop distance:")
        print("    min %.0f  median %.0f  max %.0f m"
              % (gaps_sorted[0], statistics.median(gaps_sorted), gaps_sorted[-1]))
        for t in (30, 50, 75, 100, 150, 200):
            print("    threshold %3d m -> %d of %d clusters would match"
                  % (t, sum(1 for g in gaps if g <= t), len(gaps)))


if __name__ == "__main__":
    main()
