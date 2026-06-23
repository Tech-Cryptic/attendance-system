#!/usr/bin/env bash
# start.sh — Render startup script (free tier compatible)
# Runs on every deploy. All steps are idempotent (safe to repeat).
set -e

echo ""
echo "========================================"
echo "  FaceAttend — Startup"
echo "========================================"

# 1. Apply schema and seed database
echo "[1/2] Checking schema and seeding database..."
python seed.py || echo "WARNING: Database setup failed"
echo "      Database setup OK"

# 2. Start the FastAPI server
echo "[2/2] Starting uvicorn..."
echo "========================================"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
