"""
Tests for app/security.py — HMAC-signed session tokens.

These tests never touch the database and never read the developer's .env.
``app.security`` resolves its signing secret once at import time, so every test
here overrides the module-level ``_SECRET`` through the ``signing_secret``
fixture. ``_sign`` reads that global at call time, so the override takes effect
without reloading the module.

Time is controlled the same way where a boundary matters: ``app.security``
calls ``time.time()``, so ``frozen_time`` patches it rather than sleeping,
keeping the suite deterministic and fast.
"""
import base64

import pytest

from app import security
from app.security import (
    TOKEN_TTL_SECONDS,
    TokenExpired,
    TokenInvalid,
    create_token,
    try_verify_token,
    verify_token,
)

pytestmark = pytest.mark.unit

TEST_SECRET = "unit-test-signing-secret-not-used-anywhere-else"


@pytest.fixture(autouse=True)
def signing_secret(monkeypatch):
    """Pin the signing secret for every test in this module.

    autouse so no test can accidentally depend on RUTASMART_TOKEN_SECRET, on
    the per-process development fallback, or on the developer's .env.
    """
    monkeypatch.setattr(security, "_SECRET", TEST_SECRET)
    return TEST_SECRET


@pytest.fixture
def frozen_time(monkeypatch):
    """Pin time.time() inside app.security to a fixed instant."""
    def _freeze(value):
        monkeypatch.setattr(security.time, "time", lambda: value)
        return value
    return _freeze


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_payload(token: str) -> str:
    payload = token.split(".")[0]
    return base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode()


def _resign(payload_text: str) -> str:
    """Build a correctly signed token straight from payload text."""
    payload_b64 = _b64url(payload_text.encode())
    return f"{payload_b64}.{security._sign(payload_b64)}"


# ── Creation and successful verification ─────────────────────────────────────

def test_token_has_payload_and_signature_separated_by_one_dot():
    token = create_token("USR-001", "ADMIN", "A. Santos")
    assert isinstance(token, str)
    assert token.count(".") == 1
    payload, signature = token.split(".")
    assert payload and signature


def test_token_payload_is_base64url_decodable():
    token = create_token("USR-001", "ADMIN", "A. Santos")
    assert _decode_payload(token).startswith("USR-001:ADMIN:A. Santos:")


def test_user_id_round_trips():
    assert verify_token(create_token("USR-001", "ADMIN", "A. Santos")).user_id == "USR-001"


def test_role_round_trips():
    assert verify_token(create_token("USR-003", "CONDUCTOR", "J. dela Cruz")).role == "CONDUCTOR"


def test_display_name_round_trips():
    payload = verify_token(create_token("USR-003", "CONDUCTOR", "J. dela Cruz"))
    assert payload.display_name == "J. dela Cruz"


def test_issued_at_and_expires_at_are_integers():
    payload = verify_token(create_token("USR-001", "ADMIN", "A. Santos"))
    assert isinstance(payload.issued_at, int)
    assert isinstance(payload.expires_at, int)


def test_expiry_is_issued_at_plus_default_ttl():
    payload = verify_token(create_token("USR-001", "ADMIN", "A. Santos"))
    assert payload.expires_at - payload.issued_at == TOKEN_TTL_SECONDS


def test_default_ttl_is_twelve_hours():
    assert TOKEN_TTL_SECONDS == 12 * 60 * 60


# ── Expiry ───────────────────────────────────────────────────────────────────

def test_already_expired_token_raises_token_expired():
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=-1)
    with pytest.raises(TokenExpired):
        verify_token(token)


def test_token_is_valid_one_second_before_expiry(frozen_time):
    frozen_time(1_000_000)
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=60)
    frozen_time(1_000_059)
    assert verify_token(token).user_id == "USR-001"


def test_token_is_rejected_exactly_at_expiry(frozen_time):
    """Expiry is inclusive: at expires_at the token is already dead."""
    frozen_time(1_000_000)
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=60)
    frozen_time(1_000_060)
    with pytest.raises(TokenExpired):
        verify_token(token)


def test_token_is_rejected_long_after_expiry(frozen_time):
    frozen_time(1_000_000)
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=60)
    frozen_time(2_000_000)
    with pytest.raises(TokenExpired):
        verify_token(token)


# ── Tampering ────────────────────────────────────────────────────────────────

def test_flipped_signature_is_rejected():
    payload, signature = create_token("USR-001", "ADMIN", "A. Santos").split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    with pytest.raises(TokenInvalid):
        verify_token(f"{payload}.{flipped}")


def test_truncated_signature_is_rejected():
    payload, signature = create_token("USR-001", "ADMIN", "A. Santos").split(".")
    with pytest.raises(TokenInvalid):
        verify_token(f"{payload}.{signature[:-4]}")


def test_token_without_signature_is_rejected():
    payload = create_token("USR-001", "ADMIN", "A. Santos").split(".")[0]
    with pytest.raises(TokenInvalid):
        verify_token(payload)


def test_token_with_empty_signature_is_rejected():
    payload = create_token("USR-001", "ADMIN", "A. Santos").split(".")[0]
    with pytest.raises(TokenInvalid):
        verify_token(f"{payload}.")


def test_swapped_payload_with_valid_signature_is_rejected():
    """The classic forgery: keep a real signature, replace the payload."""
    _, signature = create_token("USR-003", "CONDUCTOR", "J. dela Cruz").split(".")
    forged_payload = _b64url(b"USR-001:ADMIN:A. Santos:0:9999999999")
    with pytest.raises(TokenInvalid):
        verify_token(f"{forged_payload}.{signature}")


def test_garbage_string_is_rejected():
    with pytest.raises(TokenInvalid):
        verify_token("not-a-token")


def test_empty_token_is_rejected():
    with pytest.raises(TokenInvalid):
        verify_token("")


def test_non_string_token_is_rejected():
    with pytest.raises(TokenInvalid):
        verify_token(None)


def test_payload_with_too_few_fields_is_rejected():
    with pytest.raises(TokenInvalid):
        verify_token(_resign("USR-001:ADMIN"))


def test_non_integer_timestamps_are_rejected():
    with pytest.raises(TokenInvalid):
        verify_token(_resign("USR-001:ADMIN:A. Santos:not-a-time:also-not"))


# ── Role escalation ──────────────────────────────────────────────────────────

def test_role_escalation_conductor_to_admin_is_rejected():
    """Rewriting the role while keeping the original signature must fail."""
    token = create_token("USR-003", "CONDUCTOR", "J. dela Cruz")
    payload_text = _decode_payload(token)
    signature = token.split(".")[1]
    escalated = _b64url(payload_text.replace("CONDUCTOR", "ADMIN").encode())
    with pytest.raises(TokenInvalid):
        verify_token(f"{escalated}.{signature}")


def test_role_escalation_fails_as_invalid_not_expired():
    """A forged token must not be reported as merely expired."""
    token = create_token("USR-003", "CONDUCTOR", "J. dela Cruz")
    payload_text = _decode_payload(token)
    signature = token.split(".")[1]
    escalated = _b64url(payload_text.replace("CONDUCTOR", "ADMIN").encode())
    with pytest.raises(TokenInvalid):
        verify_token(f"{escalated}.{signature}")


def test_extending_expiry_is_rejected():
    """Pushing expires_at into the future invalidates the signature."""
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=-1)
    payload_text = _decode_payload(token)
    head, _, _ = payload_text.rpartition(":")
    signature = token.split(".")[1]
    extended = _b64url(f"{head}:9999999999".encode())
    with pytest.raises(TokenInvalid):
        verify_token(f"{extended}.{signature}")


# ── Legacy unsigned tokens ───────────────────────────────────────────────────

def test_legacy_unsigned_base64_token_is_rejected():
    """The pre-Phase-3A format: base64(user:role:name:ts), no signature."""
    legacy = base64.b64encode(b"USR-001:ADMIN:A. Santos:1793797772").decode()
    with pytest.raises(TokenInvalid):
        verify_token(legacy)


def test_legacy_token_with_appended_dot_is_rejected():
    legacy = base64.b64encode(b"USR-001:ADMIN:A. Santos:1793797772").decode()
    with pytest.raises(TokenInvalid):
        verify_token(f"{legacy}.")


def test_legacy_token_with_fabricated_signature_is_rejected():
    legacy = base64.b64encode(b"USR-001:ADMIN:A. Santos:1793797772").decode()
    with pytest.raises(TokenInvalid):
        verify_token(f"{legacy}.{_b64url(b'pretend-signature')}")


# ── Secret isolation ─────────────────────────────────────────────────────────

def test_token_signed_with_another_secret_is_rejected(monkeypatch):
    token = create_token("USR-001", "ADMIN", "A. Santos")
    monkeypatch.setattr(security, "_SECRET", "a-completely-different-secret")
    with pytest.raises(TokenInvalid):
        verify_token(token)


def test_token_verifies_again_once_the_original_secret_is_restored(monkeypatch):
    token = create_token("USR-001", "ADMIN", "A. Santos")
    monkeypatch.setattr(security, "_SECRET", "a-completely-different-secret")
    assert try_verify_token(token) is None
    monkeypatch.setattr(security, "_SECRET", TEST_SECRET)
    assert verify_token(token).user_id == "USR-001"


def test_same_payload_under_different_secrets_yields_different_signatures(monkeypatch, frozen_time):
    frozen_time(1_000_000)
    first = create_token("USR-001", "ADMIN", "A. Santos")
    monkeypatch.setattr(security, "_SECRET", "a-completely-different-secret")
    second = create_token("USR-001", "ADMIN", "A. Santos")
    assert first.split(".")[0] == second.split(".")[0]      # identical payload
    assert first.split(".")[1] != second.split(".")[1]      # different signature


def test_signature_is_deterministic_for_the_same_secret_and_payload(frozen_time):
    frozen_time(1_000_000)
    assert create_token("USR-001", "ADMIN", "A. Santos") == \
           create_token("USR-001", "ADMIN", "A. Santos")


# ── Display names containing colons ──────────────────────────────────────────

def test_display_name_with_one_colon_round_trips():
    payload = verify_token(create_token("USR-009", "CONDUCTOR", "Cruz: J. dela"))
    assert payload.display_name == "Cruz: J. dela"
    assert payload.role == "CONDUCTOR"
    assert payload.user_id == "USR-009"


def test_display_name_with_several_colons_round_trips():
    name = "a:b:c:d"
    payload = verify_token(create_token("USR-010", "ADMIN", name))
    assert payload.display_name == name
    assert payload.expires_at > payload.issued_at


def test_empty_display_name_round_trips():
    assert verify_token(create_token("USR-011", "ADMIN", "")).display_name == ""


# ── try_verify_token ─────────────────────────────────────────────────────────

def test_try_verify_returns_payload_for_a_valid_token():
    assert try_verify_token(create_token("USR-001", "ADMIN", "A. Santos")).role == "ADMIN"


def test_try_verify_returns_none_for_a_tampered_token():
    payload, signature = create_token("USR-001", "ADMIN", "A. Santos").split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    assert try_verify_token(f"{payload}.{flipped}") is None


def test_try_verify_returns_none_for_an_expired_token():
    assert try_verify_token(create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=-1)) is None


def test_try_verify_returns_none_for_empty_and_none_input():
    assert try_verify_token("") is None
    assert try_verify_token(None) is None
