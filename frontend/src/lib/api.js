/**
 * api.js — Centralised API base URL
 *
 * Rules:
 *   - Local dev  → VITE_API_URL env var (set in .env.local to http://localhost:8000)
 *   - Production → empty string "" (same origin — frontend served by FastAPI)
 *
 * Using an empty string means every fetch("/some/route") goes to the same
 * host the page was loaded from, with no CORS overhead.
 */

// In production (Render), VITE_API_URL is intentionally NOT set,
// so import.meta.env.VITE_API_URL is undefined → we fall back to "".
export const API_BASE = import.meta.env.VITE_API_URL ?? ''
