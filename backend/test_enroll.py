import requests
import random

BASE = "http://127.0.0.1:8000"

r = requests.post(f"{BASE}/admin/courses", json={
    "course_code": "CSC401",
    "course_title": "Final Year Project"
})
print("Course:", r.status_code, r.json())

r = requests.post(f"{BASE}/admin/tokens", json={
    "course_code": "CSC401",
    "expires_in_hours": 24
})
print("Token:", r.status_code, r.json())
token = r.json()["token"]

test_embedding = [round(random.uniform(-1, 1), 4) for _ in range(1024)]

r = requests.post(f"{BASE}/enroll", json={
    "matric_number": "22/01DL068",
    "full_name": "Awoyemi Gabriel Oluwaseun",
    "token": token,
    "embedding": test_embedding,
    "consent_given": True,
    "consent_version": "1.0"
})
print("Enroll:", r.status_code, r.json())