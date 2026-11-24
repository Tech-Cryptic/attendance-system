# FaceAttend

Biometric attendance with offline presence evidence, lecturer-managed exemptions, and advisory LLM review.

Live app: https://faceattend-bc91.onrender.com

## Features

- On-device face enrollment and liveness checks; raw frames stay in the browser.
- Signed session, checkpoint, and check-out QR codes.
- Offline evidence queue in IndexedDB with idempotent sync.
- Server-owned outcomes: `present`, `left_early`, `absent`, `exempted`, `pending_review`.
- One-time lecturer exemption links bound to a student and session.
- Human-approved LLM review for ambiguous evidence; deterministic fallback when no API key is configured.
- Admin CSV exports and lecturer/session dashboards.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@unilorin.edu.ng` | `Admin1234!` |
| Lecturer | `lecturer@unilorin.edu.ng` | `Lecturer1234!` |
| Student | `student@unilorin.edu.ng` | `Student1234!` |

The student account must complete biometric enrollment before regular attendance scans.

## Local setup

Requirements: Python 3.11+, Node.js 20+, and PostgreSQL.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
python seed.py
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm ci
cp .env.example .env.local      # set VITE_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:5173.

## Tests and checks

```bash
cd backend
python -m pytest -q
```

```bash
cd frontend
npm run lint
npm run build
```

## Environment

Backend variables are documented in `backend/.env.example`:

- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET`, `HMAC_KEY` — generated secrets; never commit real values.
- `JWT_ALGORITHM`, `JWT_EXPIRY_MINUTES` — token settings.
- `CORS_ORIGINS` — comma-separated browser origins.
- `FRONTEND_URL` — base URL used in exemption links.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` — optional LLM review settings.
- `SHOW_SEED_SUMMARY` — set to `0` in production to keep demo credentials and enrollment tokens out of startup logs.

Frontend uses `VITE_API_URL` for local development. In production it is unset so the API shares the deployed origin.

## Deployment

`render.yaml` defines a Render web service and PostgreSQL database. The build installs frontend dependencies, builds the React/PWA bundle, and installs backend dependencies. Startup runs `seed.py` before Uvicorn.

`render.yaml` uses the branch configured in the Render dashboard. The service does not deploy from an open pull request automatically.

## Documentation

- `docs/ATTENDANCE_POLICY.md` — presence rules, exemption flow, LLM review, and API summary.
- `backend/migrations/` — idempotent SQL migrations applied by `seed.py`.
