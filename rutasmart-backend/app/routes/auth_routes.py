"""
RutaSmart Auth Routes
=====================
POST /auth/login/admin     — Admin login (email + password)
POST /auth/login/conductor — Conductor login (employee_id + PIN)
POST /auth/create          — Public signup (CONDUCTOR only)
POST /auth/seed            — Dev-only — disabled when ENV=production
GET  /auth/conductors      — List conductor accounts (admin view)

Auth model: two roles, ADMIN and CONDUCTOR.
Token format (prototype): base64({user_id}:{role}:{display_name}:{timestamp})
Pre-LGU: replace with python-jose JWT with expiry + refresh.

Password and PIN hashes are bcrypt. Legacy SHA-256 hashes are accepted on
login but are silently upgraded to bcrypt on success.
"""

import base64
import os
import time
import uuid as _uuid
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

ENV = os.getenv("ENV", "development").lower()


def make_token(user: User) -> str:
    payload = f"{user.user_id}:{user.role.value}:{user.display_name}:{int(time.time())}"
    return base64.b64encode(payload.encode()).decode()


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


# ── Dev seed (gated by ENV flag) ───────────────────────────────────────────

@router.post("/seed", tags=["Dev"])
def seed_users(db: Session = Depends(get_db)):
    """
    Development-only endpoint. Seeds default demo users.
    Disabled when the ENV environment variable is set to 'production'.
    """
    if ENV == "production":
        raise HTTPException(
            status_code=403,
            detail="The /auth/seed endpoint is disabled in production.",
        )

    defaults = [
        {
            "user_id":      "USR-001",
            "role":         UserRole.ADMIN,
            "email":        "admin@rutasmart.ph",
            "password":     "Admin2026!",
            "display_name": "A. Santos",
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

        if d["role"] == UserRole.ADMIN:
            user.email         = d["email"]
            user.password_hash = User.hash_password(d["password"])
        else:
            user.employee_id = d["employee_id"]
            user.pin_hash    = User.hash_pin(d["pin"])
            user.jeep_code   = d.get("jeep_code")

        db.add(user)
        created.append(d["user_id"])

    db.commit()
    return {
        "seeded":  created,
        "message": "Default users ready. Remove or disable /auth/seed in production.",
        "env":     ENV,
    }


@router.get("/conductors", tags=["Authentication"])
def get_conductors(db: Session = Depends(get_db)):
    """List all conductor accounts — for the admin dashboard table."""
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
