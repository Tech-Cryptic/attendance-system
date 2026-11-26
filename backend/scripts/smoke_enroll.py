import os
import random

import requests

BASE = "http://127.0.0.1:8000"


def _fail(label, response):
    print(f"{label} failed with status {response.status_code}")
    raise SystemExit(1)


admin_email = os.getenv("SMOKE_ADMIN_EMAIL")
admin_password = os.getenv("SMOKE_ADMIN_PASSWORD")

if not admin_email or not admin_password:
    print("SKIP: set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD to run the enrollment smoke test")
    raise SystemExit(0)

r = requests.post(f"{BASE}/auth/login", json={
    "email": admin_email,
    "password": admin_password,
})
print("Admin login:", r.status_code)

if r.status_code != 200:
    _fail("Admin login", r)

headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
suffix = random.randint(1000, 9999)
course_code = f"SMK{suffix}"
matric = f"22/01DL{suffix}"
student_email = f"student.smoke{suffix}@unilorin.edu.ng"

r = requests.post(f"{BASE}/admin/courses", headers=headers, json={
    "course_code": course_code,
    "course_title": "Enrollment Smoke Test",
    "matric_list": [matric],
})
print("Course:", r.status_code)

if r.status_code not in (200, 201):
    _fail("Course", r)

r = requests.post(f"{BASE}/admin/tokens", headers=headers, json={
    "course_code": course_code,
    "matric_number": matric,
    "expires_in_hours": 24,
})
print("Token:", r.status_code)

if r.status_code not in (200, 201):
    _fail("Token", r)

token = r.json()["token"]
test_embedding = [round(random.uniform(-1, 1), 4) for _ in range(1024)]

r = requests.post(f"{BASE}/enroll", json={
    "matric_number": matric,
    "full_name": "Enrollment Smoke Student",
    "email": student_email,
    "password": "SmokeTest123!",
    "token": token,
    "embedding": test_embedding,
    "consent_given": True,
    "consent_version": "1.0",
})
print("Enroll:", r.status_code)

if r.status_code != 200:
    _fail("Enroll", r)

r = requests.post(f"{BASE}/auth/login", json={
    "email": student_email,
    "password": "SmokeTest123!",
})
print("Student login:", r.status_code)

if r.status_code != 200:
    _fail("Student login", r)
