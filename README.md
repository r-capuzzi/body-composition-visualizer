# Body Composition Visualizer

Project how your weight, body fat, and muscle mass change over a fitness plan,
and see the result on a 3D avatar that morphs to match — week by week, via a
timeline scrubber.

Enter your stats and a plan (calories, training frequency, protein intake,
duration), and the app projects three scenarios (expected / conservative /
optimistic) using a physiology model grounded in real research (Mifflin-St
Jeor/Katch-McArdle BMR, energy partitioning, metabolic adaptation — see
`backend/calculations.py` for sourced constants). The 3D avatar is built from
real MakeHuman-exported meshes with muscle/fat morph targets, and supports
optional tape-measurement overrides (shoulder, chest, waist, hip, arm) that
reshape specific regions while keeping the body smooth and anatomically
coherent.

## Architecture

- **`backend/`** — FastAPI service. Takes your stats and plan, runs the
  week-by-week physiology simulation, returns the three projected scenarios
  plus plan-health warnings. Pure Python, no database.
- **`frontend/`** — React 19 + Vite SPA. Form + charts + the Three.js
  (`@react-three/fiber`) 3D avatar. Talks to the backend over HTTP.

## Quick start

**Backend** (from `backend/`, with a Python venv active):

```bash
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Runs on `http://localhost:8000` (docs at `/docs`). Set `ALLOWED_ORIGINS` to
add a deployed frontend origin to CORS — see `backend/.env.example`.

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev
```

Runs on `http://localhost:3000` (pinned so it matches the backend's default
CORS allowlist). Set `VITE_API_BASE` to point at a deployed backend — see
`frontend/.env.example`. More detail, including how to rebuild the 3D body
assets from MakeHuman exports, is in [`frontend/README.md`](frontend/README.md).

## Tests

```bash
cd backend && python -m pytest -q
cd frontend && npm test
```

## Tech stack

FastAPI · Pydantic · React · Vite · Three.js / React Three Fiber / drei ·
Recharts · Vitest
