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


def parse_allowed_origins(raw: str) -> list[str]:
    """Comma-separated origins -> the exact strings CORS compares against.

    A browser's Origin header is scheme+host+port with no trailing slash, and
    CORSMiddleware matches it exactly. So "https://a.com, https://b.com" (a
    space after the comma) silently blocked b.com, and "https://a.com/" (easy to
    paste straight from the address bar) blocked a.com. Neither shows up in curl
    or in tests - only in a browser, where it surfaces as "could not reach the
    calculation server", pointing at the network instead of the config.
    """
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


# The React dev server (or deployed frontend) runs on a different origin than
# the API, so the browser blocks requests unless the API opts in via CORS
# headers. Origins are env-configurable so a deployment doesn't have to ship
# with a hardcoded localhost allowlist.
allowed_origins = parse_allowed_origins(
    os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
)
# Optional, for origins that can't be listed ahead of time - chiefly Vercel's
# per-deployment preview URLs (<project>-<hash>-<scope>.vercel.app), which a
# fixed list can never keep up with; without this every PR preview's requests
# were blocked and it rendered no projection at all. This API is public and
# stateless - no credentials, no user data - so CORS here decides which sites'
# browsers may read its responses, not who can use it (curl always could).
allowed_origin_regex = os.getenv("ALLOWED_ORIGIN_REGEX") or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_content_sniffing(request, call_next):
    # Stops a browser from second-guessing Content-Type - relevant here because
    # this serves HTML (/docs) as well as JSON. Render adds no such headers.
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


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
