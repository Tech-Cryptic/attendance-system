# FaceAttend frontend

React/PWA client for FaceAttend. Setup, environment variables, and deployment notes are in the [root README](../README.md).

Local development:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` in `.env.local`. In production, leave it unset so requests use the same origin as the FastAPI app.
