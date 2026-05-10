"""
RutaSmart Auth Routes
=====================
POST /auth/login/admin     — Admin + Analyst login (email + password)
POST /auth/login/conductor — Conductor login (employee_id + PIN)
POST /auth/seed            — Seeds default users (dev/demo only)

Token format (prototype): base64({user_id}:{role}:{display_name}:{timestamp})
Pre-LGU: replace with python-jose JWT with expiry + refresh.
"""

import base64
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.auth_schema import (
    AdminAnalystLoginRequest,
    ConductorLoginRequest,
    LoginResponse,
)

router  = APIRouter(prefix="/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)


def make_token(user: User) -> str:
    """
    Prototype token: base64-encoded payload, not cryptographically signed.
    Pre-LGU: replace with JWT signed with SECRET_KEY using python-jose.
    """
    payload = f"{user.user_id}:{user.role.value}:{user.display_name}:{int(time.time())}"
    return base64.b64encode(payload.encode()).decode()


# ── Admin / Analyst login ──────────────────────────────────────────────────

@router.post("/login/admin", response_model=LoginResponse)
@limiter.limit("10/minute")
def login_admin_analyst(
    body: AdminAnalystLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Email + password login for ADMIN and ANALYST roles.
    Returns a token and role — frontend routes accordingly.
    """
    user = db.query(User).filter(
        User.email == body.email.lower().strip(),
        User.is_active == True,
    ).first()

    if not user or user.role == UserRole.CONDUCTOR:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

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
    """
    Employee ID + PIN login for CONDUCTOR role.
    Returns token, role, and assigned jeep_code.
    """
    user = db.query(User).filter(
        User.employee_id == body.employee_id.strip(),
        User.role == UserRole.CONDUCTOR,
        User.is_active == True,
    ).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid employee ID or PIN")

    if not user.verify_pin(body.pin):
        raise HTTPException(status_code=401, detail="Invalid employee ID or PIN")

    return LoginResponse(
        token=make_token(user),
        role=user.role,
        display_name=user.display_name,
        user_id=user.user_id,
        jeep_code=user.jeep_code,
    )


# ── Seed default users (dev / demo) ───────────────────────────────────────

@router.post("/seed", tags=["Dev"])
def seed_users(db: Session = Depends(get_db)):
    """
    Seeds default demo users. Safe to call multiple times (idempotent).
    Remove or protect this endpoint before any public deployment.

    Default credentials:
      Admin    : admin@rutasmart.ph     / Admin2026!
      Analyst  : analyst@rutasmart.ph   / Analyst2026!
      Conductor: CDR-2024-042           / 1234
    """
    defaults = [
        {
            "user_id":      "USR-001",
            "role":         UserRole.ADMIN,
            "email":        "admin@rutasmart.ph",
            "password":     "Admin2026!",
            "display_name": "A. Santos",
        },
        {
            "user_id":      "USR-002",
            "role":         UserRole.ANALYST,
            "email":        "analyst@rutasmart.ph",
            "password":     "Analyst2026!",
            "display_name": "M. Reyes",
        },
        {
            "user_id":       "USR-003",
            "role":          UserRole.CONDUCTOR,
            "employee_id":   "CDR-2024-042",
            "pin":           "1234",
            "jeep_code":     "JPN-001",
            "display_name":  "J. dela Cruz",
        },
        {
            "user_id":       "USR-004",
            "role":          UserRole.CONDUCTOR,
            "employee_id":   "CDR-2024-043",
            "pin":           "5678",
            "jeep_code":     "JPN-002",
            "display_name":  "P. Garcia",
        },
    ]

    created = []
    for d in defaults:
        existing = db.query(User).filter(User.user_id == d["user_id"]).first()
        if existing:
            continue

        user = User(
            user_id=d["user_id"],
            role=d["role"],
            display_name=d["display_name"],
            is_active=True,
        )

        if d["role"] in (UserRole.ADMIN, UserRole.ANALYST):
            user.email         = d["email"]
            user.password_hash = User.hash_password(d["password"])
        else:
            user.employee_id = d["employee_id"]
            user.pin_hash    = User.hash_password(d["pin"])
            user.jeep_code   = d.get("jeep_code")

        db.add(user)
        created.append(d["user_id"])

    db.commit()
    return {
        "seeded": created,
        "message": "Default users ready. Remove /auth/seed before production.",
    }
