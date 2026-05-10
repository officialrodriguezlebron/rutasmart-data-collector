from pydantic import BaseModel, Field
from typing import Optional
from app.models.user import UserRole


class AdminAnalystLoginRequest(BaseModel):
    email:    str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class ConductorLoginRequest(BaseModel):
    employee_id: str = Field(..., min_length=1)
    pin:         str = Field(..., min_length=4, max_length=8)


class LoginResponse(BaseModel):
    """
    Returned on successful login.
    token is a simple signed string for prototype.
    Pre-LGU: replace with JWT (python-jose).
    """
    token:        str
    role:         UserRole
    display_name: str
    user_id:      str
    jeep_code:    Optional[str] = None   # conductors only
