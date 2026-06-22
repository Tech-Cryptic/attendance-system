"""
Tests for admin management endpoints:
  GET  /admin/students
  GET  /admin/courses
  POST /admin/courses
  GET  /admin/lecturers
  POST /admin/tokens
  GET  /admin/export/attendance.csv
  GET  /admin/export/students.csv
"""
import pytest
from .conftest import auth_header

TEST_COURSE_CODE  = "TST999"
TEST_COURSE_TITLE = "Test Course — Pytest"


class TestAdminStudents:
    def test_students_requires_admin(self, client, student_token):
        """Student cannot list all students → 403."""
        resp = client.get("/admin/students", headers=auth_header(student_token))
        assert resp.status_code == 403

    def test_students_requires_auth(self, client):
        """No token → 401/403."""
        resp = client.get("/admin/students")
        assert resp.status_code in (401, 403)

    def test_students_admin_ok(self, client, admin_token):
        """Admin can list students → 200, list."""
        resp = client.get("/admin/students", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_students_response_shape(self, client, admin_token):
        """Each student record has the expected keys."""
        resp = client.get("/admin/students", headers=auth_header(admin_token))
        assert resp.status_code == 200
        students = resp.json()
        if students:
            keys = students[0].keys()
            assert "matric_number" in keys
            assert "full_name" in keys
            assert "enrolled_at" in keys
            assert "high_similarity_flag" in keys


class TestAdminCourses:
    def test_courses_list(self, client, admin_token):
        """Admin can list courses."""
        resp = client.get("/admin/courses", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_courses_lecturer_can_read(self, client, lecturer_token):
        """Lecturer can read course list."""
        resp = client.get("/admin/courses", headers=auth_header(lecturer_token))
        assert resp.status_code == 200

    def test_create_course_admin(self, client, admin_token):
        """Admin can create a course."""
        resp = client.post("/admin/courses",
            headers=auth_header(admin_token),
            json={"course_code": TEST_COURSE_CODE, "course_title": TEST_COURSE_TITLE}
        )
        # 201 created or 409 if already exists (idempotent re-run)
        assert resp.status_code in (201, 409)
        if resp.status_code == 201:
            data = resp.json()
            assert data["course_code"] == TEST_COURSE_CODE
            assert data["course_title"] == TEST_COURSE_TITLE

    def test_create_course_student_forbidden(self, client, student_token):
        """Student cannot create a course → 403."""
        resp = client.post("/admin/courses",
            headers=auth_header(student_token),
            json={"course_code": "BAD001", "course_title": "Bad"}
        )
        assert resp.status_code == 403

    def test_create_course_missing_fields(self, client, admin_token):
        """Missing required fields → 422 validation error."""
        resp = client.post("/admin/courses",
            headers=auth_header(admin_token),
            json={"course_code": "MISSING"}  # no course_title
        )
        assert resp.status_code == 422


class TestAdminLecturers:
    def test_lecturers_admin_only(self, client, lecturer_token):
        """Non-admin cannot access lecturers list → 403."""
        resp = client.get("/admin/lecturers", headers=auth_header(lecturer_token))
        assert resp.status_code == 403

    def test_lecturers_list(self, client, admin_token):
        """Admin gets lecturer list."""
        resp = client.get("/admin/lecturers", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestAdminTokens:
    def test_create_token_invalid_course(self, client, admin_token):
        """Token for non-existent course → 404."""
        resp = client.post("/admin/tokens",
            headers=auth_header(admin_token),
            json={"course_code": "NONEXIST999", "expires_in_hours": 24}
        )
        assert resp.status_code == 404

    def test_create_token_valid_course(self, client, admin_token):
        """Admin can create a token for an existing course."""
        # First ensure course exists
        client.post("/admin/courses",
            headers=auth_header(admin_token),
            json={"course_code": TEST_COURSE_CODE, "course_title": TEST_COURSE_TITLE}
        )
        resp = client.post("/admin/tokens",
            headers=auth_header(admin_token),
            json={"course_code": TEST_COURSE_CODE, "expires_in_hours": 24}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert len(data["token"]) > 10

    def test_create_token_student_forbidden(self, client, student_token):
        """Student cannot issue tokens → 403."""
        resp = client.post("/admin/tokens",
            headers=auth_header(student_token),
            json={"course_code": TEST_COURSE_CODE, "expires_in_hours": 24}
        )
        assert resp.status_code == 403


class TestExport:
    def test_attendance_export_admin(self, client, admin_token):
        """Attendance CSV export returns text/csv."""
        resp = client.get("/admin/export/attendance.csv",
                          headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_students_export_admin(self, client, admin_token):
        """Students CSV export returns text/csv."""
        resp = client.get("/admin/export/students.csv",
                          headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_export_requires_auth(self, client):
        """Export without auth → 401/403."""
        resp = client.get("/admin/export/attendance.csv")
        assert resp.status_code in (401, 403)

    def test_attendance_csv_has_header(self, client, admin_token):
        """CSV has correct column headers in first row."""
        resp = client.get("/admin/export/attendance.csv",
                          headers=auth_header(admin_token))
        assert resp.status_code == 200
        first_line = resp.text.split("\n")[0]
        assert "Matric Number" in first_line
        assert "Course Code" in first_line
