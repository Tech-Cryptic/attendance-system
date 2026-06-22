"""
Tests for attendance and session endpoints:
  POST /sessions              (create session)
  GET  /sessions/{id}         (get session detail)
  POST /sessions/{id}/end     (end session)
  POST /attendance/mark       (mark attendance)
  POST /attendance/sync       (batch sync)
  GET  /student/attendance    (student's own history)
  GET  /lecturer/sessions     (lecturer session list)
  GET  /lecturer/courses      (lecturer course list)
  GET  /courses/{code}/embeddings  (pre-cache embeddings)
"""
import pytest
from .conftest import auth_header

FAKE_COURSE_CODE = "TST999"

# A dummy 1024-dim embedding (all 0.1) — won't match any real student
DUMMY_EMBEDDING = [0.1] * 1024


class TestSessionCreate:
    def test_create_session_requires_lecturer(self, client, student_token):
        """Students cannot create sessions → 403."""
        resp = client.post("/sessions",
            headers=auth_header(student_token),
            json={"course_code": FAKE_COURSE_CODE, "duration_minutes": 10}
        )
        assert resp.status_code == 403

    def test_create_session_nonexistent_course(self, client, lecturer_token):
        """Session for non-existent course → 404."""
        resp = client.post("/sessions",
            headers=auth_header(lecturer_token),
            json={"course_code": "NONEXIST", "duration_minutes": 10}
        )
        assert resp.status_code == 404

    def test_create_session_duration_constraints(self, client, lecturer_token):
        """Duration must be between 10–480 min — below 10 → 422."""
        resp = client.post("/sessions",
            headers=auth_header(lecturer_token),
            json={"course_code": FAKE_COURSE_CODE, "duration_minutes": 5}  # below minimum
        )
        assert resp.status_code == 422

    def test_create_session_valid(self, client, lecturer_token, admin_token):
        """Create a valid session → 200, returns signed QR payload."""
        # Ensure course exists
        client.post("/admin/courses",
            headers=auth_header(admin_token),
            json={"course_code": FAKE_COURSE_CODE, "course_title": "Test Course"}
        )
        resp = client.post("/sessions",
            headers=auth_header(lecturer_token),
            json={"course_code": FAKE_COURSE_CODE, "duration_minutes": 10}
        )
        if resp.status_code == 404:
            pytest.skip("Test course not found — DB may not have lecturer assigned")
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert "qr_payload" in data
        assert "qr_signature" in data
        assert "expires_at" in data
        return data  # used by downstream tests


class TestSessionGet:
    def test_get_session_not_found(self, client, admin_token):
        """Non-existent session → 404."""
        resp = client.get("/sessions/00000000-0000-0000-0000-000000000000",
                          headers=auth_header(admin_token))
        assert resp.status_code == 404

    def test_get_session_requires_auth(self, client):
        """No auth → 401/403."""
        resp = client.get("/sessions/00000000-0000-0000-0000-000000000000")
        assert resp.status_code in (401, 403)


class TestAttendanceMark:
    def test_mark_invalid_qr_signature(self, client):
        """Tampered QR → 403."""
        resp = client.post("/attendance/mark", json={
            "session_id": "00000000-0000-0000-0000-000000000000",
            "qr_payload": "tampered_payload",
            "qr_signature": "not_a_real_signature",
            "embedding": DUMMY_EMBEDDING,
            "method": "face",
        })
        assert resp.status_code == 403

    def test_mark_missing_embedding(self, client):
        """Missing embedding → 422 validation error."""
        resp = client.post("/attendance/mark", json={
            "session_id": "00000000-0000-0000-0000-000000000000",
            "qr_payload": "p",
            "qr_signature": "s",
            # embedding missing
        })
        assert resp.status_code == 422

    def test_mark_wrong_embedding_length(self, client):
        """Embedding with wrong dimension → 422."""
        resp = client.post("/attendance/mark", json={
            "session_id": "some-id",
            "qr_payload": "p",
            "qr_signature": "s",
            "embedding": [0.1] * 512,  # wrong — must be 1024
        })
        assert resp.status_code == 422


class TestStudentAttendance:
    def test_student_history_requires_auth(self, client):
        """/student/attendance without auth → 401/403."""
        resp = client.get("/student/attendance")
        assert resp.status_code in (401, 403)

    def test_student_history_ok(self, client, student_token):
        """Student can fetch their own attendance history."""
        resp = client.get("/student/attendance", headers=auth_header(student_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_student_history_shape(self, client, student_token):
        """Each attendance record has expected fields."""
        resp = client.get("/student/attendance", headers=auth_header(student_token))
        records = resp.json()
        if records:
            keys = records[0].keys()
            assert "course_code" in keys
            assert "matched_at" in keys
            assert "similarity_distance" in keys

    def test_lecturer_cannot_view_student_history(self, client, lecturer_token):
        """Lecturer is not allowed on student-only endpoint → 403."""
        resp = client.get("/student/attendance", headers=auth_header(lecturer_token))
        assert resp.status_code == 403


class TestLecturerEndpoints:
    def test_lecturer_sessions_list(self, client, lecturer_token):
        """Lecturer can fetch their session list."""
        resp = client.get("/lecturer/sessions", headers=auth_header(lecturer_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_lecturer_courses_list(self, client, lecturer_token):
        """Lecturer can fetch their course list."""
        resp = client.get("/lecturer/courses", headers=auth_header(lecturer_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_student_cannot_view_lecturer_sessions(self, client, student_token):
        """Student → 403 on lecturer endpoint."""
        resp = client.get("/lecturer/sessions", headers=auth_header(student_token))
        assert resp.status_code == 403


class TestCourseEmbeddings:
    def test_embeddings_requires_auth(self, client):
        """/courses/{code}/embeddings without auth → 401/403."""
        resp = client.get(f"/courses/{FAKE_COURSE_CODE}/embeddings")
        assert resp.status_code in (401, 403)

    def test_embeddings_returns_list(self, client, lecturer_token):
        """Authenticated request returns embeddings structure."""
        resp = client.get(f"/courses/{FAKE_COURSE_CODE}/embeddings",
                          headers=auth_header(lecturer_token))
        # 200 with empty list OR 404 if course doesn't exist in test DB
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            data = resp.json()
            assert "course_code" in data
            assert "embeddings" in data
            assert isinstance(data["embeddings"], list)


class TestSyncBatch:
    def test_sync_empty_batch(self, client):
        """Empty records list → accepted, returns 0 synced."""
        resp = client.post("/attendance/sync", json={
            "records": [],
            "client_uuid": "test-client-001"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["synced"] == 0
        assert data["failed"] == 0

    def test_sync_invalid_records(self, client):
        """Records with tampered QR → all fail gracefully."""
        resp = client.post("/attendance/sync", json={
            "client_uuid": "test-client-001",
            "records": [{
                "session_id": "00000000-0000-0000-0000-000000000000",
                "qr_payload": "bad_payload",
                "qr_signature": "bad_sig",
                "embedding": DUMMY_EMBEDDING,
                "method": "face",
                "synced_from_client": True,
            }]
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert data["synced"] == 0


class TestHealthAndRoot:
    def test_root_endpoint(self, client):
        """Root endpoint returns system info."""
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "system" in data
        assert "status" in data

    def test_health_endpoint(self, client):
        """Health endpoint returns status."""
        resp = client.get("/health")
        assert resp.status_code == 200
        assert "status" in resp.json()
