"""
Tests for the FastAPI auth dependencies in app/security.py.

These exercise get_current_user and require_role as plain callables rather
than through a TestClient: both are ordinary functions, so calling them
directly keeps the tests fast and free of any app or database import.

The signing secret is pinned by an autouse fixture, exactly as in
test_tokens.py, so nothing here depends on RUTASMART_TOKEN_SECRET, on the
per-process development fallback, or on the developer's .env.

STATUS REMINDER: these dependencies are attached to no endpoint yet. These
tests lock in their contract before enforcement is switched on.
"""
import base64

import pytest
from fastapi import HTTPException

from app import security
from app.security import (
    TokenPayload,
    create_token,
    get_current_user,
    require_role,
)

pytestmark = pytest.mark.unit

TEST_SECRET = "auth-dependency-test-secret-not-used-anywhere-else"


@pytest.fixture(autouse=True)
def signing_secret(monkeypatch):
    monkeypatch.setattr(security, "_SECRET", TEST_SECRET)
    return TEST_SECRET


@pytest.fixture
def frozen_time(monkeypatch):
    def _freeze(value):
        monkeypatch.setattr(security.time, "time", lambda: value)
        return value
    return _freeze


def bearer(token):
    return f"Bearer {token}"


def admin_token():
    return create_token("USR-001", "ADMIN", "A. Santos")


def conductor_token():
    return create_token("USR-003", "CONDUCTOR", "J. dela Cruz")


def analyst_token():
    return create_token("USR-002", "ANALYST", "M. Reyes")


# ── Missing Authorization header ─────────────────────────────────────────────

def test_missing_authorization_header_is_401():
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=None)
    assert exc.value.status_code == 401


def test_missing_authorization_header_sets_www_authenticate():
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=None)
    assert exc.value.headers.get("WWW-Authenticate") == "Bearer"


def test_empty_authorization_header_is_401():
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization="")
    assert exc.value.status_code == 401


# ── Malformed Bearer header ──────────────────────────────────────────────────

@pytest.mark.parametrize("header", [
    "token-with-no-scheme",
    "Basic dXNlcjpwYXNz",
    "Bearer",
    "Bearer ",
    "Bearer    ",
])
def test_malformed_authorization_header_is_401(header):
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=header)
    assert exc.value.status_code == 401


def test_bearer_scheme_is_case_insensitive():
    """RFC 7235 makes the scheme case-insensitive; a real client may send 'bearer'."""
    payload = get_current_user(authorization="bearer " + admin_token())
    assert payload.role == "ADMIN"


def test_surrounding_whitespace_in_token_is_tolerated():
    assert get_current_user(authorization=bearer(admin_token() + "  ")).role == "ADMIN"


# ── Invalid token ────────────────────────────────────────────────────────────

def test_garbage_token_is_401():
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer("not-a-real-token"))
    assert exc.value.status_code == 401


def test_tampered_token_is_401():
    token = conductor_token()
    payload_b64, signature = token.split(".")
    raw = base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)).decode()
    escalated = base64.urlsafe_b64encode(
        raw.replace("CONDUCTOR", "ADMIN").encode()).decode().rstrip("=")
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(f"{escalated}.{signature}"))
    assert exc.value.status_code == 401


def test_legacy_unsigned_token_is_401():
    legacy = base64.b64encode(b"USR-001:ADMIN:A. Santos:1793797772").decode()
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(legacy))
    assert exc.value.status_code == 401


def test_token_signed_with_another_secret_is_401(monkeypatch):
    token = admin_token()
    monkeypatch.setattr(security, "_SECRET", "a-completely-different-secret")
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(token))
    assert exc.value.status_code == 401


# ── Expired token ────────────────────────────────────────────────────────────

def test_expired_token_is_401():
    expired = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=-1)
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(expired))
    assert exc.value.status_code == 401


def test_expired_token_detail_tells_the_user_to_sign_in_again():
    """Distinct from a forged token, so the client can react appropriately."""
    expired = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=-1)
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(expired))
    assert "expired" in exc.value.detail.lower()


def test_token_valid_before_expiry_then_401_after(frozen_time):
    frozen_time(1_000_000)
    token = create_token("USR-001", "ADMIN", "A. Santos", ttl_seconds=60)
    frozen_time(1_000_059)
    assert get_current_user(authorization=bearer(token)).user_id == "USR-001"
    frozen_time(1_000_060)
    with pytest.raises(HTTPException) as exc:
        get_current_user(authorization=bearer(token))
    assert exc.value.status_code == 401


# ── Valid tokens authenticate ────────────────────────────────────────────────

def test_valid_admin_token_authenticates():
    payload = get_current_user(authorization=bearer(admin_token()))
    assert (payload.user_id, payload.role) == ("USR-001", "ADMIN")


def test_valid_conductor_token_authenticates():
    payload = get_current_user(authorization=bearer(conductor_token()))
    assert (payload.user_id, payload.role) == ("USR-003", "CONDUCTOR")


def test_valid_analyst_token_authenticates():
    """ANALYST is a real role: it authenticates, it just gets no access."""
    payload = get_current_user(authorization=bearer(analyst_token()))
    assert (payload.user_id, payload.role) == ("USR-002", "ANALYST")


# ── require_role: permitted ──────────────────────────────────────────────────

def test_admin_passes_admin_only_dependency():
    user = get_current_user(authorization=bearer(admin_token()))
    assert require_role("ADMIN")(user=user) is user


def test_conductor_passes_conductor_or_admin_dependency():
    """The shape POST /admin/clean-stale-trips will need."""
    user = get_current_user(authorization=bearer(conductor_token()))
    assert require_role("CONDUCTOR", "ADMIN")(user=user) is user


def test_admin_also_passes_conductor_or_admin_dependency():
    user = get_current_user(authorization=bearer(admin_token()))
    assert require_role("CONDUCTOR", "ADMIN")(user=user) is user


def test_role_matching_is_case_insensitive():
    user = get_current_user(authorization=bearer(admin_token()))
    assert require_role("admin")(user=user) is user


# ── require_role: rejected ───────────────────────────────────────────────────

def test_conductor_is_403_on_admin_only_dependency():
    """Insufficient role is 403, not 401: re-authenticating would not help."""
    user = get_current_user(authorization=bearer(conductor_token()))
    with pytest.raises(HTTPException) as exc:
        require_role("ADMIN")(user=user)
    assert exc.value.status_code == 403


def test_analyst_is_403_on_admin_only_dependency():
    user = get_current_user(authorization=bearer(analyst_token()))
    with pytest.raises(HTTPException) as exc:
        require_role("ADMIN")(user=user)
    assert exc.value.status_code == 403


def test_analyst_is_403_on_conductor_or_admin_dependency():
    """Phase 4b decision: ANALYST receives no access anywhere."""
    user = get_current_user(authorization=bearer(analyst_token()))
    with pytest.raises(HTTPException) as exc:
        require_role("CONDUCTOR", "ADMIN")(user=user)
    assert exc.value.status_code == 403


def test_analyst_is_403_even_on_a_conductor_only_dependency():
    user = get_current_user(authorization=bearer(analyst_token()))
    with pytest.raises(HTTPException) as exc:
        require_role("CONDUCTOR")(user=user)
    assert exc.value.status_code == 403


def test_insufficient_role_is_not_401():
    """A 403 must not look like an expired session to the frontend, which
    clears the stored session on 401."""
    user = get_current_user(authorization=bearer(conductor_token()))
    with pytest.raises(HTTPException) as exc:
        require_role("ADMIN")(user=user)
    assert exc.value.status_code != 401


def test_unknown_role_on_a_token_is_403():
    user = TokenPayload(user_id="USR-X", role="SOMETHING_ELSE",
                        display_name="X", issued_at=0, expires_at=9_999_999_999)
    with pytest.raises(HTTPException) as exc:
        require_role("ADMIN")(user=user)
    assert exc.value.status_code == 403


# ── require_role: misuse ─────────────────────────────────────────────────────

def test_require_role_without_roles_raises_at_setup():
    """An empty require_role() reads as either 'anyone' or 'no one'. Fail loudly."""
    with pytest.raises(ValueError):
        require_role()
