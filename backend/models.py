"""
Request/response schemas for the API.

Pydantic models do three jobs for us at once:
  1. Validation  – reject nonsense input (negative weight, 900% body fat) before
     it ever reaches the math.
  2. Parsing     – turn the incoming JSON into typed Python objects.
  3. Documentation – FastAPI reads these classes to auto-generate the interactive
     API docs at http://localhost:8000/docs.
"""

from enum import Enum

from pydantic import BaseModel, Field, model_validator


class Sex(str, Enum):
    """Biological sex – needed for BMR, muscle-gain rates and essential-fat %."""

    male = "male"
    female = "female"


class ActivityLevel(str, Enum):
    """Your overall weekly activity, INCLUDING all exercise (the classic
    Mifflin/Katch activity factor). Maps to a maintenance multiplier in
    calculations.ACTIVITY_MULTIPLIERS.

    Note: training_frequency_per_week is a *muscle-retention* signal, not a
    second energy input - the small extra burn from lifting is already inside
    these tiers. When unsure, pick the lower one: over-estimating activity is
    the most common reason a projected deficit shows up as a surplus.
    """

    sedentary = "sedentary"        # x1.20  - desk job, drives everywhere, ~no exercise
    light = "light"               # x1.375 - light exercise/sport 1-3 days per week
    moderate = "moderate"         # x1.55  - moderate exercise/sport 3-5 days per week
    active = "active"             # x1.725 - hard exercise 6-7 days/wk or a physical job
    very_active = "very_active"   # x1.90  - hard daily training PLUS a physical job


class TrainingExperience(str, Enum):
    """Years of *consistent* resistance training. Drives how fast the model lets
    the user gain muscle – see the sources in calculations.py."""

    untrained = "untrained"           # < 1 year
    novice = "novice"                 # 1-2 years
    intermediate = "intermediate"     # 2-5 years
    advanced = "advanced"             # 5+ years


class CalculateRequest(BaseModel):
    """Everything the calculator needs for one projection.

    NOTE: every measurement here is METRIC (kg, cm). The React frontend owns the
    imperial <-> metric toggle and converts to metric before calling this API,
    so the calculation core only ever deals with one unit system.
    """

    sex: Sex
    age_years: int = Field(ge=14, le=100)
    height_cm: float = Field(gt=120, lt=250)
    weight_kg: float = Field(gt=30, lt=300)
    body_fat_pct: float = Field(ge=3, le=60, description="Current body fat, 3-60%")

    activity_level: ActivityLevel = Field(
        description="Overall weekly activity INCLUDING all exercise. sedentary "
        "x1.20 / light x1.375 (1-3 days/wk) / moderate x1.55 (3-5 days/wk) / "
        "active x1.725 (6-7 days/wk or physical job) / very_active x1.90. Pick "
        "the lower option when unsure - over-estimating here is what makes a "
        "deficit look like a surplus."
    )
    training_experience: TrainingExperience
    training_frequency_per_week: int = Field(
        default=3,
        ge=0,
        le=7,
        description="How many times each MAJOR MUSCLE GROUP is trained per week "
        "(0 = no resistance training). More frequent stimulus preserves more "
        "muscle in a deficit and better supports growth. Little added benefit "
        "past ~3x/week.",
    )
    protein_g_per_kg: float = Field(
        default=1.6,
        ge=0.0,
        le=4.0,
        description="Daily protein intake per kg of BODYWEIGHT. ~1.6 g/kg is the "
        "minimum to properly support muscle; 2.2-2.6 g/kg is near-optimal when "
        "cutting. Trainers can raise this for clients prioritising muscle.",
    )

    planned_daily_calories: float = Field(gt=800, lt=6000)
    plan_duration_weeks: int = Field(ge=1, le=260, description="1 week to ~5 years")

    @model_validator(mode="after")
    def _check_plausible_bmi(self) -> "CalculateRequest":
        # height_cm and weight_kg are independently bounded above, which still
        # admits combinations no human has (30 kg at 250 cm is BMI ~4.8; 300 kg
        # at 120 cm is BMI ~208). 10-75 is deliberately generous - it's only
        # meant to catch impossible pairings, not flag clinical under/overweight
        # (that's what the projection's own warnings are for).
        bmi = self.weight_kg / (self.height_cm / 100) ** 2
        if not (10 <= bmi <= 75):
            raise ValueError(
                f"Height and weight combine to an implausible BMI of {bmi:.0f} - "
                "please double-check them"
            )
        return self


class ProjectionPoint(BaseModel):
    """One row of the timeline the scrubber will slide across."""

    week: int
    weight_kg: float          # scale weight: lean + fat + water/glycogen transient
    fat_mass_kg: float
    lean_mass_kg: float
    body_fat_pct: float
    maintenance_kcal: float   # this week's TDEE, after metabolic adaptation


class CalculateResponse(BaseModel):
    # Starting-point figures (week 0)
    bmr_kcal: float
    maintenance_kcal: float          # starting TDEE
    daily_calorie_delta: float       # starting intake - starting TDEE

    # Three trajectories. `expected` drives the 3D model; `conservative` and
    # `optimistic` bracket it (headline the conservative one to the user).
    expected: list[ProjectionPoint]
    conservative: list[ProjectionPoint]
    optimistic: list[ProjectionPoint]

    warnings: list[str]              # plan-health flags for the UI to surface
