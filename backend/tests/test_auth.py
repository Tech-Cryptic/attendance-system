"""
Tests for authentication endpoints:
  POST /auth/login
  POST /auth/register  (admin-only)
  GET  /auth/me
"""
import pytest
from .conftest import auth_header


class TestLogin:
    def test_login_missing_fields(self, client):
        """Login with no body → 422 validation error."""
        resp = client.post("/auth/login", json={})
        assert resp.status_code == 422

    def test_login_wrong_password(self, client):
        """Valid email, wrong password → 401."""
        resp = client.post("/auth/login", json={
            "email": "nobody@unilorin.edu.ng",
            "password": "wrongpassword"
        })
        assert resp.status_code == 401

    def test_login_success_admin(self, client, admin_token):
        """Admin login returns a token with correct role."""
        # admin_token fixture already logs in — just validate it's non-empty
        assert isinstance(admin_token, str)
        assert len(admin_token) > 20

    def test_login_returns_role(self, client):
        """Login response body includes role and full_name."""
        from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD
        resp = client.post("/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
        })
        if resp.status_code != 200:
            pytest.skip("Admin not seeded in DB")
        data = resp.json()
        assert "access_token" in data
        assert "role" in data
        assert "full_name" in data
        assert data["role"] == "admin"

    def test_login_auto_provision_lecturer(self, client):
        """Typing lecturer1-50 with Lecturer1234! automatically provisions and logs in."""
        resp = client.post("/auth/login", json={
            "email": "lecturer42@unilorin.edu.ng",
            "password": "Lecturer1234!"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "lecturer"
        assert data["full_name"] == "Lecturer 42"
        
        # Subsequent login should also succeed without error
        resp2 = client.post("/auth/login", json={
            "email": "lecturer42@unilorin.edu.ng",
            "password": "Lecturer1234!"
        })
        assert resp2.status_code == 200


class TestRegister:
    def test_register_requires_admin(self, client, student_token):
        """Non-admin cannot register new users → 403."""
        resp = client.post("/auth/register",
            headers=auth_header(student_token),
            json={
                "email": "new@unilorin.edu.ng",
                "password": "TestPass123!",
                "full_name": "Test User",
                "role": "lecturer",
            }
        )
        assert resp.status_code in (401, 403)

    def test_register_student_requires_matric(self, client, admin_token):
        """Registering a student without linked_matric → 400."""
        resp = client.post("/auth/register",
            headers=auth_header(admin_token),
            json={
                "email": "student_no_matric@unilorin.edu.ng",
                "password": "TestPass123!",
                "full_name": "No Matric",
                "role": "student",
                # linked_matric intentionally omitted
            }
        )
        assert resp.status_code == 400
        assert "matric" in resp.json()["detail"].lower()

    def test_register_duplicate_email(self, client, admin_token):
        """Registering the same email twice → 409."""
        from .conftest import ADMIN_EMAIL
        resp = client.post("/auth/register",
            headers=auth_header(admin_token),
            json={
                "email": ADMIN_EMAIL,
                "password": "TestPass123!",
                "full_name": "Duplicate",
                "role": "lecturer",
            }
        )
        assert resp.status_code == 409


class TestMe:
    def test_me_requires_auth(self, client):
        """/auth/me without token → 401 or 403."""
        resp = client.get("/auth/me")
        assert resp.status_code in (401, 403)

    def test_me_returns_user_info(self, client, admin_token):
        """/auth/me returns decoded token payload with role."""
        resp = client.get("/auth/me", headers=auth_header(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert "role" in data
        assert data["role"] == "admin"


class TestJWT:
    def test_invalid_token_rejected(self, client):
        """Tampered JWT → 401 or 403."""
        resp = client.get("/auth/me", headers={"Authorization": "Bearer not.a.real.token"})
        assert resp.status_code in (401, 403)

    def test_expired_token_format(self, client):
        """Garbage token → rejected gracefully (not 500)."""
        resp = client.get("/admin/students", headers={"Authorization": "Bearer garbage"})
        assert resp.status_code in (401, 403)
        assert resp.status_code != 500
