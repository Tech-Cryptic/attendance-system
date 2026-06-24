from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


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


class EnrollmentRequest(BaseModel):
    matric_number:   str = Field(..., max_length=20)
    full_name:       str = Field(..., max_length=200)
    token:           str
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