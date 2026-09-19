"""
HTTP-level tests for main.py, via FastAPI's TestClient.
Run from the backend/ folder:  python -m pytest -q

test_projection.py and test_calculations.py already cover the projection math
in depth by calling build_projection() directly; these tests only cover the
web layer on top of it - routing, status codes and request validation - which
nothing else exercises.
"""

from fastapi.testclient import TestClient

from main import app

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
