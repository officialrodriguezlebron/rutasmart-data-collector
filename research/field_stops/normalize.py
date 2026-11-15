"""Normalise the raw field findings and reconcile duplicates.

No network, no API key, no database. Pure text work over raw_findings.py,
so it can be re-run and reviewed freely.

Normalisation does three things and records all of them:
  1. splits each entry into a landmark/intersection part and a place part
  2. repairs obvious transcription slips ("3th" -> "3rd") WITHOUT editing
     the raw list - the original string is always carried along
  3. derives a comparison key so the same real-world stop appearing in both
     directions, or twice in one direction, can be found

Nothing here decides what a stop IS. It only groups candidates so the
Google research runs once per distinct place instead of once per row.
"""
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from raw_findings import FORWARD_RAW, RETURN_RAW

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

CITY_WORDS = [
    "Valenzuela City", "Caloocan City", "Malabon City", "Quezon City",
    "City of Manila", "Philippines",
]

BARANGAYS = ["Malanday", "Dalandanan", "Malinta", "Karuhatan"]

# Ordinal slips in the raw list. The raw text is preserved; this only
# affects the comparison key and the suggested query string.
ORDINAL_FIX = {"3th": "3rd", "2th": "2nd", "1th": "1st"}

# Spelling variants seen in the field notes, kept explicit so a reviewer
# can see exactly what was treated as the same place.
ALIAS_HINTS = {
    "encamacion": "encarnacion",      # likely Santos Encarnacion
    "macdonalds": "mcdonalds",
    "centre": "center",
    "dep. store": "department store",
}


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def split_place(entry):
    """Return (landmark_part, city, barangay, road_hint)."""
    city = next((c for c in CITY_WORDS if c.lower() in entry.lower()
                 and c != "Philippines"), None)
    barangay = next((b for b in BARANGAYS if b.lower() in entry.lower()), None)
    road = None
    for r in ["MacArthur Highway", "Rizal Avenue", "Rizal Ave.",
              "Jose Abad Santos Avenue", "Samson Road", "Oroquieta",
              "Felix Huertas", "T Bugallon", "Tomas Mapua", "T. Mapua",
              "Quezon Blvd.", "Claro M. Recto"]:
        if r.lower() in entry.lower():
            road = r
            break
    head = entry.split(",")[0].strip()
    return head, city, barangay, road


def comparison_key(entry):
    """A loose key: same real place -> same key, regardless of direction."""
    s = strip_accents(entry).lower()
    s = s.split(",")[0]                      # landmark/intersection only
    for bad, good in ORDINAL_FIX.items():
        s = re.sub(r"\b%s\b" % bad, good, s)
    for bad, good in ALIAS_HINTS.items():
        s = s.replace(bad, good)
    s = re.sub(r"\(.*?\)", " ", s)           # drop "(near City Hall)"
    s = s.replace("intersection", " ").replace("interchange", " ")
    s = s.replace("street", "st").replace(" ave.", " ave").replace(" ave ", " ave ")
    s = re.sub(r"[^a-z0-9/ ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Treat "A / B" and "B / A" as the same junction.
    if "/" in s:
        parts = sorted(p.strip() for p in s.split("/") if p.strip())
        s = " / ".join(parts)
    return s


def suggested_query(entry, city):
    """What to send to Places Text Search first."""
    q = entry
    for bad, good in ORDINAL_FIX.items():
        q = re.sub(r"\b%s\b" % bad, good, q)
    q = re.sub(r"\s*\(.*?\)", "", q)         # parentheticals confuse search
    if "Philippines" not in q:
        q = q + ", Metro Manila, Philippines"
    return q.strip()


def build():
    rows = []
    for direction, raw in (("MALANDAY-RECTO", FORWARD_RAW),
                           ("RECTO-MALANDAY", RETURN_RAW)):
        for i, entry in enumerate(raw, 1):
            head, city, barangay, road = split_place(entry)
            rows.append({
                "direction": direction,
                "sequence": i,
                "source_name": entry,
                "landmark": head,
                "city": city,
                "barangay": barangay,
                "road_hint": road,
                "key": comparison_key(entry),
                "query": suggested_query(entry, city),
            })
    return rows


def main():
    rows = build()
    fwd = [r for r in rows if r["direction"] == "MALANDAY-RECTO"]
    ret = [r for r in rows if r["direction"] == "RECTO-MALANDAY"]

    print("=" * 72)
    print("RAW AND NORMALISED COUNTS")
    print("=" * 72)
    print("  %-18s %-8s %-12s %s" % ("direction", "raw", "normalised", "exact dupes"))
    for name, group in (("MALANDAY-RECTO", fwd), ("RECTO-MALANDAY", ret)):
        keys = [r["key"] for r in group]
        dupes = sum(c - 1 for c in Counter(keys).values() if c > 1)
        print("  %-18s %-8d %-12d %d" % (name, len(group), len(set(keys)), dupes))
    allkeys = [r["key"] for r in rows]
    print("  %-18s %-8d %-12d" % ("TOTAL", len(rows), len(set(allkeys))))

    print("\n" + "=" * 72)
    print("EXACT DUPLICATES WITHIN A DIRECTION")
    print("=" * 72)
    found = False
    for name, group in (("MALANDAY-RECTO", fwd), ("RECTO-MALANDAY", ret)):
        byk = defaultdict(list)
        for r in group:
            byk[r["key"]].append(r)
        for k, items in byk.items():
            if len(items) > 1:
                found = True
                print("  [%s] x%d  seq %s" % (name, len(items),
                                              [i["sequence"] for i in items]))
                for i in items:
                    print("      %s" % i["source_name"])
    if not found:
        print("  none")

    print("\n" + "=" * 72)
    print("SAME PLACE IN BOTH DIRECTIONS")
    print("=" * 72)
    fk = {r["key"] for r in fwd}
    rk = {r["key"] for r in ret}
    both = sorted(fk & rk)
    print("  shared keys: %d" % len(both))
    print("  forward only: %d" % len(fk - rk))
    print("  return only : %d" % len(rk - fk))

    print("\n  forward-only entries:")
    for r in sorted(fwd, key=lambda x: x["sequence"]):
        if r["key"] in fk - rk:
            print("    %2d  %s" % (r["sequence"], r["source_name"][:66]))
    print("\n  return-only entries:")
    for r in sorted(ret, key=lambda x: x["sequence"]):
        if r["key"] in rk - fk:
            print("    %2d  %s" % (r["sequence"], r["source_name"][:66]))

    print("\n" + "=" * 72)
    print("POSSIBLE ALIASES (manual review)")
    print("=" * 72)
    alias_pairs = [
        ("Hypermarket Monumento / Araneta Square / Araneta Square Mall / Monumento",
         "Four rows around the Monumento area; may be one, two or four stops."),
        ("Isetann / Recto LRT / Claro M. Recto",
         "Recto terminus cluster; Isetann is adjacent to Recto LRT."),
        ("Santos Encamacion Elementary School",
         "Likely 'Santos Encarnacion'; spelling to confirm against signage."),
        ("Parish Church or Isidro Labrador",
         "'or' is probably a transcription of 'of San Isidro Labrador'."),
        ("Jollibee vs Jollibee (near Governor Santiago Road)",
         "Return row adds a locator; may be the same branch or a second one."),
        ("Valenzuela City People's Park vs South Supermarket / Flying V Gas",
         "All three are 'near City Hall'; forward and return describe the "
         "same stretch with different landmarks."),
    ]
    for a, b in alias_pairs:
        print("  %s\n      %s" % (a, b))

    unique = {}
    for r in rows:
        unique.setdefault(r["key"], r)
    payload = {
        "raw_counts": {"MALANDAY-RECTO": len(fwd), "RECTO-MALANDAY": len(ret),
                       "total": len(rows)},
        "normalised_counts": {"MALANDAY-RECTO": len(fk), "RECTO-MALANDAY": len(rk),
                              "distinct_overall": len(set(allkeys))},
        "rows": rows,
        "unique_queries": [
            {"key": k, "query": v["query"], "city": v["city"],
             "road_hint": v["road_hint"], "example_source": v["source_name"]}
            for k, v in sorted(unique.items())
        ],
    }
    (OUT / "normalized.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print("\n  distinct places to research: %d" % len(unique))
    print("  written: %s" % (OUT / "normalized.json"))


if __name__ == "__main__":
    main()
