"""Assemble the proposed field-stop reference file and a review table.

Offline. Produces two artefacts for review, neither of which is wired into
the application:

  out/field_stops.proposed.json  the candidate data file
  out/review_table.csv           one row per researched place, for eyeballing

Every record carries status "field_reported". Nothing here is called
verified, and nothing overwrites the manuscript ground truth, the
published zones or any cluster field.
"""
import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"


def hav(a, b, c, d):
    R = 6371008.8
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = math.radians(c - a), math.radians(d - b)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def main():
    res = {r["key"]: r for r in json.loads(
        (OUT / "google_results.json").read_text(encoding="utf-8"))}
    norm = json.loads((OUT / "normalized.json").read_text(encoding="utf-8"))

    records = []
    seq = {"MALANDAY-RECTO": 0, "RECTO-MALANDAY": 0}
    prefix = {"MALANDAY-RECTO": "MR-FS", "RECTO-MALANDAY": "RM-FS"}

    for row in sorted(norm["rows"], key=lambda r: (r["direction"], r["sequence"])):
        r = res.get(row["key"])
        sel = r["selected"] if r else None
        seq[row["direction"]] += 1
        sid = "%s-%03d" % (prefix[row["direction"]], seq[row["direction"]])
        records.append({
            "stop_id": sid,
            "status": "field_reported",          # never "verified"
            "source_name": row["source_name"],   # verbatim, never edited
            "normalized_name": row["landmark"],
            "direction": row["direction"],
            "route_sequence": row["sequence"],
            "city": row["city"],
            "barangay": row["barangay"],
            "latitude": sel["latitude"] if sel else None,
            "longitude": sel["longitude"] if sel else None,
            "google_place_id": sel["google_place_id"] if sel else None,
            "google_display_name": sel["google_display_name"] if sel else None,
            "google_formatted_address": sel["google_formatted_address"] if sel else None,
            "google_maps_uri": sel["google_maps_uri"] if sel else None,
            "dist_to_corridor_m": sel["dist_to_corridor_m"] if sel else None,
            "confidence": r["confidence"] if r else "unresolved",
            "needs_manual_review": r["needs_manual_review"] if r else True,
            "match_reason": sel["match_reason"] if sel else "No Google candidate on the corridor",
            "dedupe_key": row["key"],
        })

    payload = {
        "dataset": "field_reported_stops",
        "note": ("Passenger and conductor findings resolved to coordinates via "
                 "Google Places API (New) Text Search. NOT the manuscript's "
                 "70-stop ground truth, NOT the published passenger zones, NOT "
                 "research clusters. Status stays 'field_reported' until each "
                 "row is manually approved."),
        "generated_from": "research/field_stops/raw_findings.py",
        "counts": {
            "records": len(records),
            "MALANDAY-RECTO": sum(1 for r in records if r["direction"] == "MALANDAY-RECTO"),
            "RECTO-MALANDAY": sum(1 for r in records if r["direction"] == "RECTO-MALANDAY"),
            "distinct_places": len(res),
            "resolved": sum(1 for r in records if r["latitude"] is not None),
            "unresolved": sum(1 for r in records if r["latitude"] is None),
        },
        "stops": records,
    }
    (OUT / "field_stops.proposed.json").write_text(
        json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")

    cols = ["stop_id", "direction", "route_sequence", "source_name",
            "google_display_name", "latitude", "longitude",
            "dist_to_corridor_m", "confidence", "needs_manual_review",
            "google_place_id", "google_maps_uri", "match_reason"]
    with (OUT / "review_table.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)

    print("  records: %d  (%d resolved, %d unresolved)"
          % (len(records), payload["counts"]["resolved"],
             payload["counts"]["unresolved"]))
    print("  %s" % (OUT / "field_stops.proposed.json"))
    print("  %s" % (OUT / "review_table.csv"))

    # Near-tie check: two stops close enough that a match could flip.
    pts = [(r["latitude"], r["longitude"], r["stop_id"], r["direction"])
           for r in records if r["latitude"] is not None]
    ties = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if pts[i][3] != pts[j][3]:
                continue
            d = hav(pts[i][0], pts[i][1], pts[j][0], pts[j][1])
            if d < 40:
                ties.append((d, pts[i][2], pts[j][2]))
    print("\n  same-direction stop pairs closer than 40 m: %d" % len(ties))
    for d, a, b in sorted(ties)[:8]:
        print("    %5.1f m  %s / %s" % (d, a, b))


if __name__ == "__main__":
    main()
