"""
RutaSmart token signing and verification
========================================

Issues and validates the session token returned by the login endpoints.

Why not JWT
-----------
The previous token was ``base64(user_id:role:display_name:timestamp)``. Base64
is an encoding, not a signature, so anyone could mint ``base64("USR-001:ADMIN:
X:0")`` and the server had no way to tell. The embedded timestamp was never
read, so tokens never expired.

JWT was evaluated and deliberately not adopted. Neither ``python-jose`` nor
``PyJWT`` is installed or declared, and ``python-jose`` pulls in
``cryptography``/``rsa``/``ecdsa``. RutaSmart has exactly one issuer and one
verifier sharing a secret, so the asymmetric signing and cross-vendor
interoperability JWT exists for are unused. HMAC-SHA256 from the standard
library provides the same properties that matter here — integrity, tamper
detection and expiry — with no new dependency.

Token format
------------
The base64 payload concept is preserved, with issued-at, expires-at and a
signature added::

    <base64url(user_id:role:display_name:issued_at:expires_at)>.<base64url(hmac)>

``display_name`` may itself contain ":", so the payload is parsed positionally
from both ends rather than by a naive split.

STATUS: tokens are ISSUED and can be VERIFIED, and the FastAPI dependencies
``get_current_user`` and ``require_role`` exist — but they are applied to NO
endpoint yet. Attaching them route by route is Phase 3A Step 4b onwards.
"""

import base64
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Callable, Optional

from fastapi import Depends, Header, HTTPException

logger = logging.getLogger("rutasmart.security")

# Sessions last one shift. Conductors record for a working day, and admins are
# expected to re-authenticate daily.
TOKEN_TTL_SECONDS = 12 * 60 * 60

_ENV = os.getenv("ENV", "development").lower()


def _load_secret() -> str:
    """Signing secret, from RUTASMART_TOKEN_SECRET.

    When the variable is unset a fresh random secret is generated for this
    process. That keeps local development zero-config while guaranteeing the
    key is never a predictable default — a hardcoded fallback would be worse
    than no signature at all, because it would look protected while being
    forgeable by anyone who has read this file.

    The practical cost of the fallback is that tokens stop validating when the
    process restarts, and separate workers will not accept each other's
    tokens. That is survivable in development and unacceptable in production,
    so production additionally logs an error.
    """
    configured = os.getenv("RUTASMART_TOKEN_SECRET", "").strip()
    if configured:
        return configured

    generated = secrets.token_urlsafe(48)
    if _ENV == "production":
        logger.error(
            "RUTASMART_TOKEN_SECRET is not set. Using a per-process random "
            "secret: sessions will be invalidated on every restart and will "
            "not work across multiple workers. Set RUTASMART_TOKEN_SECRET."
        )
    else:
        logger.warning(
            "RUTASMART_TOKEN_SECRET not set — using a per-process development "
            "secret. Tokens issued before a restart will no longer verify."
        )
    return generated


_SECRET = _load_secret()


class TokenError(Exception):
    """Base class for token validation failures."""


class TokenInvalid(TokenError):
    """Malformed token, or signature that does not match."""


class TokenExpired(TokenError):
    """Well-formed and correctly signed, but past its expiry."""


@dataclass(frozen=True)
class TokenPayload:
    user_id: str
    role: str
    display_name: str
    issued_at: int
    expires_at: int


def _b64e(raw: bytes) -> str:
    """URL-safe base64 without padding."""
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    """Inverse of _b64e, restoring the stripped padding."""
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str) -> str:
    """HMAC-SHA256 over the exact payload string that is transmitted."""
    digest = hmac.new(_SECRET.encode(), payload_b64.encode(), sha256).digest()
    return _b64e(digest)


def create_token(user_id: str, role: str, display_name: str,
                 ttl_seconds: int = TOKEN_TTL_SECONDS) -> str:
    """Build a signed token for an authenticated user."""
    issued_at = int(time.time())
    expires_at = issued_at + ttl_seconds
    payload = f"{user_id}:{role}:{display_name}:{issued_at}:{expires_at}"
    payload_b64 = _b64e(payload.encode())
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_token(token: str) -> TokenPayload:
    """Validate a token and return its payload.

    Raises TokenInvalid for anything malformed or wrongly signed, and
    TokenExpired for a valid signature past its expiry. The signature is
    checked before the expiry so that an attacker cannot learn anything from
    the ordering of the two failures.
    """
    if not token or not isinstance(token, str):
        raise TokenInvalid("Token missing.")

    payload_b64, separator, signature = token.partition(".")
    if not separator or not payload_b64 or not signature:
        raise TokenInvalid("Token is not in <payload>.<signature> form.")

    # compare_digest on the encoded forms: constant time, and never raises on
    # unexpected characters the way a str comparison of decoded bytes might.
    if not hmac.compare_digest(signature, _sign(payload_b64)):
        raise TokenInvalid("Token signature does not match.")

    try:
        payload = _b64d(payload_b64).decode()
    except Exception as exc:  # malformed base64 or non-UTF-8 payload
        raise TokenInvalid("Token payload is not decodable.") from exc

    parts = payload.split(":")
    if len(parts) < 5:
        raise TokenInvalid("Token payload has too few fields.")

    # user_id and role never contain ":", and the two timestamps are the last
    # two fields, so whatever remains in the middle is the display name.
    user_id, role = parts[0], parts[1]
    display_name = ":".join(parts[2:-2])
    try:
        issued_at, expires_at = int(parts[-2]), int(parts[-1])
    except ValueError as exc:
        raise TokenInvalid("Token timestamps are not integers.") from exc

    if int(time.time()) >= expires_at:
        raise TokenExpired("Token has expired.")

    return TokenPayload(
        user_id=user_id,
        role=role,
        display_name=display_name,
        issued_at=issued_at,
        expires_at=expires_at,
    )


def try_verify_token(token: str) -> Optional[TokenPayload]:
    """Non-raising form of verify_token. Returns None on any failure."""
    try:
        return verify_token(token)
    except TokenError:
        return None


# ── FastAPI dependencies ─────────────────────────────────────────────────────
# Declared here but deliberately attached to no route yet. Enforcement is
# switched on group by group so each change can be verified against the UI:
#   1. destructive admin writes   2. the rest of /admin/*
#   3. analytics and ML           4. conductor write routes
#
# Two constraints carried over from the Phase 3A audit:
#   * /public/* must never require a token. Those endpoints back the anonymous
#     passenger dashboard and are already exempt from the API key.
#   * POST /admin/clean-stale-trips is called by the conductor Recording page,
#     so it must allow CONDUCTOR as well as ADMIN. Making it admin-only would
#     break recording.

def get_current_user(authorization: Optional[str] = Header(None)) -> TokenPayload:
    """Resolve the caller from the Authorization header.

    Raises 401 for a missing, malformed, unsigned, forged or expired token.
    Authentication only — it says who the caller is, not what they may do.
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, raw = authorization.partition(" ")
    if scheme.lower() != "bearer" or not raw.strip():
        raise HTTPException(
            status_code=401,
            detail="Authorization header must be 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return verify_token(raw.strip())
    except TokenExpired:
        # Distinguished from a bad token so the client can tell "sign in
        # again" from "something is wrong with this request".
        raise HTTPException(
            status_code=401,
            detail="Session expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except TokenInvalid:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_role(*roles: str) -> Callable[..., TokenPayload]:
    """Dependency factory requiring the caller to hold one of ``roles``.

    Authenticated but insufficiently privileged callers get 403, not 401:
    re-authenticating would not help, and a 401 would make the frontend clear
    a perfectly good session.

    At least one role must be named. An empty ``require_role()`` is a
    programming error — read either as "anyone" or "no one" depending on the
    implementation — so it fails loudly at import time instead. Use
    ``get_current_user`` directly when any authenticated caller will do.
    """
    if not roles:
        raise ValueError(
            "require_role() needs at least one role; "
            "use get_current_user for any authenticated caller."
        )
    allowed = {r.upper() for r in roles}

    def _require(user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
        if user.role.upper() not in allowed:
            raise HTTPException(
                status_code=403,
                detail="This account does not have access to this resource.",
            )
        return user

    return _require
