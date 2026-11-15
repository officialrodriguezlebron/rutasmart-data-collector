"""Resolve field-reported stops to coordinates via Google Places API (New).

Research only. Nothing here runs at application runtime, writes to a
database, or is imported by app code.

Key handling
------------
The key is read from the GOOGLE_MAPS_API_KEY environment variable and is
never printed, logged, written to any output file, or included in a saved
request. Output records carry only place ids, names, addresses, coordinates
and Google Maps URLs.

A note on "no POST": the safety rules forbid mutating requests against
RutaSmart's own API and database. Places Text Search (New) is an HTTP POST
by protocol design - it is a read-only search that creates nothing. No
RutaSmart endpoint, database or deployment is touched.

Strategy per stop
-----------------
  1. search the supplied string, biased to the corridor
  2. if nothing survives validation, retry with a cleaned variant
  3. if still nothing, retry with the city appended explicitly
Every candidate from every attempt is kept, so a reviewer can see what was
rejected and why. A weak result is recorded as low/unresolved rather than
being promoted quietly.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ("places.id,places.displayName,places.formattedAddress,"
              "places.location,places.googleMapsUri")

# Corridor envelope, padded. Anything outside is rejected outright.
LAT_MIN, LAT_MAX = 14.59, 14.73
LON_MIN, LON_MAX = 120.94, 121.00

# Distance from the traced corridor polyline at which a result stops being
# credible as a stop on this route.
ON_CORRIDOR_M = 150.0
NEAR_CORRIDOR_M = 400.0

DELAY_S = 0.12          # courteous pacing; Places allows far more


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def point_to_polyline_m(lat, lon, line):
    """Smallest distance from a point to any vertex of the corridor.

    Vertex distance rather than true segment distance: the corridor is
    traced at roughly 20-40 m spacing, so the error is well inside the
    thresholds used here and the arithmetic stays obvious.
    """
    return min(haversine_m(lat, lon, a, b) for a, b in line)


def search(query, key, bias=None):
    body = {"textQuery": query, "maxResultCount": 5,
            "languageCode": "en", "regionCode": "PH"}
    if bias:
        body["locationBias"] = bias
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,          # never logged
            "X-Goog-FieldMask": FIELD_MASK,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        # Scrub anything resembling a key from an error echo.
        return None, "HTTP %s: %s" % (e.code, detail.replace(key, "<redacted>"))
    except Exception as e:                   # noqa: BLE001
        return None, "%s: %s" % (type(e).__name__, e)


def candidate_from(place, corridor_fwd, corridor_ret):
    loc = place.get("location") or {}
    lat, lon = loc.get("latitude"), loc.get("longitude")
    if lat is None or lon is None:
        return None
    d_fwd = point_to_polyline_m(lat, lon, corridor_fwd)
    d_ret = point_to_polyline_m(lat, lon, corridor_ret)
    return {
        "google_place_id": place.get("id"),
        "google_display_name": (place.get("displayName") or {}).get("text"),
        "google_formatted_address": place.get("formattedAddress"),
        "latitude": lat,
        "longitude": lon,
        "google_maps_uri": place.get("googleMapsUri"),
        "in_envelope": LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX,
        "dist_to_corridor_m": round(min(d_fwd, d_ret), 1),
    }


def score(cand, row):
    """confidence + reason, from corridor position and name/city agreement."""
    if not cand["in_envelope"]:
        return "low", "Outside the corridor envelope"
    d = cand["dist_to_corridor_m"]
    addr = (cand["google_formatted_address"] or "").lower()
    name = (cand["google_display_name"] or "").lower()
    landmark = row["example_source"].split(",")[0].lower()
    city = (row.get("city") or "").lower()

    city_ok = (not city) or any(
        c in addr for c in [city.replace(" city", ""), city])
    # Loose containment either way: "Jollibee" vs "Jollibee MacArthur Malinta"
    tokens = [t for t in landmark.replace("/", " ").split()
              if len(t) > 3 and t not in ("macarthur", "highway", "street", "intersection")]
    name_hits = sum(1 for t in tokens if t in name or t in addr)
    name_ok = name_hits >= max(1, len(tokens) // 3) if tokens else False

    if d <= ON_CORRIDOR_M and city_ok and name_ok:
        return "high", "On corridor (%.0f m), name and city agree" % d
    if d <= ON_CORRIDOR_M and city_ok:
        return "medium", "On corridor (%.0f m), city agrees, name match weak" % d
    if d <= NEAR_CORRIDOR_M and (city_ok or name_ok):
        return "medium", "Near corridor (%.0f m), partial agreement" % d
    if d <= NEAR_CORRIDOR_M:
        return "low", "Near corridor (%.0f m) but name and city disagree" % d
    return "low", "%.0f m from the corridor" % d


def main():
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        sys.exit("GOOGLE_MAPS_API_KEY is not set in this process. Aborting.")

    corridor = json.loads((OUT / "corridor.json").read_text(encoding="utf-8"))
    fwd, ret = corridor["CORRIDOR"], corridor["RETURN_CORRIDOR"]
    norm = json.loads((OUT / "normalized.json").read_text(encoding="utf-8"))
    queries = norm["unique_queries"]

    bias = {"rectangle": {
        "low":  {"latitude": LAT_MIN, "longitude": LON_MIN},
        "high": {"latitude": LAT_MAX, "longitude": LON_MAX}}}

    results = []
    print("  researching %d distinct places" % len(queries), flush=True)
    for i, row in enumerate(queries, 1):
        attempts = []
        chosen = None
        base = row["query"]
        cleaned = base.split(",")[0] + (", %s" % row["city"] if row["city"] else "")
        cleaned = cleaned + ", Metro Manila, Philippines"
        variants = [base, cleaned]
        if row.get("road_hint"):
            variants.append("%s, %s, Metro Manila, Philippines"
                            % (base.split(",")[0], row["road_hint"]))

        for v in dict.fromkeys(variants):          # de-dup, keep order
            data, err = search(v, key, bias)
            time.sleep(DELAY_S)
            if err:
                attempts.append({"query": v, "error": err, "candidates": []})
                continue
            cands = []
            for p in (data or {}).get("places", []):
                c = candidate_from(p, fwd, ret)
                if c:
                    conf, why = score(c, row)
                    c["confidence"] = conf
                    c["match_reason"] = why
                    cands.append(c)
            attempts.append({"query": v, "error": None, "candidates": cands})
            ranked = sorted(
                [c for c in cands if c["in_envelope"]],
                key=lambda c: ({"high": 0, "medium": 1, "low": 2}[c["confidence"]],
                               c["dist_to_corridor_m"]))
            if ranked and ranked[0]["confidence"] in ("high", "medium"):
                chosen = ranked[0]
                break
            if ranked and chosen is None:
                chosen = ranked[0]                 # keep the best weak one

        results.append({
            "key": row["key"],
            "example_source": row["example_source"],
            "city": row["city"],
            "road_hint": row["road_hint"],
            "attempts": attempts,
            "selected": chosen,
            "confidence": chosen["confidence"] if chosen else "unresolved",
            "needs_manual_review": (not chosen) or chosen["confidence"] != "high",
        })
        if i % 10 == 0:
            print("    %d/%d" % (i, len(queries)), flush=True)

    (OUT / "google_results.json").write_text(
        json.dumps(results, indent=1), encoding="utf-8")

    by = {}
    for r in results:
        by[r["confidence"]] = by.get(r["confidence"], 0) + 1
    print("\n  confidence: %s" % dict(sorted(by.items())))
    print("  written: %s" % (OUT / "google_results.json"))


if __name__ == "__main__":
    main()
