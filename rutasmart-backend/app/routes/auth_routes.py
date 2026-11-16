"""
RutaSmart Auth Routes
=====================
POST /auth/login/admin     — Admin login (email + password)
POST /auth/login/conductor — Conductor login (employee_id + PIN)
POST /auth/create          — Public signup (CONDUCTOR only)
POST /auth/seed            — Dev-only — needs ENV=development + SEED_SECRET
GET  /auth/conductors      — List conductor accounts (admin view)

Auth model: two roles, ADMIN and CONDUCTOR.

Tokens are HMAC-SHA256 signed with an issued-at and an expiry — see
app/security.py, which also records why JWT was evaluated and not adopted.
They are issued here but not yet enforced by any endpoint; wiring verification
into request handling is Phase 3A Step 4.

Password and PIN hashes are bcrypt. Legacy SHA-256 hashes are accepted on
login but are silently upgraded to bcrypt on success.
"""

import json
import os
import secrets
import uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.user import User, UserRole
from app.security import create_token, require_role
from app.schemas.auth_schema import (
    AdminAnalystLoginRequest,
    ConductorLoginRequest,
    LoginResponse,
)

router  = APIRouter(prefix="/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)

ENV = os.getenv("ENV", "development").lower()


def make_token(user: User) -> str:
    """Issue a signed session token for an authenticated user.

    Thin adapter over app.security.create_token so the call sites below stay
    unchanged. The returned string is still a base64 payload, now followed by
    ".<signature>", so the frontend continues to store it verbatim.
    """
    return create_token(
        user_id=user.user_id,
        role=user.role.value,
        display_name=user.display_name,
    )


# ── Admin login ────────────────────────────────────────────────────────────

@router.post("/login/admin", response_model=LoginResponse)
@limiter.limit("10/minute")
def login_admin(
    body: AdminAnalystLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Email + password login for ADMIN role."""
    user = db.query(User).filter(
        User.email == body.email.lower().strip(),
        User.is_active == True,
    ).first()

    if not user or user.role != UserRole.ADMIN:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.needs_password_rehash():
        user.set_password(body.password)
        db.commit()

    return LoginResponse(
        token=make_token(user),
        role=user.role,
        display_name=user.display_name,
        user_id=user.user_id,
    )


# ── Conductor login ────────────────────────────────────────────────────────

@router.post("/login/conductor", response_model=LoginResponse)
@limiter.limit("10/minute")
def login_conductor(
    body: ConductorLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Employee ID + PIN login for CONDUCTOR role."""
    user = db.query(User).filter(
        User.employee_id == body.employee_id.strip(),
        User.role == UserRole.CONDUCTOR,
        User.is_active == True,
    ).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid employee ID or PIN")

    if not user.verify_pin(body.pin):
        raise HTTPException(status_code=401, detail="Invalid employee ID or PIN")

    if user.needs_pin_rehash():
        user.set_pin(body.pin)
        db.commit()

    return LoginResponse(
        token=make_token(user),
        role=user.role,
        display_name=user.display_name,
        user_id=user.user_id,
        jeep_code=user.jeep_code,
    )


# ── Public conductor signup ────────────────────────────────────────────────

@router.post("/create", tags=["Authentication"])
@limiter.limit("5/minute")
def create_user(
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Public signup endpoint — CONDUCTOR accounts only.
    ADMIN accounts must be provisioned manually.

    PRODUCTION BLOCKER — see docs/security-production-blockers.md (BLOCKER-1).
    This endpoint is unauthenticated: anyone who can reach the API may create a
    CONDUCTOR account, and a conductor account can POST /trip/start-trip and
    POST /log/, which write to the trips and gps_logs tables that hold the
    thesis dataset. It is left open deliberately to preserve the local signup
    workflow, and must be restricted to ADMIN, put behind an approval queue, or
    disabled before this service is exposed on a public domain. The X-API-Key
    middleware does not mitigate this — that key ships inside the browser
    bundle and is readable by anyone who loads the site.
    """
    role_str = body.get("role", "").upper()
    if role_str != "CONDUCTOR":
        raise HTTPException(status_code=400, detail="Only CONDUCTOR accounts may be self-registered.")

    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required.")

    employee_id = (body.get("employee_id") or "").strip()
    pin         = body.get("pin") or ""
    jeep_code   = (body.get("jeep_code") or "").strip()

    if not employee_id:
        raise HTTPException(status_code=400, detail="Employee ID is required.")
    if len(pin) < 4 or len(pin) > 8 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4–8 digits.")
    if db.query(User).filter(User.employee_id == employee_id).first():
        raise HTTPException(status_code=409, detail="Employee ID already registered.")

    user_id = "USR-" + _uuid.uuid4().hex[:6].upper()
    user = User(
        user_id=user_id,
        role=UserRole.CONDUCTOR,
        display_name=display_name,
        employee_id=employee_id,
        pin_hash=User.hash_pin(pin),
        jeep_code=jeep_code or None,
        is_active=True,
    )

    db.add(user)
    db.commit()
    return {"message": "Conductor account created successfully.", "user_id": user_id, "role": "CONDUCTOR"}


# ── Dev seed (ENV-gated, secret-gated, no credentials in source) ───────────
#
# This endpoint previously carried demo account credentials inline. They were
# removed: anything in source is public the moment the repository is, and a
# default password stays the password in every deployment that forgets to
# change it.
#
# Three independent gates now apply, and NONE of them has a fallback — a
# missing or blank value fails closed:
#
#   1. ENV must be exactly "development". Production is refused, and so is
#      staging or any other value, rather than being treated as development.
#   2. SEED_SECRET must be configured in the environment AND presented by the
#      caller in the X-Seed-Secret header. Compared in constant time.
#   3. The accounts themselves come from SEED_ACCOUNTS, a JSON array in the
#      environment. Nothing is hardcoded, so with SEED_ACCOUNTS unset the
#      endpoint creates no accounts at all.
#
# SEED_ACCOUNTS shape — see .env.example:
#
#   [{"user_id": "...", "role": "ADMIN",
#     "email": "...", "password": "...", "display_name": "..."},
#    {"user_id": "...", "role": "CONDUCTOR",
#     "employee_id": "...", "pin": "...", "jeep_code": "...",
#     "display_name": "..."}]
#
# Error messages below name only KEYS, never values: SEED_ACCOUNTS holds
# plaintext passwords and PINs, and a parser message that quoted the offending
# text would leak them into an HTTP response and the logs.

SEED_SECRET_HEADER = "X-Seed-Secret"


def _seed_accounts_from_env() -> list:
    """Parse SEED_ACCOUNTS into a list of account specs.

    Returns an empty list when the variable is unset or blank. Never falls
    back to built-in accounts. Raises 500 on malformed configuration, with a
    message that deliberately omits the offending text.
    """
    raw = os.getenv("SEED_ACCOUNTS", "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        # exc carries a snippet of the input, which contains credentials.
        raise HTTPException(
            status_code=500,
            detail="SEED_ACCOUNTS is not valid JSON.",
        ) from exc
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=500,
            detail="SEED_ACCOUNTS must be a JSON array of account objects.",
        )
    return parsed


def _seed_field(spec: dict, key: str, position: str) -> str:
    """Required non-empty string field from one account spec.

    The error names the key and the account's position only.
    """
    value = spec.get(key)
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=400,
            detail=(f"Seed account {position}: '{key}' is required and must be "
                    f"a non-empty string."),
        )
    return value.strip()


@router.post("/seed", tags=["Dev"])
def seed_users(request: Request, db: Session = Depends(get_db)):
    """
    Development-only endpoint. Creates the accounts listed in SEED_ACCOUNTS.

    Refused with 403 when ENV is anything other than "development", when
    SEED_SECRET is not configured, or when the X-Seed-Secret header does not
    match it. No credentials live in this file and there are no defaults, so
    an unconfigured deployment can create nothing through this route.

    Already-existing user_ids are skipped, so the call stays idempotent.
    """
    # ── Gate 1: environment ──────────────────────────────────────────────
    # Production keeps its original status and message, so that contract is
    # unchanged for anyone already depending on it.
    if ENV == "production":
        raise HTTPException(
            status_code=403,
            detail="The /auth/seed endpoint is disabled in production.",
        )
    # Anything that is not explicitly development is refused as well, rather
    # than being treated as development by default.
    if ENV != "development":
        raise HTTPException(
            status_code=403,
            detail="The /auth/seed endpoint is only available when ENV=development.",
        )

    # ── Gate 2: dedicated seeding secret ─────────────────────────────────
    seed_secret = os.getenv("SEED_SECRET", "").strip()
    if not seed_secret:
        raise HTTPException(
            status_code=403,
            detail="Seeding is not enabled: SEED_SECRET is not configured.",
        )
    presented = request.headers.get(SEED_SECRET_HEADER, "")
    # compare_digest on bytes: constant-time, and tolerant of a non-ASCII
    # header value that would make a str comparison raise.
    if not secrets.compare_digest(presented.encode("utf-8"),
                                  seed_secret.encode("utf-8")):
        raise HTTPException(
            status_code=403,
            detail=f"Missing or invalid {SEED_SECRET_HEADER} header.",
        )

    # ── Gate 3: accounts supplied by the operator, never by this file ────
    accounts = _seed_accounts_from_env()
    if not accounts:
        raise HTTPException(
            status_code=400,
            detail=("No seed accounts are configured. Set SEED_ACCOUNTS to a "
                    "JSON array of account objects; see .env.example."),
        )

    created = []
    for index, spec in enumerate(accounts, start=1):
        position = f"#{index}"
        if not isinstance(spec, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Seed account {position}: each entry must be a JSON object.",
            )

        user_id = _seed_field(spec, "user_id", position)
        role_name = _seed_field(spec, "role", position).upper()
        if role_name not in (UserRole.ADMIN.value, UserRole.CONDUCTOR.value):
            raise HTTPException(
                status_code=400,
                detail=(f"Seed account {position}: 'role' must be "
                        f"{UserRole.ADMIN.value} or {UserRole.CONDUCTOR.value}."),
            )
        role = UserRole(role_name)

        if db.query(User).filter(User.user_id == user_id).first():
            continue

        user = User(
            user_id=user_id,
            role=role,
            display_name=_seed_field(spec, "display_name", position),
            is_active=True,
        )

        if role == UserRole.ADMIN:
            user.email         = _seed_field(spec, "email", position)
            user.password_hash = User.hash_password(
                _seed_field(spec, "password", position))
        else:
            user.employee_id = _seed_field(spec, "employee_id", position)
            user.pin_hash    = User.hash_pin(_seed_field(spec, "pin", position))
            jeep_code        = spec.get("jeep_code")
            user.jeep_code   = jeep_code.strip() if isinstance(jeep_code, str) and jeep_code.strip() else None

        db.add(user)
        created.append(user_id)

    db.commit()
    return {
        "seeded":  created,
        "message": "Seed accounts ready. /auth/seed is refused unless ENV=development.",
        "env":     ENV,
    }


@router.get("/conductors", tags=["Authentication"],
            dependencies=[Depends(require_role("ADMIN"))])
def get_conductors(db: Session = Depends(get_db)):
    """List all conductor accounts — for the admin dashboard table.

    ADMIN only. Returns employee IDs and jeep assignments for every
    conductor, which is roster data and half of a conductor's credentials.
    """
    conductors = db.query(User).filter(User.role == UserRole.CONDUCTOR).all()
    return [
        {
            "employee_id":  u.employee_id,
            "display_name": u.display_name,
            "jeep_code":    u.jeep_code,
            "is_active":    u.is_active,
            "created_at":   u.created_at.isoformat() if u.created_at else None,
        }
        for u in conductors
    ]
