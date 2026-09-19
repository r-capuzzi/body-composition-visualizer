"""
FastAPI application – the thin web layer.

All it does is: accept a validated CalculateRequest, hand it to
projection.build_projection, and return the CalculateResponse. No physiology
logic lives here.

Run it (from the backend/ folder, with the venv active):
    python -m uvicorn main:app --reload          # local dev
    python -m uvicorn main:app --host 0.0.0.0 --port $PORT   # deployed
Then open http://localhost:8000/docs for the interactive API explorer.

Set ALLOWED_ORIGINS to a comma-separated list of allowed frontend origins in
deployment (e.g. "https://bodycomp.example.com"); it defaults to the Vite dev
server's origin so local dev works with no setup.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import CalculateRequest, CalculateResponse
from projection import build_projection

app = FastAPI(title="Body Composition Visualizer API", version="0.1.0")

# The React dev server (or deployed frontend) runs on a different origin than
# the API, so the browser blocks requests unless the API opts in via CORS
# headers. Origins are env-configurable so a deployment doesn't have to ship
# with a hardcoded localhost allowlist.
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.api_route("/", methods=["GET", "HEAD"])
def health() -> dict:
    """Cheap endpoint to confirm the server is up.

    HEAD is registered alongside GET because uptime monitors (and Render's own
    probe) default to HEAD, and FastAPI's @app.get does not imply it - a plain
    @app.get("/") answers HEAD with 405, which reads as an outage.
    """
    return {"status": "ok"}


@app.post("/calculate", response_model=CalculateResponse)
def calculate(req: CalculateRequest) -> CalculateResponse:
    # FastAPI has already validated `req`; build_projection does everything and
    # returns a CalculateResponse, which FastAPI serialises to JSON.
    return build_projection(req)
