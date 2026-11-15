"""Label a detected cluster with the nearest field-reported stop.

This is a SECOND, SEPARATE labelling path. It does not touch, read or alter:

  * GROUND_TRUTH_STOPS / cluster_evaluation.py  (the 70-stop evaluation data)
  * recall, precision, F1 or any Evaluation figure
  * published passenger zones (stop_zones) or _nearest_gt_banded()
  * any existing cluster metric

It only adds an optional `field_stop_match` object alongside the untouched
cluster fields.

Data source
-----------
app/data/field_stops.json, built offline by research/field_stops/build_dataset.py
from Google Places results captured during research. **No Google API call is
made at runtime.** The file is read once at import and never written.

Eligibility
-----------
The dataset precomputes `eligible_for_matching`. A stop is excluded when it is
unresolved, conflicts with the reported route order, shares a Google place id
with a different reported place, or sits outside the corridor. Those stops are
never used as a label, so a wrong pin cannot become a confident label.

Status bands
------------
    <= MATCH_M (75 m)    matched       - only if confidence is high/medium and
                                         no effective tie with another stop
    <= REVIEW_M (150 m)  needs_review  - also where a <=75 m candidate is
                                         low-confidence or tied
    >  REVIEW_M          unmatched     - no name is shown at all

Pure function: same input, same output. No database session, no network.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

# ── Thresholds ────────────────────────────────────────────────────────────────
# Configurable because the research report recommends them from only 11
# clusters and expects them to be revisited as more trips are collected.
def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    try:
        v = float(raw)
        return v if v > 0 else default
    except ValueError:
        return default


MATCH_M = _env_float("FIELD_STOP_MATCH_M", 75.0)
REVIEW_M = _env_float("FIELD_STOP_REVIEW_M", 150.0)

# Two candidates are "effectively tied" when the runner-up is within this
# ratio of the winner, or within this many metres of it. Either one makes the
# nearest-stop choice arbitrary, so the match is not asserted.
TIE_RATIO = 1.25
TIE_ABS_M = 10.0

# A low-confidence Google result is never promoted to `matched`.
CONFIDENT = ("high", "medium")

STATUS_MATCHED = "matched"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_UNMATCHED = "unmatched"

_DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "field_stops.json"


# ── Dataset ───────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class FieldStop:
    stop_id: str
    display_name: str
    direction: str
    latitude: float
    longitude: float
    confidence: str
    dedupe_key: str


def _load() -> Dict[str, List[FieldStop]]:
    """Read the dataset once and index eligible stops by direction.

    Within a direction the same real place can be reported more than once
    (the field notes repeat a few landmarks). Those rows share a dedupe_key
    and collapse to one candidate, so a duplicated report cannot create a
    0 m tie with itself. The best confidence wins, then the lowest sequence
    for determinism.
    """
    if not _DATA_FILE.exists():
        return {}

    try:
        payload = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    rank = {"high": 0, "medium": 1, "low": 2, "unresolved": 3}
    best: Dict[tuple, dict] = {}

    for r in payload.get("stops", []):
        if not r.get("eligible_for_matching"):
            continue
        lat, lon = r.get("latitude"), r.get("longitude")
        if lat is None or lon is None:
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue

        slot = (r["direction"], r["dedupe_key"])
        prev = best.get(slot)
        key = (rank.get(r.get("confidence"), 9), r.get("route_sequence", 0))
        if prev is None or key < prev["_key"]:
            best[slot] = {"_key": key, "row": r}

    out: Dict[str, List[FieldStop]] = {}
    for (direction, _), v in best.items():
        r = v["row"]
        out.setdefault(direction, []).append(FieldStop(
            stop_id=r["stop_id"],
            display_name=r["display_name"],
            direction=direction,
            latitude=float(r["latitude"]),
            longitude=float(r["longitude"]),
            confidence=r.get("confidence") or "unresolved",
            dedupe_key=r["dedupe_key"],
        ))
    for direction in out:
        out[direction].sort(key=lambda s: s.stop_id)
    return out


_STOPS_BY_DIRECTION: Dict[str, List[FieldStop]] = _load()


def available_directions() -> List[str]:
    return sorted(_STOPS_BY_DIRECTION.keys())


def eligible_count(direction: Optional[str] = None) -> int:
    if direction is None:
        return sum(len(v) for v in _STOPS_BY_DIRECTION.values())
    return len(_STOPS_BY_DIRECTION.get(direction, ()))


# ── Result ────────────────────────────────────────────────────────────────────
@dataclass
class FieldStopMatch:
    """Additive label for one cluster. Never replaces a cluster field."""
    status: str                            # matched | needs_review | unmatched
    stop_id: Optional[str] = None
    stop_name: Optional[str] = None
    distance_m: Optional[float] = None
    direction: Optional[str] = None
    confidence: Optional[str] = None
    ambiguous: bool = False
    alternative_stop_name: Optional[str] = None
    contested: bool = False
    reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (mean Earth radius, IUGG)."""
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def match_cluster(
    centroid_lat: float,
    centroid_lon: float,
    direction: Optional[str],
) -> FieldStopMatch:
    """Nearest eligible field stop in the SAME direction, or an unmatched result.

    `direction` must name one concrete direction. A mixed or unknown selection
    cannot be attributed to one side of the corridor, so nothing is labelled
    rather than guessing across both.
    """
    if centroid_lat is None or centroid_lon is None:
        return FieldStopMatch(status=STATUS_UNMATCHED,
                              reason="Cluster has no centroid")
    if not (math.isfinite(centroid_lat) and math.isfinite(centroid_lon)):
        return FieldStopMatch(status=STATUS_UNMATCHED,
                              reason="Cluster centroid is not a finite coordinate")

    if not direction or direction not in _STOPS_BY_DIRECTION:
        return FieldStopMatch(
            status=STATUS_UNMATCHED,
            direction=direction,
            reason=("No field stops for this direction"
                    if direction else
                    "Direction not determined for this selection"),
        )

    candidates = _STOPS_BY_DIRECTION[direction]
    if not candidates:
        return FieldStopMatch(status=STATUS_UNMATCHED, direction=direction,
                              reason="No eligible field stops for this direction")

    ranked = sorted(
        ((haversine_m(centroid_lat, centroid_lon, s.latitude, s.longitude), s)
         for s in candidates),
        key=lambda t: (t[0], t[1].stop_id),
    )
    d0, best = ranked[0]
    d1, runner = (ranked[1] if len(ranked) > 1 else (float("inf"), None))

    # Beyond the review band nothing is named at all.
    if d0 > REVIEW_M:
        return FieldStopMatch(
            status=STATUS_UNMATCHED,
            direction=direction,
            distance_m=round(d0, 1),
            reason="Nearest field stop is %.0f m away, beyond the %.0f m limit"
                   % (d0, REVIEW_M),
        )

    tied = runner is not None and (d1 <= d0 * TIE_RATIO or (d1 - d0) <= TIE_ABS_M)
    confident = best.confidence in CONFIDENT

    if d0 <= MATCH_M and confident and not tied:
        status = STATUS_MATCHED
        reason = "Within %.0f m of a %s-confidence field stop" % (MATCH_M, best.confidence)
    else:
        status = STATUS_NEEDS_REVIEW
        if d0 > MATCH_M:
            reason = "%.0f m away, inside the %.0f-%.0f m review band" % (d0, MATCH_M, REVIEW_M)
        elif not confident:
            reason = "Within %.0f m but the field stop is %s confidence" % (MATCH_M, best.confidence)
        else:
            reason = ("Two field stops are effectively tied (%.0f m and %.0f m)"
                      % (d0, d1))

    return FieldStopMatch(
        status=status,
        stop_id=best.stop_id,
        stop_name=best.display_name,
        distance_m=round(d0, 1),
        direction=direction,
        confidence=best.confidence,
        ambiguous=tied,
        alternative_stop_name=(runner.display_name if tied and runner else None),
        reason=reason,
    )


def resolve_contested(matches: List[FieldStopMatch]) -> List[FieldStopMatch]:
    """Only the nearest cluster may assert a given field stop.

    `matched` claims that a hotspot *is* a particular stop, so two hotspots in
    the same run cannot both be matched to it — one of them is a different
    place that happens to sit nearby. This is the mirror image of the tie rule:
    there, one cluster had two candidate stops; here, one stop has two
    candidate clusters. Either way the label is not forced.

    The nearest keeps its status. The rest drop to `needs_review`, keep the
    name so a reviewer can see what was proposed, and say why. Mutates and
    returns the list in place.
    """
    by_stop: Dict[str, List[int]] = {}
    for i, m in enumerate(matches):
        if m.stop_id and m.status != STATUS_UNMATCHED:
            by_stop.setdefault(m.stop_id, []).append(i)

    for idxs in by_stop.values():
        if len(idxs) < 2:
            continue
        idxs.sort(key=lambda i: (matches[i].distance_m if matches[i].distance_m
                                 is not None else float("inf"), i))
        nearest = matches[idxs[0]]
        for i in idxs[1:]:
            m = matches[i]
            m.contested = True
            m.status = STATUS_NEEDS_REVIEW
            m.reason = ("Another detected hotspot is closer to this field stop "
                        "(%.0f m)" % nearest.distance_m
                        if nearest.distance_m is not None else
                        "Another detected hotspot is closer to this field stop")
    return matches


def match_clusters(clusters, direction: Optional[str]) -> List[FieldStopMatch]:
    """Label an iterable of StopCluster dataclasses, contests resolved."""
    return resolve_contested(
        [match_cluster(c.centroid_lat, c.centroid_lon, direction)
         for c in clusters]
    )


def resolve_direction(directions) -> Optional[str]:
    """One direction if the whole selection agrees, otherwise None.

    A merged run over both directions has no single direction, and the rules
    forbid comparing a cluster against the opposite direction's stops.
    """
    distinct = {d for d in directions if d}
    return distinct.pop() if len(distinct) == 1 else None
