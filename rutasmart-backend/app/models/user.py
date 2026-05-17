"""
RutaSmart User model — Authentication.

Two roles supported: ADMIN and CONDUCTOR.

Admin accounts authenticate with email + password.
Conductor accounts authenticate with employee_id + numeric PIN.

Passwords and PINs are hashed using bcrypt via passlib.
Legacy SHA-256 hashes are still verified for backward compatibility
with users created before the bcrypt migration; verify_* methods will
auto-upgrade legacy hashes on successful login.
"""

import enum
import hashlib
from sqlalchemy import Column, String, Enum, Boolean, DateTime, text
from passlib.context import CryptContext

from app.database import Base


# ── Password hashing context ────────────────────────────────────
# bcrypt is the primary scheme; sha256 is kept only to read legacy
# database rows. New writes always use bcrypt.
_pwd_ctx = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)


def _is_bcrypt(hashed: str) -> bool:
    """A bcrypt hash starts with $2b$ or $2a$."""
    return bool(hashed) and hashed.startswith(("$2a$", "$2b$", "$2y$"))


def _sha256(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


class UserRole(str, enum.Enum):
    ADMIN     = "ADMIN"
    CONDUCTOR = "CONDUCTOR"


class User(Base):
    __tablename__ = "users"

    user_id       = Column(String, primary_key=True)   # e.g. USR-001
    role          = Column(Enum(UserRole), nullable=False, index=True)

    # Admin login fields
    email         = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)

    # Conductor login fields
    employee_id   = Column(String, unique=True, nullable=True)
    pin_hash      = Column(String, nullable=True)
    jeep_code     = Column(String, nullable=True)

    # Common fields
    display_name  = Column(String, nullable=False)
    is_active     = Column(Boolean, default=True, nullable=False)
    created_at    = Column(
        DateTime,
        server_default=text("(now() AT TIME ZONE 'UTC')"),
        nullable=False,
    )

    # ── Password (admin) ────────────────────────────────────────
    def verify_password(self, plain: str) -> bool:
        """Verify a plaintext password against the stored hash.
        Accepts both bcrypt (current) and SHA-256 (legacy) hashes.
        Returns True / False — caller is responsible for upgrading
        legacy hashes via `needs_password_rehash` and `set_password`."""
        if not self.password_hash:
            return False
        if _is_bcrypt(self.password_hash):
            return _pwd_ctx.verify(plain, self.password_hash)
        # Legacy SHA-256 fallback
        return self.password_hash == _sha256(plain)

    def needs_password_rehash(self) -> bool:
        """True if the stored password hash is legacy SHA-256."""
        return bool(self.password_hash) and not _is_bcrypt(self.password_hash)

    def set_password(self, plain: str) -> None:
        self.password_hash = _pwd_ctx.hash(plain)

    # ── PIN (conductor) ─────────────────────────────────────────
    def verify_pin(self, plain: str) -> bool:
        if not self.pin_hash:
            return False
        if _is_bcrypt(self.pin_hash):
            return _pwd_ctx.verify(plain, self.pin_hash)
        return self.pin_hash == _sha256(plain)

    def needs_pin_rehash(self) -> bool:
        return bool(self.pin_hash) and not _is_bcrypt(self.pin_hash)

    def set_pin(self, plain: str) -> None:
        self.pin_hash = _pwd_ctx.hash(plain)

    # ── Static helpers ──────────────────────────────────────────
    @staticmethod
    def hash_password(plain: str) -> str:
        """Always returns a bcrypt hash for new password writes."""
        return _pwd_ctx.hash(plain)

    @staticmethod
    def hash_pin(plain: str) -> str:
        return _pwd_ctx.hash(plain)
