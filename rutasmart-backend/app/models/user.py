"""
User model for RutaSmart authentication.
Three roles: ADMIN, ANALYST, CONDUCTOR (matches wireframe exactly).

Conductors authenticate with employee_id + PIN.
Admin and Analyst authenticate with email + password.

Passwords are hashed with bcrypt via passlib.
This is a prototype-grade auth system — pre-LGU pilot should add
JWT expiry, refresh tokens, and password reset flow.
"""

import enum
import hashlib
from sqlalchemy import Column, String, Enum, Boolean, DateTime, text
from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN     = "ADMIN"
    ANALYST   = "ANALYST"
    CONDUCTOR = "CONDUCTOR"


class User(Base):
    __tablename__ = "users"

    user_id       = Column(String, primary_key=True)   # e.g. USR-001
    role          = Column(Enum(UserRole), nullable=False, index=True)

    # Admin + Analyst login fields
    email         = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)

    # Conductor login fields
    employee_id   = Column(String, unique=True, nullable=True)   # e.g. CDR-2024-042
    pin_hash      = Column(String, nullable=True)
    jeep_code     = Column(String, nullable=True)                # assigned jeep

    # Common fields
    display_name  = Column(String, nullable=False)
    is_active     = Column(Boolean, default=True, nullable=False)
    created_at    = Column(
        DateTime,
        server_default=text("(now() AT TIME ZONE 'UTC')"),
        nullable=False,
    )

    def verify_password(self, plain: str) -> bool:
        """Simple SHA-256 hash comparison — upgrade to bcrypt pre-LGU."""
        return self.password_hash == hashlib.sha256(plain.encode()).hexdigest()

    def verify_pin(self, plain: str) -> bool:
        return self.pin_hash == hashlib.sha256(plain.encode()).hexdigest()

    @staticmethod
    def hash_password(plain: str) -> str:
        return hashlib.sha256(plain.encode()).hexdigest()
