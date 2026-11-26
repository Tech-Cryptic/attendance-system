import numpy as np
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException

from app.auth.jwt import require_roles
from app.auth.router import hash_password
from app.db.database import get_connection, release_connection
from app.models.schemas import (
    TokenCheckRequest, EnrollmentRequest, EnrollmentResponse, BehaviouralUpdateRequest
)
from app.qr.signing import sign_qr_payload

router = APIRouter()

# -- Similarity threshold for twin-flagging at enrollment time --
# Calibrated against Section 3.5.2 / 3.6.3 (Euclidean in 1024-dim space)
SIMILARITY_FLAG_THRESHOLD = 0.50


def euclidean_distance(emb1: list[float], emb2: list[float]) -> float:
    return float(np.linalg.norm(np.array(emb1) - np.array(emb2)))


def resolve_enrollment_token(cur, token, matric_number=None, allow_used=False):
    cur.execute(
        "SELECT course_code, matric_number, used, expires_at FROM enrollment_tokens WHERE token = %s",
        (token,)
    )
    row = cur.fetchone()
    if row:
        course_code, bound_matric, used, expires_at = row
        if used and not allow_used:
            raise HTTPException(status_code=409, detail="Token already used")
        if expires_at and expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=403, detail="Token expired")
        if bound_matric and matric_number and bound_matric != matric_number:
            raise HTTPException(status_code=403, detail="Token matric number mismatch")
        return {"course_code": course_code, "bound_matric": bound_matric, "single_use": True}

    cur.execute(
        "SELECT course_code, matric_list, enrollment_link_expires_at "
        "FROM courses WHERE enrollment_link_token = %s",
        (token,)
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=403, detail="Invalid enrollment token")

    course_code, matric_list, expires_at = row
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=403, detail="Enrollment link expired")
    if matric_list and matric_number and matric_number not in matric_list:
        raise HTTPException(status_code=403, detail="Matric number is not allowed for this course")
    return {"course_code": course_code, "bound_matric": matric_number, "single_use": False}


@router.post("/enroll/check-token")
def check_token(req: TokenCheckRequest):
    """
    Pre-validation: check if a token is valid before starting the biometric flow.
    Does NOT consume the token. Returns course info if valid.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        token_info = resolve_enrollment_token(cur, req.token, req.matric_number)

        matric = (req.matric_number or token_info["bound_matric"] or '').strip()
        email = str(req.email).strip().lower() if req.email else None

        if email:
            cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="Email or matric number already registered. Sign in instead.")
        if matric:
            cur.execute("SELECT id FROM users WHERE linked_matric = %s", (matric,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="Email or matric number already registered. Sign in instead.")

        cur.close()
        return {"valid": True, "course_code": token_info["course_code"]}
    finally:
        release_connection(conn)


# -- Enrollment ------------------------------------------------

@router.post("/enroll", response_model=EnrollmentResponse)
def enroll_student(req: EnrollmentRequest):
    if not req.consent_given:
        raise HTTPException(status_code=400, detail="NDPR consent is required before enrollment")

    email = str(req.email).strip().lower()

    conn = get_connection()
    try:
        cur = conn.cursor()

        # 1. Validate token
        token_info = resolve_enrollment_token(cur, req.token, req.matric_number)
        course_code = token_info["course_code"]

        # 2. Reject duplicate enrollment
        cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Email or matric number already registered. Sign in instead.")

        cur.execute("SELECT id FROM users WHERE linked_matric = %s", (req.matric_number,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Email or matric number already registered. Sign in instead.")

        cur.execute("SELECT matric_number FROM students WHERE matric_number = %s", (req.matric_number,))
        if cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="Student already enrolled")

        # 3. Enrollment-time similarity scan (twin / look-alike flagging)
        cur.execute("SELECT matric_number, embedding FROM students")
        existing = cur.fetchall()

        flagged_with = None
        for other_matric, other_embedding in existing:
            dist = euclidean_distance(req.embedding, other_embedding)
            if dist < SIMILARITY_FLAG_THRESHOLD:
                flagged_with = other_matric
                break

        high_similarity_flag = flagged_with is not None
        enrolled_at = datetime.now(timezone.utc)
        password_hash = hash_password(req.password)

        cur.execute(
            """INSERT INTO users (email, password_hash, role, full_name, linked_matric)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (email, password_hash, "student", req.full_name, req.matric_number)
        )

        # 4. Insert student (with optional iris_embedding)
        cur.execute(
            """INSERT INTO students
               (matric_number, full_name, embedding, iris_embedding, enrolled_at,
                consent_given_at, consent_version, high_similarity_flag, flagged_pair_matric)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                req.matric_number, req.full_name,
                req.embedding,
                req.iris_embedding,   # None if not provided: column is nullable
                enrolled_at, enrolled_at,
                req.consent_version,
                high_similarity_flag, flagged_with
            )
        )

        # 5. Bidirectional flag update for matched pair
        if flagged_with:
            cur.execute(
                "UPDATE students SET high_similarity_flag = TRUE, flagged_pair_matric = %s "
                "WHERE matric_number = %s",
                (req.matric_number, flagged_with)
            )

        # 6. Link student to course
        cur.execute(
            "INSERT INTO course_enrollments (matric_number, course_code) VALUES (%s, %s)",
            (req.matric_number, course_code)
        )

        # 7. Mark token as used
        if token_info["single_use"]:
            cur.execute(
                "UPDATE enrollment_tokens SET used = TRUE, used_at = %s "
                "WHERE token = %s AND used = FALSE",
                (enrolled_at, req.token)
            )
            if cur.rowcount != 1:
                raise HTTPException(status_code=409, detail="Token already used")

        conn.commit()
        cur.close()

        # 8. Generate signed QR payload
        qr_data = sign_qr_payload(req.matric_number, course_code)

        return EnrollmentResponse(
            matric_number=req.matric_number,
            full_name=req.full_name,
            enrolled_at=enrolled_at,
            high_similarity_flag=high_similarity_flag,
            qr_payload=qr_data["payload"],
            qr_signature=qr_data["signature"]
        )

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        if getattr(e, "pgcode", None) == "23505":
            raise HTTPException(status_code=409, detail="Email or account already registered")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.put("/enroll/behavioural")
def update_behavioural_profile(
    req: BehaviouralUpdateRequest,
    actor: dict = Depends(require_roles("student"))
):
    import json
    conn = get_connection()
    try:
        cur = conn.cursor()

        # 1. Validate that student exists and token is linked/valid
        resolve_enrollment_token(cur, req.token, req.matric_number, allow_used=True)
        if actor.get("matric_number") != req.matric_number:
            raise HTTPException(status_code=403, detail="Cannot update another student's behavioural profile")

        # 2. Update the student's behavioural profile
        profile_json = json.dumps(req.behavioural_profile)
        cur.execute(
            "UPDATE students SET behavioural_profile = %s WHERE matric_number = %s",
            (profile_json, req.matric_number)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Student not found")
            
        conn.commit()
        cur.close()
        return {"success": True, "message": "Behavioural profile updated successfully"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.get("/students/{matric_number:path}/behavioural")
def get_behavioural_profile(
    matric_number: str,
    actor: dict = Depends(require_roles("student", "lecturer", "admin"))
):
    if actor.get("role") == "student" and actor.get("matric_number") != matric_number:
        raise HTTPException(status_code=403, detail="Cannot view another student's behavioural profile")

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT behavioural_profile FROM students WHERE matric_number = %s",
            (matric_number,)
        )
        row = cur.fetchone()
        cur.close()
        if row is None:
            raise HTTPException(status_code=404, detail="Student not found")
        
        profile = row[0]
        return {"matric_number": matric_number, "behavioural_profile": profile}
    finally:
        release_connection(conn)