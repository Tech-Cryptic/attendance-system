"""
Shared pytest fixtures for FaceAttend test suite.

Usage:
    cd backend
    .\\venv\\Scripts\\Activate.ps1
    pip install pytest httpx pytest-asyncio
    pytest tests/ -v

Environment:
    Set TEST_DATABASE_URL in your .env to a separate test database.
    If not set, tests will mock the DB layer.
"""
import os
import pytest
from fastapi.testclient import TestClient

# ── App import ────────────────────────────────────────────────────
from app.main import app

# ── Test client (synchronous) ─────────────────────────────────────
@pytest.fixture(scope="session")
def client():
    """Create a ASGI TestClient for the whole test session."""
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


# ── Auth helpers ──────────────────────────────────────────────────
ADMIN_EMAIL    = os.getenv("TEST_ADMIN_EMAIL",    "admin@test.unilorin.edu.ng")
ADMIN_PASSWORD = os.getenv("TEST_ADMIN_PASSWORD", "AdminPass123!")
LECTURER_EMAIL    = os.getenv("TEST_LECTURER_EMAIL",    "lecturer@test.unilorin.edu.ng")
LECTURER_PASSWORD = os.getenv("TEST_LECTURER_PASSWORD", "LecturerPass123!")
STUDENT_EMAIL    = os.getenv("TEST_STUDENT_EMAIL",    "student@test.unilorin.edu.ng")
STUDENT_PASSWORD = os.getenv("TEST_STUDENT_PASSWORD", "StudentPass123!")


@pytest.fixture(scope="session")
def admin_token(client):
    """Return a valid admin JWT for use in tests."""
    resp = client.post("/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    })
    if resp.status_code != 200:
        pytest.skip(f"Admin login failed ({resp.status_code}): {resp.text}")
    return resp.json()["access_token"]


@pytest.fixture(scope="session")
def lecturer_token(client):
    """Return a valid lecturer JWT for use in tests."""
    resp = client.post("/auth/login", json={
        "email": LECTURER_EMAIL,
        "password": LECTURER_PASSWORD,
    })
    if resp.status_code != 200:
        pytest.skip(f"Lecturer login failed ({resp.status_code}): {resp.text}")
    return resp.json()["access_token"]


@pytest.fixture(scope="session")
def student_token(client):
    """Return a valid student JWT for use in tests."""
    resp = client.post("/auth/login", json={
        "email": STUDENT_EMAIL,
        "password": STUDENT_PASSWORD,
    })
    if resp.status_code != 200:
        pytest.skip(f"Student login failed ({resp.status_code}): {resp.text}")
    return resp.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
