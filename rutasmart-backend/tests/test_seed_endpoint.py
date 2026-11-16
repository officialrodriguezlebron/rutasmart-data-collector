"""Tests for the hardened POST /auth/seed endpoint.

The endpoint used to carry demo credentials inline. These tests pin the
replacement behaviour: three independent gates, none with a fallback, and no
credential of any kind in the source tree.

No database, no network. The seed path is exercised through the route
function with a stub session, so nothing is ever written anywhere.
"""
import importlib
import json

import pytest
from fastapi import HTTPException

import app.routes.auth_routes as auth_routes


HEADER = "X-Seed-Secret"
SECRET = "test-seed-secret-value"


# ── helpers ───────────────────────────────────────────────────────────────────
class _Query:
    """db.query(...).filter(...).first() -> None (nothing exists yet)."""

    def filter(self, *a, **k):
        return self

    def first(self):
        return None


class StubSession:
    """Records adds and commits instead of touching a database."""

    def __init__(self):
        self.added = []
        self.commits = 0

    def query(self, *a, **k):
        return _Query()

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1


class StubRequest:
    def __init__(self, headers=None):
        self.headers = headers or {}


def reload_with_env(monkeypatch, **env):
    """Reload the module so its ENV constant is re-read, then patch os.getenv."""
    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    return importlib.reload(auth_routes)


def call_seed(mod, headers=None, db=None):
    return mod.seed_users(request=StubRequest(headers), db=db or StubSession())


ADMIN_SPEC = {
    "user_id": "SEED-TEST-ADMIN",
    "role": "ADMIN",
    "email": "seed-admin@example.test",
    "password": "not-a-real-password",
    "display_name": "Seed Admin",
}
CONDUCTOR_SPEC = {
    "user_id": "SEED-TEST-CDR",
    "role": "CONDUCTOR",
    "employee_id": "CDR-TEST-900",
    "pin": "4729",
    "jeep_code": "JPN-TEST",
    "display_name": "Seed Conductor",
}


# ── Gate 1: environment ───────────────────────────────────────────────────────
def test_production_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="production",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 403
    assert "disabled in production" in e.value.detail


@pytest.mark.parametrize("env", ["staging", "prod", "PRODUCTION ", "test", ""])
def test_any_non_development_env_is_refused(monkeypatch, env):
    """Only the exact value 'development' may enable seeding."""
    mod = reload_with_env(monkeypatch, ENV=env,
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 403


def test_unset_env_does_not_enable_seeding(monkeypatch):
    """A deployment that never set ENV must not get a seedable endpoint...

    ENV defaults to 'development' in this module, so the request still has to
    pass the secret gate — which is the point of having more than one gate.
    """
    mod = reload_with_env(monkeypatch, ENV=None,
                          SEED_SECRET=None, SEED_ACCOUNTS=None)
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {})
    assert e.value.status_code == 403


# ── Gate 2: seeding secret ────────────────────────────────────────────────────
def test_missing_seed_secret_config_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=None,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: "anything"})
    assert e.value.status_code == 403
    assert "SEED_SECRET is not configured" in e.value.detail


def test_blank_seed_secret_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET="   ",
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: ""})
    assert e.value.status_code == 403


def test_missing_header_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {})
    assert e.value.status_code == 403
    assert HEADER in e.value.detail


def test_wrong_header_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET + "x"})
    assert e.value.status_code == 403


# ── Gate 3: accounts come from the environment, never from source ─────────────
def test_no_accounts_configured_creates_nothing(monkeypatch):
    """The security property: with SEED_ACCOUNTS unset, nothing is created."""
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET, SEED_ACCOUNTS=None)
    db = StubSession()
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET}, db)
    assert e.value.status_code == 400
    assert db.added == []
    assert db.commits == 0


def test_malformed_json_is_refused_without_echoing_the_value(monkeypatch):
    """SEED_ACCOUNTS holds plaintext passwords; the error must not quote it."""
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS='[{"password": "leak-me-please"')
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 500
    assert "leak-me-please" not in e.value.detail


def test_non_array_json_is_refused(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps(ADMIN_SPEC))  # object, not array
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 500


@pytest.mark.parametrize("missing", ["user_id", "role", "display_name"])
def test_missing_required_field_is_refused(monkeypatch, missing):
    spec = {k: v for k, v in ADMIN_SPEC.items() if k != missing}
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([spec]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 400
    assert missing in e.value.detail


@pytest.mark.parametrize("missing", ["email", "password"])
def test_admin_requires_its_own_fields(monkeypatch, missing):
    spec = {k: v for k, v in ADMIN_SPEC.items() if k != missing}
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([spec]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 400


@pytest.mark.parametrize("missing", ["employee_id", "pin"])
def test_conductor_requires_its_own_fields(monkeypatch, missing):
    spec = {k: v for k, v in CONDUCTOR_SPEC.items() if k != missing}
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([spec]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 400


def test_unknown_role_is_refused(monkeypatch):
    spec = dict(ADMIN_SPEC, role="SUPERUSER")
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([spec]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 400
    assert "role" in e.value.detail


def test_entry_must_be_an_object(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps(["not-an-object"]))
    with pytest.raises(HTTPException) as e:
        call_seed(mod, {HEADER: SECRET})
    assert e.value.status_code == 400


# ── Happy path: all three gates satisfied ─────────────────────────────────────
def test_all_gates_passed_creates_the_supplied_accounts(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC, CONDUCTOR_SPEC]))
    db = StubSession()
    result = call_seed(mod, {HEADER: SECRET}, db)

    assert result["seeded"] == ["SEED-TEST-ADMIN", "SEED-TEST-CDR"]
    assert result["env"] == "development"
    assert set(result) == {"seeded", "message", "env"}      # contract unchanged
    assert db.commits == 1
    assert len(db.added) == 2


def test_passwords_and_pins_are_hashed_never_stored_plain(monkeypatch):
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([ADMIN_SPEC, CONDUCTOR_SPEC]))
    db = StubSession()
    call_seed(mod, {HEADER: SECRET}, db)

    admin, conductor = db.added
    assert admin.password_hash != ADMIN_SPEC["password"]
    assert ADMIN_SPEC["password"] not in admin.password_hash
    assert conductor.pin_hash != CONDUCTOR_SPEC["pin"]
    assert CONDUCTOR_SPEC["pin"] not in conductor.pin_hash


def test_optional_jeep_code_defaults_to_none(monkeypatch):
    spec = {k: v for k, v in CONDUCTOR_SPEC.items() if k != "jeep_code"}
    mod = reload_with_env(monkeypatch, ENV="development",
                          SEED_SECRET=SECRET,
                          SEED_ACCOUNTS=json.dumps([spec]))
    db = StubSession()
    call_seed(mod, {HEADER: SECRET}, db)
    assert db.added[0].jeep_code is None


# ── Source-level guarantee ────────────────────────────────────────────────────
def test_no_credentials_remain_in_the_auth_source():
    """Guards against a credential creeping back into this module.

    Flags any credential-ish key assigned a string literal, then discards
    documentation placeholders (``...``, ``<password>``) so the template in
    the module comment does not trip the guard. A real value would.
    """
    import pathlib
    import re

    src = pathlib.Path(auth_routes.__file__).read_text(encoding="utf-8")

    PLACEHOLDER = re.compile(r"^(\.{3}|<[^>]*>|)$")
    offenders = []
    for key, value in re.findall(
        r"[\"']?(password|passwd|pwd|pin|secret|api_?key|token)[\"']?"
        r"\s*[:=]\s*[\"']([^\"']*)[\"']",
        src, re.IGNORECASE,
    ):
        if PLACEHOLDER.match(value.strip()):
            continue
        # os.getenv("SEED_SECRET", "") and header names are not credentials
        if value.strip() in ("", "X-Seed-Secret"):
            continue
        offenders.append((key, value))

    assert offenders == [], offenders


def test_seed_module_reads_accounts_only_from_the_environment():
    import pathlib
    src = pathlib.Path(auth_routes.__file__).read_text(encoding="utf-8")
    assert 'os.getenv("SEED_ACCOUNTS"' in src
    assert 'os.getenv("SEED_SECRET"' in src


@pytest.fixture(autouse=True)
def _restore_module():
    """Leave the module as the rest of the suite expects it."""
    yield
    importlib.reload(auth_routes)
