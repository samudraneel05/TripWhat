"""Auth request/response schemas."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator


def _normalize_email(value):
    return value.strip().lower() if isinstance(value, str) else value


PreferenceText = Annotated[str, StringConstraints(max_length=200)]


class UserPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    budget: PreferenceText | None = None
    travelStyle: PreferenceText | None = None
    interests: list[PreferenceText] | None = Field(default=None, max_length=10)
    homeCity: PreferenceText | None = None
    dietary: PreferenceText | None = None
    pace: PreferenceText | None = None


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    preferences: UserPreferences | None = None

    _normalize_email = field_validator("email", mode="before")(_normalize_email)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value) <= 200:
            raise ValueError("Name must be between 1 and 200 characters")
        return value

    @field_validator("password")
    @classmethod
    def _validate_password(cls, value: str) -> str:
        if not 8 <= len(value) <= 128:
            raise ValueError("Password must be between 8 and 128 characters")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    _normalize_email = field_validator("email", mode="before")(_normalize_email)


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    bio: str | None = None
    avatar_url: str | None = None
    preferences: dict | None = None


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    preferences: UserPreferences | None = None
