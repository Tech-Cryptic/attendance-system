from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import os
from dotenv import load_dotenv
from app.db.database import test_connection
from app.routes import enroll
from app.routes import attendance
from app.routes import admin
from app.routes import batch_attendance
from app.auth import router as auth_router

load_dotenv()

app = FastAPI(
    title="FaceAttend API — Unilorin Biometric Attendance",
    description="Offline-first AI facial recognition attendance system. NDPA 2023 compliant. Multi-face proximity-batch scanning.",
    version="2.0.0"
)

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174").split(",")

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
app.include_router(batch_attendance.router)
app.include_router(admin.router)
app.include_router(admin.lecturer_router)


@app.get("/health")
def health_check():
    try:
        db_version = test_connection()
        return {"status": "ok", "database": db_version}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/debug/seed")
def debug_seed():
    import subprocess
    try:
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        res = subprocess.run(
            ["python", "seed.py"],
            capture_output=True,
            text=True,
            cwd=backend_dir
        )
        return {
            "status": "completed",
            "returncode": res.returncode,
            "stdout": res.stdout,
            "stderr": res.stderr
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


# ── Serve React build (production only) ───────────────────────
# When deployed on Render, the build step places the compiled
# frontend in /frontend/dist relative to the repo root.
# FastAPI serves those files as static assets and falls back to
# index.html for any path that isn't an API route, so React
# Router can handle client-side navigation.
_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if _DIST.exists():
    # Static assets (JS, CSS, icons, model weights …)
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    # Every non-API, non-asset path → index.html (SPA fallback)
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, request: Request):
        index = _DIST / "index.html"
        return FileResponse(str(index))
else:
    # Local dev: keep the old JSON root so /docs still works
    @app.get("/")
    def root():
        return {
            "system":      "FaceAttend — Offline-First Biometric Attendance",
            "institution": "University of Ilorin",
            "status":      "running (dev mode — no frontend build)",
            "version":     "2.0.0",
        }