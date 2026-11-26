import random

from app.db.database import get_connection, release_connection

TOKEN = "test_token_self_service"
MATRIC = "22/01DL777"
EMAIL = "selfservice@test.unilorin.edu.ng"
PASSWORD = "EnrollPass123!"
COURSE_LINK_TOKEN = "test_course_link_self_service"
LINK_MATRIC = "22/01DL778"
LINK_EMAIL = "courselink@test.unilorin.edu.ng"


def _cleanup():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM course_enrollments WHERE matric_number = %s", (MATRIC,))
        cur.execute("DELETE FROM attendance_records WHERE matric_number = %s", (MATRIC,))
        cur.execute("DELETE FROM students WHERE matric_number = %s", (MATRIC,))
        cur.execute("DELETE FROM users WHERE LOWER(email) = LOWER(%s) OR linked_matric = %s", (EMAIL, MATRIC))
        cur.execute("DELETE FROM enrollment_tokens WHERE token = %s", (TOKEN,))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)


def _cleanup_course_link():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM course_enrollments WHERE matric_number = %s", (LINK_MATRIC,))
        cur.execute("DELETE FROM attendance_records WHERE matric_number = %s", (LINK_MATRIC,))
        cur.execute("DELETE FROM students WHERE matric_number = %s", (LINK_MATRIC,))
        cur.execute("DELETE FROM users WHERE LOWER(email) = LOWER(%s) OR linked_matric = %s", (LINK_EMAIL, LINK_MATRIC))
        cur.execute(
            "UPDATE courses SET enrollment_link_token = NULL, enrollment_link_expires_at = NULL, matric_list = NULL "
            "WHERE course_code = 'TSTENR'"
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)


def _ensure_course():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO courses (course_code, course_title) VALUES ('TSTENR', 'Enrollment Test Course') "
            "ON CONFLICT (course_code) DO NOTHING"
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)


def _create_token():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at, used) "
            "VALUES (%s, 'TSTENR', %s, NOW() + INTERVAL '1 day', FALSE)",
            (TOKEN, MATRIC)
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)


def _set_course_link():
    _ensure_course()
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE courses SET enrollment_link_token = %s, enrollment_link_expires_at = NOW() + INTERVAL '1 day', "
            "matric_list = %s WHERE course_code = 'TSTENR'",
            (COURSE_LINK_TOKEN, [LINK_MATRIC])
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)


def _payload(token=TOKEN, matric=MATRIC, email=EMAIL, password=PASSWORD):
    return {
        "matric_number": matric,
        "full_name": "Self Service Student",
        "email": email.upper(),
        "password": password,
        "token": token,
        "embedding": [round(random.uniform(-1, 1), 4) for _ in range(1024)],
        "consent_given": True,
        "consent_version": "1.0",
    }


def test_check_token_rejects_registered_email(client):
    _cleanup()
    _ensure_course()
    _create_token()

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, role, full_name) "
            "VALUES (%s, %s, 'student', %s)",
            (EMAIL, "not-a-real-hash", "Existing Student")
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

    try:
        resp = client.post("/enroll/check-token", json={
            "token": TOKEN,
            "matric_number": MATRIC,
            "email": EMAIL,
        })
        assert resp.status_code == 409
        assert "already registered" in resp.json()["detail"].lower()
    finally:
        _cleanup()


def test_enroll_creates_student_account_and_login(client):
    _cleanup()
    _ensure_course()
    _create_token()

    try:
        resp = client.post("/enroll", json=_payload())
        assert resp.status_code == 200, resp.text
        assert resp.json()["matric_number"] == MATRIC

        login = client.post("/auth/login", json={
            "email": EMAIL.upper(),
            "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        assert login.json()["role"] == "student"
        assert login.json()["full_name"] == "Self Service Student"

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT used FROM enrollment_tokens WHERE token = %s", (TOKEN,))
            used = cur.fetchone()[0]
            cur.close()
        finally:
            release_connection(conn)
        assert used is True
    finally:
        _cleanup()


def test_enroll_rejects_existing_email_without_creating_account(client):
    _cleanup()
    _ensure_course()
    _create_token()

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, role, full_name) "
            "VALUES (%s, %s, 'student', %s)",
            (EMAIL, "not-a-real-hash", "Existing Student")
        )
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

    try:
        resp = client.post("/enroll", json=_payload())
        assert resp.status_code == 409
        assert "already registered" in resp.json()["detail"].lower()

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT matric_number FROM students WHERE matric_number = %s", (MATRIC,))
            assert cur.fetchone() is None
            cur.close()
        finally:
            release_connection(conn)
    finally:
        _cleanup()


def test_course_link_enrolls_and_remains_reusable(client):
    _cleanup_course_link()
    _set_course_link()

    try:
        check = client.post("/enroll/check-token", json={
            "token": COURSE_LINK_TOKEN,
            "matric_number": LINK_MATRIC,
            "email": LINK_EMAIL,
        })
        assert check.status_code == 200, check.text
        assert check.json()["course_code"] == "TSTENR"

        resp = client.post("/enroll", json=_payload(
            token=COURSE_LINK_TOKEN,
            matric=LINK_MATRIC,
            email=LINK_EMAIL,
        ))
        assert resp.status_code == 200, resp.text

        login = client.post("/auth/login", json={
            "email": LINK_EMAIL.upper(),
            "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        assert login.json()["role"] == "student"

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT enrollment_link_token FROM courses WHERE course_code = 'TSTENR'"
            )
            assert cur.fetchone()[0] == COURSE_LINK_TOKEN
            cur.close()
        finally:
            release_connection(conn)
    finally:
        _cleanup_course_link()
