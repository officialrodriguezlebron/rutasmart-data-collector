"""Tests for the nearest-field-stop labelling of detected clusters.

Deterministic: no network, no database, no Google API key, no fixtures that
write anything. Covers the band arithmetic, the direction rule, every
"never force a label" exclusion, and regressions proving the manuscript's
evaluation data is untouched.
"""
import json
import math
from pathlib import Path

import pytest

from app.analytics import field_stop_match as fsm
from app.analytics.field_stop_match import (
    MATCH_M,
    REVIEW_M,
    STATUS_MATCHED,
    STATUS_NEEDS_REVIEW,
    STATUS_UNMATCHED,
    FieldStop,
    haversine_m,
    match_cluster,
    resolve_direction,
)

DATA_FILE = Path(fsm.__file__).resolve().parent.parent / "data" / "field_stops.json"
DIR_A = "MALANDAY-RECTO"
DIR_B = "RECTO-MALANDAY"


# ── helpers ───────────────────────────────────────────────────────────────────
def offset_north(lat, lon, metres):
    """A point `metres` due north — exact enough for band tests."""
    return lat + (metres / 6371008.8) * (180.0 / math.pi), lon


def stub(monkeypatch, stops_by_direction):
    monkeypatch.setattr(fsm, "_STOPS_BY_DIRECTION", stops_by_direction)


def mk(stop_id, lat, lon, direction=DIR_A, confidence="high", key=None):
    return FieldStop(
        stop_id=stop_id, display_name=stop_id, direction=direction,
        latitude=lat, longitude=lon, confidence=confidence,
        dedupe_key=key or stop_id.lower(),
    )


# ── 1. Haversine arithmetic ───────────────────────────────────────────────────
def test_haversine_zero_distance():
    assert haversine_m(14.70, 120.97, 14.70, 120.97) == pytest.approx(0.0, abs=1e-9)


@pytest.mark.parametrize("metres", [10.0, 75.0, 150.0, 631.0])
def test_haversine_matches_constructed_offset(metres):
    lat, lon = 14.70, 120.97
    lat2, lon2 = offset_north(lat, lon, metres)
    assert haversine_m(lat, lon, lat2, lon2) == pytest.approx(metres, abs=0.5)


def test_haversine_is_symmetric():
    a = haversine_m(14.6945, 120.9643, 14.7190, 120.9700)
    b = haversine_m(14.7190, 120.9700, 14.6945, 120.9643)
    assert a == pytest.approx(b, abs=1e-9)


# ── 2-6. Band arithmetic ──────────────────────────────────────────────────────
def test_cluster_exactly_on_a_field_stop_is_matched(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_MATCHED
    assert m.distance_m == pytest.approx(0.0, abs=0.2)
    assert m.stop_name == "S1"


def test_just_inside_match_band_is_matched(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    lat, lon = offset_north(14.70, 120.97, MATCH_M - 1.0)
    assert match_cluster(lat, lon, DIR_A).status == STATUS_MATCHED


def test_just_outside_match_band_needs_review(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    lat, lon = offset_north(14.70, 120.97, MATCH_M + 1.0)
    m = match_cluster(lat, lon, DIR_A)
    assert m.status == STATUS_NEEDS_REVIEW
    assert m.stop_name == "S1"          # the name is still shown, just flagged


def test_just_outside_review_band_is_unmatched(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    lat, lon = offset_north(14.70, 120.97, REVIEW_M + 1.0)
    m = match_cluster(lat, lon, DIR_A)
    assert m.status == STATUS_UNMATCHED
    assert m.stop_id is None
    assert m.stop_name is None          # no name is ever shown when unmatched


def test_band_boundaries_are_inclusive(monkeypatch):
    """MATCH_M and REVIEW_M belong to the tighter band. Asserted both ways."""
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})

    lat, lon = offset_north(14.70, 120.97, MATCH_M - 0.3)
    assert match_cluster(lat, lon, DIR_A).status == STATUS_MATCHED

    lat, lon = offset_north(14.70, 120.97, REVIEW_M - 0.3)
    assert match_cluster(lat, lon, DIR_A).status == STATUS_NEEDS_REVIEW

    lat, lon = offset_north(14.70, 120.97, REVIEW_M + 0.3)
    assert match_cluster(lat, lon, DIR_A).status == STATUS_UNMATCHED


def test_nearest_of_several_candidates_wins(monkeypatch):
    far_lat, far_lon = offset_north(14.70, 120.97, 300.0)
    stub(monkeypatch, {DIR_A: [mk("FAR", far_lat, far_lon), mk("NEAR", 14.70, 120.97)]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.stop_name == "NEAR"


# ── 7-8. Direction rule ───────────────────────────────────────────────────────
def test_opposite_direction_stop_is_never_considered(monkeypatch):
    """A stop reported only on the return leg cannot label a forward cluster."""
    stub(monkeypatch, {DIR_B: [mk("RETURN_ONLY", 14.70, 120.97, direction=DIR_B)]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_UNMATCHED
    assert m.stop_name is None


def test_mixed_selection_labels_nothing(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    m = match_cluster(14.70, 120.97, None)
    assert m.status == STATUS_UNMATCHED
    assert m.stop_name is None
    assert "Direction not determined" in m.reason


def test_resolve_direction():
    assert resolve_direction([DIR_A, DIR_A, DIR_A]) == DIR_A
    assert resolve_direction([DIR_A, DIR_B]) is None       # mixed -> no label
    assert resolve_direction([]) is None
    assert resolve_direction([None, None]) is None
    assert resolve_direction([DIR_A, None]) == DIR_A       # ignores missing


# ── 9-10. Ties ────────────────────────────────────────────────────────────────
def test_effectively_tied_candidates_are_not_asserted(monkeypatch):
    """Two distinct stops at the same spot: never force one as the label."""
    stub(monkeypatch, {DIR_A: [mk("A", 14.70, 120.97, key="a"),
                               mk("B", 14.70, 120.97, key="b")]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_NEEDS_REVIEW
    assert m.ambiguous is True
    assert m.alternative_stop_name is not None


def test_clearly_separated_candidates_are_not_ambiguous(monkeypatch):
    far_lat, far_lon = offset_north(14.70, 120.97, 300.0)
    stub(monkeypatch, {DIR_A: [mk("NEAR", 14.70, 120.97, key="n"),
                               mk("FAR", far_lat, far_lon, key="f")]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_MATCHED
    assert m.ambiguous is False
    assert m.alternative_stop_name is None


def test_tie_ratio_boundary(monkeypatch):
    """Runner-up at 2x the winner is not a tie; the absolute guard still holds."""
    a_lat, a_lon = offset_north(14.70, 120.97, 30.0)
    b_lat, b_lon = offset_north(14.70, 120.97, -60.0)
    stub(monkeypatch, {DIR_A: [mk("A", a_lat, a_lon, key="a"),
                               mk("B", b_lat, b_lon, key="b")]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_MATCHED
    assert m.ambiguous is False


# ── 11. Confidence gate ───────────────────────────────────────────────────────
def test_low_confidence_stop_is_never_matched(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("WEAK", 14.70, 120.97, confidence="low")]})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_NEEDS_REVIEW
    assert "low confidence" in m.reason


def test_medium_confidence_can_match(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("OK", 14.70, 120.97, confidence="medium")]})
    assert match_cluster(14.70, 120.97, DIR_A).status == STATUS_MATCHED


# ── 12. Degenerate input ──────────────────────────────────────────────────────
@pytest.mark.parametrize("lat,lon", [
    (None, 120.97), (14.70, None), (float("nan"), 120.97), (14.70, float("inf")),
])
def test_bad_centroid_is_unmatched_not_an_error(monkeypatch, lat, lon):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    m = match_cluster(lat, lon, DIR_A)
    assert m.status == STATUS_UNMATCHED
    assert m.stop_name is None


def test_empty_dataset_is_unmatched_not_an_error(monkeypatch):
    stub(monkeypatch, {})
    m = match_cluster(14.70, 120.97, DIR_A)
    assert m.status == STATUS_UNMATCHED


def test_matcher_is_pure(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    a = match_cluster(14.7005, 120.9701, DIR_A).to_dict()
    b = match_cluster(14.7005, 120.9701, DIR_A).to_dict()
    assert a == b


# ── 13-16. Dataset integrity ──────────────────────────────────────────────────
def test_dataset_file_exists_and_parses():
    assert DATA_FILE.exists(), "app/data/field_stops.json is missing"
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    assert payload["dataset"] == "field_reported_stops"
    assert payload["stops"]


def test_every_record_is_field_reported():
    """Nothing in this dataset may claim to be verified."""
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    assert {r["status"] for r in payload["stops"]} == {"field_reported"}


def test_eligible_records_have_finite_coords_in_the_corridor_envelope():
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    for r in payload["stops"]:
        if not r["eligible_for_matching"]:
            continue
        assert math.isfinite(r["latitude"]) and math.isfinite(r["longitude"])
        assert 14.59 <= r["latitude"] <= 14.73, r["stop_id"]
        assert 120.94 <= r["longitude"] <= 121.00, r["stop_id"]


def test_ineligible_records_carry_a_reason():
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    for r in payload["stops"]:
        if not r["eligible_for_matching"]:
            assert r["ineligible_reasons"], r["stop_id"]


def test_excluded_categories_are_not_loaded_as_candidates():
    """Unresolved, route-order-conflicted, ambiguous and off-corridor stops
    must never appear as a matching candidate."""
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    excluded_ids = {r["stop_id"] for r in payload["stops"]
                    if not r["eligible_for_matching"]}
    loaded_ids = {s.stop_id
                  for stops in fsm._load().values()
                  for s in stops}
    assert not (excluded_ids & loaded_ids)


def test_unresolved_rows_are_never_matched_at_zero_distance():
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    unresolved = [r for r in payload["stops"] if r["latitude"] is None]
    assert unresolved, "expected the 4 unresolved research rows"
    for r in unresolved:
        assert not r["eligible_for_matching"]


def test_loaded_candidates_are_deduplicated_within_a_direction():
    """A landmark reported twice on one leg must not tie with itself at 0 m."""
    for direction, stops in fsm._load().items():
        keys = [s.dedupe_key for s in stops]
        assert len(keys) == len(set(keys)), direction


# ── 17. Regression: the evaluation data is untouched ──────────────────────────
def test_ground_truth_stops_still_has_exactly_70_entries():
    """Guards the manuscript's evaluation input against accidental edits.

    Recall, precision and F1 are computed from this list. This feature must
    never change it.
    """
    from app.analytics.cluster_evaluation import GROUND_TRUTH_STOPS
    assert len(GROUND_TRUTH_STOPS) == 70


def test_field_stop_module_does_not_import_the_evaluation_ground_truth():
    source = Path(fsm.__file__).read_text(encoding="utf-8")
    assert "GROUND_TRUTH_STOPS" not in source.replace("GROUND_TRUTH_STOPS / cluster", "")
    assert "cluster_evaluation" not in source.split('"""', 2)[-1]


def test_field_stop_module_makes_no_network_call():
    source = Path(fsm.__file__).read_text(encoding="utf-8")
    for forbidden in ("urllib", "requests", "httpx", "socket",
                      "googleapis", "places:searchText"):
        assert forbidden not in source, forbidden


def test_stop_cluster_out_defaults_field_stop_match_to_none():
    """An existing response that supplies no label must be unchanged."""
    from app.analytics.schemas import StopClusterOut
    c = StopClusterOut(
        cluster_id=0, centroid_lat=14.70, centroid_lon=120.97, point_count=10,
        avg_occupancy=12.0, max_occupancy=20, demand_tier="Normal",
        peak_period="Midday", load_factor_pct=46.2, noise_ratio_pct=1.0,
    )
    assert c.field_stop_match is None
    assert "field_stop_match" in c.model_dump()


def test_attaching_a_label_leaves_every_original_cluster_field_unchanged():
    from app.analytics.schemas import StopClusterOut, FieldStopMatchOut
    base = dict(
        cluster_id=3, centroid_lat=14.70, centroid_lon=120.97, point_count=42,
        avg_occupancy=18.5, max_occupancy=33, demand_tier="High",
        peak_period="Morning Peak", load_factor_pct=71.2, noise_ratio_pct=2.5,
        avg_velocity_ms=0.12, cluster_type="TRUE_STOP",
    )
    before = StopClusterOut(**base).model_dump()
    after = StopClusterOut(**base)
    after.field_stop_match = FieldStopMatchOut(status="matched", stop_name="X",
                                               distance_m=42.0)
    after_dump = after.model_dump()
    for k, v in before.items():
        if k == "field_stop_match":
            continue
        assert after_dump[k] == v, k


# ── 18. Contested stops: one stop, several clusters ──────────────────────────
def test_only_the_nearest_cluster_may_assert_a_stop(monkeypatch):
    """Two hotspots cannot both BE the same field stop.

    This is the mirror of the tie rule: there one cluster had two candidate
    stops, here one stop has two candidate clusters.
    """
    stub(monkeypatch, {DIR_A: [mk("SHARED", 14.70, 120.97)]})
    near_lat, near_lon = offset_north(14.70, 120.97, 20.0)
    far_lat, far_lon = offset_north(14.70, 120.97, 60.0)

    matches = fsm.match_clusters(
        [type("C", (), {"centroid_lat": far_lat, "centroid_lon": far_lon})(),
         type("C", (), {"centroid_lat": near_lat, "centroid_lon": near_lon})()],
        DIR_A,
    )
    far, near = matches
    assert near.status == STATUS_MATCHED
    assert near.contested is False
    assert far.status == STATUS_NEEDS_REVIEW
    assert far.contested is True
    assert far.stop_name == "SHARED"        # name kept for the reviewer
    assert "closer to this field stop" in far.reason


def test_single_claim_is_not_contested(monkeypatch):
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    matches = fsm.match_clusters(
        [type("C", (), {"centroid_lat": 14.70, "centroid_lon": 120.97})()], DIR_A)
    assert matches[0].status == STATUS_MATCHED
    assert matches[0].contested is False


def test_unmatched_clusters_never_contest(monkeypatch):
    """Two unmatched clusters carry no stop_id, so nothing is contested."""
    stub(monkeypatch, {DIR_A: [mk("S1", 14.70, 120.97)]})
    a_lat, a_lon = offset_north(14.70, 120.97, 500.0)
    b_lat, b_lon = offset_north(14.70, 120.97, 600.0)
    matches = fsm.match_clusters(
        [type("C", (), {"centroid_lat": a_lat, "centroid_lon": a_lon})(),
         type("C", (), {"centroid_lat": b_lat, "centroid_lon": b_lon})()],
        DIR_A,
    )
    assert all(m.status == STATUS_UNMATCHED for m in matches)
    assert all(m.contested is False for m in matches)


def test_resolve_contested_is_order_independent(monkeypatch):
    """Whichever order the clusters arrive in, the nearest one wins."""
    stub(monkeypatch, {DIR_A: [mk("SHARED", 14.70, 120.97)]})
    near = offset_north(14.70, 120.97, 20.0)
    far = offset_north(14.70, 120.97, 60.0)

    def run(order):
        return fsm.match_clusters(
            [type("C", (), {"centroid_lat": la, "centroid_lon": lo})()
             for la, lo in order], DIR_A)

    a = {round(m.distance_m): m.status for m in run([near, far])}
    b = {round(m.distance_m): m.status for m in run([far, near])}
    assert a == b
    assert a[20] == STATUS_MATCHED
    assert a[60] == STATUS_NEEDS_REVIEW


def test_contested_defaults_false_on_the_schema():
    from app.analytics.schemas import FieldStopMatchOut
    assert FieldStopMatchOut(status="unmatched").contested is False
