from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from app.db.database import test_connection
from app.routes import enroll
from app.routes import attendance
from app.routes import admin
from app.auth import router as auth_router

load_dotenv()

app = FastAPI(
    title="FaceAttend API — Unilorin Biometric Attendance",
    description="Offline-first AI facial recognition attendance system. NDPR 2019 compliant.",
    version="1.0.0"
)

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(enroll.router)
app.include_router(attendance.router)
app.include_router(admin.router)
app.include_router(admin.lecturer_router)


@app.get("/")
def root():
    return {
        "system":      "FaceAttend — Offline-First Biometric Attendance",
        "institution": "University of Ilorin",
        "status":      "running",
        "version":     "1.0.0"
    }


@app.get("/health")
def health_check():
    try:
        db_version = test_connection()
        return {"status": "ok", "database": db_version}
    except Exception as e:
        return {"status": "error", "detail": str(e)}