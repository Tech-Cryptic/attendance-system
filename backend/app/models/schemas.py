from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime


def _validate_password_bytes(value: str) -> str:
    if len(value.encode('utf-8')) > 72:
        raise ValueError('Password must be at most 72 bytes')
    return value


class CourseCreate(BaseModel):
    course_code: str = Field(..., max_length=20)
    course_title: str = Field(..., max_length=200)


class TokenCreateRequest(BaseModel):
    course_code: str
    matric_number: Optional[str] = None
    expires_in_hours: int = 24


class TokenOut(BaseModel):
    token: str
    course_code: str
    expires_at: datetime


class TokenCheckRequest(BaseModel):
    token: str
    matric_number: Optional[str] = None
    email: Optional[EmailStr] = None


class EnrollmentRequest(BaseModel):
    matric_number:   str = Field(..., max_length=20)
    full_name:       str = Field(..., max_length=200)
    email:           EmailStr
    password:        str = Field(..., min_length=8, max_length=72)
    token:           str

    @field_validator('password')
    def validate_password_bytes(cls, value: str) -> str:
        return _validate_password_bytes(value)
    embedding:       list[float] = Field(..., min_length=1024, max_length=1024)
    iris_embedding:  Optional[list[float]] = None   # 25-dim iris descriptor (supplementary)
    consent_given:   bool
    consent_version: str = "1.0"


class EnrollmentResponse(BaseModel):
    matric_number:        str
    full_name:            str
    enrolled_at:          datetime
    high_similarity_flag: bool
    qr_payload:           str
    qr_signature:         str


class BehaviouralUpdateRequest(BaseModel):
    matric_number: str
    token: str
    behavioural_profile: dict