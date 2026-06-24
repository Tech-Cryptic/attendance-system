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


class TestAdminUsers:
    def test_users_requires_admin(self, client, student_token):
        """Student cannot list users -> 403."""
        resp = client.get("/admin/users", headers=auth_header(student_token))
        assert resp.status_code == 403

    def test_users_list_admin_ok(self, client, admin_token):
        """Admin can list users."""
        resp = client.get("/admin/users", headers=auth_header(admin_token))
        assert resp.status_code == 200
        users = resp.json()
        assert isinstance(users, list)
        if users:
            keys = users[0].keys()
            assert "id" in keys
            assert "email" in keys
            assert "role" in keys
            assert "full_name" in keys
            assert "password_hash" not in keys  # security check

    def test_delete_user_self_forbidden(self, client, admin_token):
        """Admin cannot delete their own account."""
        me_resp = client.get("/auth/me", headers=auth_header(admin_token))
        admin_id = me_resp.json()["sub"]
        
        resp = client.delete(f"/admin/users/{admin_id}", headers=auth_header(admin_token))
        assert resp.status_code == 400
        assert "cannot delete their own account" in resp.json()["detail"]

    def test_delete_user_lecturer(self, client, admin_token):
        """Admin can delete a lecturer account, course assignment set to null."""
        reg_resp = client.post("/auth/register",
            headers=auth_header(admin_token),
            json={
                "email": "temp_lec@unilorin.edu.ng",
                "password": "TempLecturer123!",
                "full_name": "Temporary Lecturer",
                "role": "lecturer"
            }
        )
        assert reg_resp.status_code == 201
        lec_id = reg_resp.json()["id"]

        course_code = "TMP888"
        c_resp = client.post("/admin/courses",
            headers=auth_header(admin_token),
            json={
                "course_code": course_code,
                "course_title": "Temporary Course",
                "lecturer_id": lec_id
            }
        )
        assert c_resp.status_code == 201

        del_resp = client.delete(f"/admin/users/{lec_id}", headers=auth_header(admin_token))
        assert del_resp.status_code == 204

        courses_resp = client.get("/admin/courses", headers=auth_header(admin_token))
        tmp_course = next((c for c in courses_resp.json() if c["course_code"] == course_code), None)
        assert tmp_course is not None
        assert tmp_course["lecturer_name"] == "Not Assigned"
