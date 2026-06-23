#!/usr/bin/env bash
# start.sh — Render startup script (free tier compatible)
# Runs on every deploy. All steps are idempotent (safe to repeat).
set -e

echo ""
echo "========================================"
echo "  FaceAttend — Startup"
echo "========================================"

# 1. Apply schema (CREATE TABLE IF NOT EXISTS — safe to repeat)
echo "[1/3] Applying database schema..."
psql "$DATABASE_URL" -f schema.sql
echo "      Schema OK"

# 2. Seed default accounts (skips if they already exist)
echo "[2/3] Seeding default accounts..."
python seed.py
echo "      Seed OK"

# 3. Start the FastAPI server
echo "[3/3] Starting uvicorn..."
echo "========================================"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
