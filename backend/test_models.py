"""
Tests for CalculateRequest's own validation in models.py.
Run from the backend/ folder:  python -m pytest -q
"""

import pytest
from pydantic import ValidationError

from models import ActivityLevel, CalculateRequest, Sex, TrainingExperience


def make_request(**overrides) -> dict:
    payload = dict(
        sex=Sex.male,
        age_years=30,
        height_cm=180.0,
        weight_kg=85.0,
        body_fat_pct=22.0,
        activity_level=ActivityLevel.moderate,
        training_experience=TrainingExperience.intermediate,
        training_frequency_per_week=3,
        protein_g_per_kg=2.0,
        planned_daily_calories=2400,
        plan_duration_weeks=16,
    )
    payload.update(overrides)
    return payload


def test_plausible_height_and_weight_pass():
    CalculateRequest(**make_request(height_cm=180.0, weight_kg=85.0))  # ~26 BMI


def test_implausible_bmi_combination_is_rejected():
    # each field is independently in-range, but together imply BMI ~4.9
    with pytest.raises(ValidationError, match="implausible BMI"):
        CalculateRequest(**make_request(height_cm=249.0, weight_kg=30.5))
