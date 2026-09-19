"""
HTTP-level tests for main.py, via FastAPI's TestClient.
Run from the backend/ folder:  python -m pytest -q

test_projection.py and test_calculations.py already cover the projection math
in depth by calling build_projection() directly; these tests only cover the
web layer on top of it - routing, status codes and request validation - which
nothing else exercises.
"""

from fastapi.testclient import TestClient

from main import app, parse_allowed_origins

client = TestClient(app)


def valid_payload(**overrides) -> dict:
    payload = dict(
        sex="male",
        age_years=30,
        height_cm=180.0,
        weight_kg=85.0,
        body_fat_pct=22.0,
        activity_level="moderate",
        training_experience="intermediate",
        training_frequency_per_week=3,
        protein_g_per_kg=2.0,
        planned_daily_calories=2400,
        plan_duration_weeks=16,
    )
    payload.update(overrides)
    return payload


def test_health_check():
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_allowed_origins_tolerates_natural_formatting():
    # Both of these used to produce an origin that could never match a
    # browser's Origin header, blocking the frontend with no server-side error.
    assert parse_allowed_origins("https://a.com, https://b.com") == [
        "https://a.com",
        "https://b.com",
    ]
    assert parse_allowed_origins("https://a.com/") == ["https://a.com"]
    assert parse_allowed_origins("https://a.com,,") == ["https://a.com"]


def test_origin_regex_lets_preview_deployments_through(monkeypatch):
    """Vercel gives every deployment its own URL, so a fixed allowlist blocked
    all PR previews. ALLOWED_ORIGIN_REGEX admits them - and only them."""
    import importlib

    import main as main_module

    # Vercel's two preview forms: <project>-<hash>-<scope> per deployment, and
    # <project>-git-<branch>-<scope> per branch.
    monkeypatch.setenv(
        "ALLOWED_ORIGIN_REGEX",
        r"https://body-composition-visualizer-(git-[a-z0-9-]+|[a-z0-9]+)-rcapuzzi\.vercel\.app",
    )
    try:
        preview_client = TestClient(importlib.reload(main_module).app)

        def allowed(origin):
            r = preview_client.options(
                "/calculate",
                headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
            )
            return r.headers.get("access-control-allow-origin") == origin

        assert allowed("https://body-composition-visualizer-elgrofsuf-rcapuzzi.vercel.app")
        assert allowed(
            "https://body-composition-visualizer-git-fix-edge-cases-accessibility-and-sharing-rcapuzzi.vercel.app"
        )
        assert allowed("http://localhost:3000")                   # fixed list still works
        assert not allowed("https://evil.example.com")
        assert not allowed("https://body-composition-visualizer-x-evil.vercel.app")
    finally:
        monkeypatch.delenv("ALLOWED_ORIGIN_REGEX")
        importlib.reload(main_module)


def test_no_origin_regex_by_default():
    # unset means exactly the old behaviour: only the fixed list
    r = client.options(
        "/calculate",
        headers={
            "Origin": "https://body-composition-visualizer-elgrofsuf-rcapuzzi.vercel.app",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 400


def test_responses_forbid_content_sniffing():
    assert client.get("/").headers["x-content-type-options"] == "nosniff"
    assert client.post("/calculate", json=valid_payload()).headers["x-content-type-options"] == "nosniff"


def test_health_check_answers_head():
    """Uptime monitors and Render's probe default to HEAD; a bare @app.get
    replies 405 to it, which looks like an outage."""
    assert client.head("/").status_code == 200


def test_calculate_valid_request_returns_projection():
    resp = client.post("/calculate", json=valid_payload())
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["expected"]) == 17          # 16 weeks + week 0
    assert body["expected"][0]["week"] == 0
    assert "warnings" in body


def test_calculate_rejects_out_of_range_body_fat_pct():
    resp = client.post("/calculate", json=valid_payload(body_fat_pct=90))
    assert resp.status_code == 422


def test_calculate_rejects_missing_required_field():
    payload = valid_payload()
    del payload["sex"]
    resp = client.post("/calculate", json=payload)
    assert resp.status_code == 422


def test_calculate_rejects_unknown_enum_value():
    resp = client.post("/calculate", json=valid_payload(activity_level="marathon"))
    assert resp.status_code == 422
