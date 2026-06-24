import pytest
from app.db.database import get_connection, release_connection
from .conftest import auth_header

class TestBehaviouralEndpoints:
    def test_update_behavioural_profile_invalid_token(self, client):
        """PUT /enroll/behavioural with non-existent token -> 403."""
        resp = client.put("/enroll/behavioural", json={
            "matric_number": "22/01DL999",
            "token": "invalid_token_xyz",
            "behavioural_profile": {
                "keystroke": {"meanDwell": 120.0, "meanFlight": 150.0},
                "touch": [1.0, 2.0, 3.0],
                "motion": [0.1, -0.2, 0.5]
            }
        })
        assert resp.status_code == 403
        assert "token" in resp.json()["detail"].lower()

    def test_update_behavioural_profile_mismatch_matric(self, client):
        """PUT /enroll/behavioural with matric mismatch -> 403."""
        # Insert a mock token first
        conn = get_connection()
        try:
            cur = conn.cursor()
            # Clear old test data if exists
            cur.execute("DELETE FROM enrollment_tokens WHERE token = 'test_token_behavioural'")
            cur.execute(
                "INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at, used) "
                "VALUES ('test_token_behavioural', 'TST999', '22/01DL888', NOW() + INTERVAL '1 day', FALSE)"
            )
            conn.commit()
            cur.close()
        finally:
            release_connection(conn)

        resp = client.put("/enroll/behavioural", json={
            "matric_number": "22/01DL777",  # mismatch with 22/01DL888
            "token": "test_token_behavioural",
            "behavioural_profile": {
                "keystroke": {"meanDwell": 120.0, "meanFlight": 150.0},
                "touch": [1.0, 2.0, 3.0],
                "motion": [0.1, -0.2, 0.5]
            }
        })
        assert resp.status_code == 403
        assert "matric number mismatch" in resp.json()["detail"].lower()

    def test_update_behavioural_profile_and_get_success(self, client, admin_token):
        """PUT /enroll/behavioural updates DB and GET /students/{matric}/behavioural returns it."""
        conn = get_connection()
        try:
            cur = conn.cursor()
            # Clean up
            cur.execute("DELETE FROM students WHERE matric_number = '22/01DL888'")
            cur.execute("DELETE FROM enrollment_tokens WHERE token = 'test_token_behavioural'")
            
            # Setup course and token and student row
            cur.execute("INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at, used) VALUES ('test_token_behavioural', 'TST999', '22/01DL888', NOW() + INTERVAL '1 day', FALSE)")
            cur.execute(
                "INSERT INTO students (matric_number, full_name, embedding, consent_given_at, consent_version, high_similarity_flag) "
                "VALUES ('22/01DL888', 'Behavior Tester', %s, NOW(), '1.0', TRUE)",
                ([0.1] * 1024,)
            )
            conn.commit()
            cur.close()
        finally:
            release_connection(conn)

        # 1. Update profile
        profile = {
            "keystroke": {"meanDwell": 120.5, "meanFlight": 150.2},
            "touch": [1.2, 2.3, 3.4],
            "motion": [0.1, -0.2, 0.5]
        }
        resp = client.put("/enroll/behavioural", json={
            "matric_number": "22/01DL888",
            "token": "test_token_behavioural",
            "behavioural_profile": profile
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        # 2. Get profile
        resp_get = client.get("/students/22/01DL888/behavioural")
        assert resp_get.status_code == 200
        data = resp_get.json()
        assert data["matric_number"] == "22/01DL888"
        assert data["behavioural_profile"] == profile

        # Clean up database
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM students WHERE matric_number = '22/01DL888'")
            cur.execute("DELETE FROM enrollment_tokens WHERE token = 'test_token_behavioural'")
            conn.commit()
            cur.close()
        finally:
            release_connection(conn)

    def test_get_behavioural_profile_not_found(self, client):
        """GET /students/{matric}/behavioural for non-existent student -> 404."""
        resp = client.get("/students/NONEXISTENT_MATRIC/behavioural")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()
