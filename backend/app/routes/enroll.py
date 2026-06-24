import numpy as np
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException

from app.db.database import get_connection, release_connection
from app.models.schemas import (
    TokenCheckRequest, EnrollmentRequest, EnrollmentResponse, BehaviouralUpdateRequest
)
from app.qr.signing import sign_qr_payload

router = APIRouter()

# ── Similarity threshold for twin-flagging at enrollment time ──
# Calibrated against Section 3.5.2 / 3.6.3 (Euclidean in 1024-dim space)
SIMILARITY_FLAG_THRESHOLD = 0.50


def euclidean_distance(emb1: list[float], emb2: list[float]) -> float:
    return float(np.linalg.norm(np.array(emb1) - np.array(emb2)))


@router.post("/enroll/check-token")
def check_token(req: TokenCheckRequest):
    """
    Pre-validation: check if a token is valid before starting the biometric flow.
    Does NOT consume the token. Returns course info if valid.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT course_code, matric_number, used, expires_at FROM enrollment_tokens WHERE token = %s",
            (req.token,)
        )
        row = cur.fetchone()
        cur.close()

        if row is None:
            raise HTTPException(status_code=403, detail="Invalid enrollment token")

        course_code, bound_matric, used, expires_at = row

        if used:
            raise HTTPException(status_code=403, detail="Token has already been used")
        if expires_at and expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=403, detail="Token has expired")
        if bound_matric and req.matric_number and bound_matric != req.matric_number:
            raise HTTPException(status_code=403, detail="Token is not assigned to this matric number")

        return {"valid": True, "course_code": course_code}
    finally:
        release_connection(conn)


# ── Enrollment ────────────────────────────────────────────────

@router.post("/enroll", response_model=EnrollmentResponse)
def enroll_student(req: EnrollmentRequest):
    if not req.consent_given:
        raise HTTPException(status_code=400, detail="NDPR consent is required before enrollment")

    conn = get_connection()
    try:
        cur = conn.cursor()

        # 1. Validate token
        cur.execute(
            "SELECT course_code, matric_number, used, expires_at FROM enrollment_tokens WHERE token = %s",
            (req.token,)
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=403, detail="Invalid enrollment token")

        course_code, bound_matric, used, expires_at = row

        if used:
            raise HTTPException(status_code=403, detail="Token already used")
        if expires_at and expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=403, detail="Token expired")
        if bound_matric and bound_matric != req.matric_number:
            raise HTTPException(status_code=403, detail="Token is not assigned to this matric number")

        # 2. Reject duplicate enrollment
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

        # 4. Insert student (with optional iris_embedding)
        cur.execute(
            """INSERT INTO students
               (matric_number, full_name, embedding, iris_embedding, enrolled_at,
                consent_given_at, consent_version, high_similarity_flag, flagged_pair_matric)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                req.matric_number, req.full_name,
                req.embedding,
                req.iris_embedding,   # None if not provided — column is nullable
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
        cur.execute(
            "UPDATE enrollment_tokens SET used = TRUE, used_at = %s WHERE token = %s",
            (enrolled_at, req.token)
        )

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
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.put("/enroll/behavioural")
def update_behavioural_profile(req: BehaviouralUpdateRequest):
    import json
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        # 1. Validate that student exists and token is linked/valid
        cur.execute(
            "SELECT course_code, matric_number, used FROM enrollment_tokens WHERE token = %s",
            (req.token,)
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=403, detail="Invalid enrollment token")
            
        course_code, bound_matric, used = row
        if bound_matric != req.matric_number:
            raise HTTPException(status_code=403, detail="Token matric number mismatch")
            
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


@router.get("/students/{matric_number}/behavioural")
def get_behavioural_profile(matric_number: str):
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