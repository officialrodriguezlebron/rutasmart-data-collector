"""Build the runtime field-stop dataset from the research artefacts.

Offline. No Google calls, no network, no database, no key. Reads the research
outputs and emits one JSON file that the backend loads at import:

    rutasmart-backend/app/data/field_stops.json

Every exclusion the research report calls for is computed here and baked into
the record as a boolean, so the runtime matcher never has to re-derive it and
no stop id is hardcoded anywhere:

  resolved            Google returned a coordinate at all
  route_order_ok      position along the corridor agrees with the field sequence
  place_id_unique     this Google place id backs exactly one distinct field place
  on_corridor         within ON_CORRIDOR_MAX_M of the traced polyline

A candidate is eligible for matching only if all four hold. Confidence is
carried through unchanged so the matcher can refuse to call a low-confidence
pin "matched".

Nothing here touches GROUND_TRUTH_STOPS, the 70-stop evaluation data, the
published zones, or any cluster metric.
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
ROOT = HERE.parent.parent
DEST = ROOT / "rutasmart-backend" / "app" / "data" / "field_stops.json"

# A pin further than this from the traced corridor is not credible as a stop
# on this route. The research report rejects 3 pins at >400 m.
ON_CORRIDOR_MAX_M = 400.0

# Flag a stop whose position along the corridor disagrees with its reported
# sequence by more than this share of total route length.
ROUTE_ORDER_TOLERANCE = 0.18


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_vertex_index(lat, lon, line):
    return min(range(len(line)),
               key=lambda i: haversine_m(lat, lon, line[i][0], line[i][1]))


def main():
    prop = json.loads((OUT / "field_stops.proposed.json").read_text(encoding="utf-8"))
    corr = json.loads((OUT / "corridor.json").read_text(encoding="utf-8"))
    LINE = {"MALANDAY-RECTO": corr["CORRIDOR"],
            "RECTO-MALANDAY": corr["RETURN_CORRIDOR"]}

    src = prop["stops"]

    # ── place id uniqueness ───────────────────────────────────────────────
    # The same real place appearing in both directions shares a dedupe_key and
    # is NOT ambiguous. Ambiguity is one Google place id standing in for two
    # genuinely different reported places.
    keys_per_pid = defaultdict(set)
    for r in src:
        if r["google_place_id"]:
            keys_per_pid[r["google_place_id"]].add(r["dedupe_key"])
    ambiguous_pids = {p for p, ks in keys_per_pid.items() if len(ks) > 1}

    # ── route-order check, per direction ──────────────────────────────────
    route_order_bad = set()
    for direction, line in LINE.items():
        rows = [r for r in src
                if r["direction"] == direction and r["latitude"] is not None]
        n = len(rows)
        if n < 2:
            continue
        span = len(line) - 1
        for r in rows:
            i = nearest_vertex_index(r["latitude"], r["longitude"], line)
            expected = (r["route_sequence"] - 1) / (n - 1) * span
            if abs(i - expected) / span > ROUTE_ORDER_TOLERANCE:
                route_order_bad.add(r["stop_id"])

    # ── assemble ──────────────────────────────────────────────────────────
    records = []
    for r in src:
        resolved = r["latitude"] is not None
        pid = r["google_place_id"]
        on_corridor = bool(
            resolved
            and r["dist_to_corridor_m"] is not None
            and r["dist_to_corridor_m"] <= ON_CORRIDOR_MAX_M
        )
        route_ok = r["stop_id"] not in route_order_bad
        pid_unique = bool(pid) and pid not in ambiguous_pids

        reasons = []
        if not resolved:
            reasons.append("unresolved")
        if not route_ok:
            reasons.append("route_order_conflict")
        if resolved and not pid_unique:
            reasons.append("ambiguous_place_id")
        if resolved and not on_corridor:
            reasons.append("outside_corridor")

        records.append({
            "stop_id": r["stop_id"],
            "status": "field_reported",
            "display_name": r["normalized_name"],
            "source_name": r["source_name"],
            "direction": r["direction"],
            "route_sequence": r["route_sequence"],
            "city": r["city"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "google_place_id": pid,
            "google_display_name": r["google_display_name"],
            "confidence": r["confidence"],
            "corridor_distance_m": r["dist_to_corridor_m"],
            "dedupe_key": r["dedupe_key"],
            # eligibility, precomputed
            "resolved": resolved,
            "route_order_ok": route_ok,
            "place_id_unique": pid_unique,
            "on_corridor": on_corridor,
            "eligible_for_matching": bool(resolved and route_ok and pid_unique and on_corridor),
            "ineligible_reasons": reasons,
        })

    eligible = [r for r in records if r["eligible_for_matching"]]
    by_dir = Counter(r["direction"] for r in eligible)
    by_conf = Counter(r["confidence"] for r in eligible)

    payload = {
        "dataset": "field_reported_stops",
        "note": (
            "Passenger and conductor field findings resolved to coordinates via "
            "Google Places API (New) Text Search, offline, during research. "
            "NOT the manuscript's 70-stop ground truth (GROUND_TRUTH_STOPS), NOT "
            "the published passenger zones, NOT research clusters. Every row "
            "keeps status 'field_reported' until manually promoted. No Google "
            "API call is made at runtime; this file is the only source."
        ),
        "generated_by": "research/field_stops/build_dataset.py",
        "generated_from": "research/field_stops/out/field_stops.proposed.json",
        "parameters": {
            "on_corridor_max_m": ON_CORRIDOR_MAX_M,
            "route_order_tolerance": ROUTE_ORDER_TOLERANCE,
        },
        "counts": {
            "records": len(records),
            "resolved": sum(1 for r in records if r["resolved"]),
            "eligible_for_matching": len(eligible),
            "excluded_unresolved": sum(1 for r in records if not r["resolved"]),
            "excluded_route_order": sum(1 for r in records if not r["route_order_ok"]),
            "excluded_ambiguous_place_id": sum(
                1 for r in records if r["resolved"] and not r["place_id_unique"]),
            "excluded_outside_corridor": sum(
                1 for r in records if r["resolved"] and not r["on_corridor"]),
            "eligible_by_direction": dict(by_dir),
            "eligible_by_confidence": dict(by_conf),
        },
        "stops": records,
    }

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")

    c = payload["counts"]
    print("  written: %s" % DEST)
    print("  records              %d" % c["records"])
    print("  resolved             %d" % c["resolved"])
    print("  ELIGIBLE             %d   (%s)" % (c["eligible_for_matching"], dict(by_dir)))
    print("  excluded unresolved           %d" % c["excluded_unresolved"])
    print("  excluded route order          %d" % c["excluded_route_order"])
    print("  excluded ambiguous place id   %d" % c["excluded_ambiguous_place_id"])
    print("  excluded outside corridor     %d" % c["excluded_outside_corridor"])
    print("  eligible by confidence        %s" % dict(by_conf))


if __name__ == "__main__":
    main()
