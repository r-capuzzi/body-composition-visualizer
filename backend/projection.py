"""
The week-by-week simulation.

calculations.py answers "what happens in one week"; this module runs that
forward over the whole plan, three times (expected / conservative / optimistic),
and inspects the result for things the user should be warned about.

Each week the loop:
  1. recomputes BMR from *current* lean mass (muscle you gain raises it),
  2. turns that into TDEE and applies metabolic adaptation,
  3. asks calculations.weekly_body_comp_change for the lean/fat split,
  4. nudges a fast water/glycogen transient toward its target.
"""

from dataclasses import dataclass

from calculations import (
    ESSENTIAL_FAT_FRACTION,
    blended_bmr,
    metabolic_adaptation_factor,
    tdee,
    weekly_body_comp_change,
)
from models import CalculateRequest, CalculateResponse, ProjectionPoint


@dataclass(frozen=True)
class Scenario:
    label: str
    anabolic_scale: float      # scales the muscle model up/down
    adaptation_scale: float    # scales the TDEE *suppression* up/down


SCENARIOS = (
    Scenario("expected", 1.00, 1.0),
    # "conservative" = under-promise: less muscle, deeper adaptation (less loss).
    Scenario("conservative", 0.75, 1.3),
    Scenario("optimistic", 1.25, 0.7),
)

# Water/glycogen transient: a real cut sheds ~1-2 kg of water+glycogen in the
# first week or two that is not fat; a surplus does the reverse.
WATER_MAX_SWING_KG = 1.5
WATER_REFERENCE_BALANCE_KCAL_WEEK = 500 * 7   # balance at which the swing maxes
WATER_DECAY_PER_WEEK = 0.6                    # gap to target closed each week


def _run_scenario(req: CalculateRequest, scenario: Scenario) -> list[ProjectionPoint]:
    fat_mass = req.weight_kg * req.body_fat_pct / 100.0
    lean_mass = req.weight_kg - fat_mass
    water = 0.0
    weeks_in_deficit = 0.0

    def make_point(week: int, maintenance_kcal: float) -> ProjectionPoint:
        dry_weight = lean_mass + fat_mass
        # calculations.py's lean/fat floors keep dry_weight well clear of 0 for
        # any realistic input, but a plan long/extreme enough to erode both
        # floors toward their limit shouldn't be able to crash the projection.
        body_fat_pct = round(100.0 * fat_mass / dry_weight, 2) if dry_weight > 0 else 0.0
        return ProjectionPoint(
            week=week,
            weight_kg=round(dry_weight + water, 2),
            fat_mass_kg=round(fat_mass, 2),
            lean_mass_kg=round(lean_mass, 2),
            body_fat_pct=body_fat_pct,
            maintenance_kcal=round(maintenance_kcal, 1),
        )

    start_bmr = blended_bmr(
        req.sex, req.weight_kg, req.height_cm, req.age_years, lean_mass
    )
    points = [make_point(0, tdee(start_bmr, req.activity_level))]

    for week in range(1, req.plan_duration_weeks + 1):
        dry_weight = lean_mass + fat_mass
        bmr_now = blended_bmr(
            req.sex, dry_weight, req.height_cm, req.age_years, lean_mass
        )
        base_tdee = tdee(bmr_now, req.activity_level)

        deficit_fraction = max(0.0, (base_tdee - req.planned_daily_calories) / base_tdee)
        raw_adapt = metabolic_adaptation_factor(weeks_in_deficit, deficit_fraction)
        # scenario knob amplifies/damps only the *suppression* part (1 - factor)
        adapt = 1.0 - (1.0 - raw_adapt) * scenario.adaptation_scale
        maintenance_now = base_tdee * adapt

        energy_balance_week = (req.planned_daily_calories - maintenance_now) * 7.0

        d_lean, d_fat = weekly_body_comp_change(
            energy_balance_kcal_week=energy_balance_week,
            sex=req.sex,
            weight_kg=dry_weight,
            body_fat_pct=(100.0 * fat_mass / dry_weight) if dry_weight > 0 else 0.0,
            lean_mass_kg=lean_mass,
            fat_mass_kg=fat_mass,
            training_experience=req.training_experience,
            training_frequency_per_week=req.training_frequency_per_week,
            protein_g_per_kg=req.protein_g_per_kg,
            age_years=req.age_years,
            anabolic_scale=scenario.anabolic_scale,
        )
        lean_mass = max(lean_mass + d_lean, 0.0)
        fat_mass = max(fat_mass + d_fat, 0.0)

        # water/glycogen transient tracks the sign & size of the energy balance
        swing = WATER_MAX_SWING_KG * max(
            -1.0, min(1.0, energy_balance_week / WATER_REFERENCE_BALANCE_KCAL_WEEK)
        )
        water += (swing - water) * WATER_DECAY_PER_WEEK

        # adaptation builds while dieting and slowly unwinds otherwise
        weeks_in_deficit = (
            weeks_in_deficit + 1 if deficit_fraction > 0
            else max(0.0, weeks_in_deficit - 2)
        )

        points.append(make_point(week, maintenance_now))

    return points


def _detect_warnings(
    req: CalculateRequest, expected: list[ProjectionPoint]
) -> list[str]:
    warnings: list[str] = []

    # Size of the planned energy imbalance vs maintenance (an input-based check,
    # robust to how the trajectory later decelerates).
    start_tdee = expected[0].maintenance_kcal
    imbalance_frac = (req.planned_daily_calories - start_tdee) / start_tdee
    if imbalance_frac <= -0.28:
        warnings.append(
            f"Planned intake is ~{-imbalance_frac * 100:.0f}% below maintenance. Deep "
            "deficits speed up muscle loss and are hard to hold to - 15-25% below "
            "is the usual sustainable range."
        )
    elif imbalance_frac >= 0.20:
        warnings.append(
            f"Planned intake is ~{imbalance_frac * 100:.0f}% above maintenance. A "
            "surplus this large is mostly stored as fat - 5-15% above maintenance "
            "builds muscle just as well."
        )

    net_lean = expected[-1].lean_mass_kg - expected[0].lean_mass_kg
    net_fat = expected[-1].fat_mass_kg - expected[0].fat_mass_kg
    if net_lean > 0.2 and net_fat > max(1.0, 2.0 * net_lean):
        warnings.append(
            f"Projected fat gain (+{net_fat:.1f} kg) far outpaces muscle gain "
            f"(+{net_lean:.1f} kg). Muscle gain is capped by training experience, "
            "so a smaller surplus reaches the same muscle with less fat."
        )

    # Plateau: with fixed calories, adaptation + a lighter body shrink the
    # deficit over time. Flag when the last-quarter loss rate has fallen well
    # below the first-quarter rate while still nominally cutting.
    if len(expected) >= 16 and req.planned_daily_calories < expected[0].maintenance_kcal:
        q = len(expected) // 4
        early_rate = (expected[0].weight_kg - expected[q].weight_kg) / q
        late_rate = (expected[-q - 1].weight_kg - expected[-1].weight_kg) / q
        if early_rate > 0.15 and late_rate < 0.55 * early_rate:
            plateau_week = next(
                (p.week for a, p in zip(expected, expected[1:])
                 if (a.weight_kg - p.weight_kg) < 0.5 * early_rate),
                expected[-1].week,
            )
            warnings.append(
                f"Weight loss slows from ~{early_rate:.2f} to ~{late_rate:.2f} kg/week "
                f"by around week {plateau_week} as your metabolism adapts. To keep "
                "progressing you would need to reduce intake further or add activity."
            )

    essential_pct = ESSENTIAL_FAT_FRACTION[req.sex] * 100.0
    if expected[-1].body_fat_pct < essential_pct + 3.0:
        warnings.append(
            f"Projected body fat ({expected[-1].body_fat_pct:.0f}%) approaches the "
            f"essential minimum (~{essential_pct:.0f}%). Muscle loss accelerates "
            "near this level."
        )

    if req.planned_daily_calories < expected[0].maintenance_kcal and req.protein_g_per_kg < 1.6:
        warnings.append(
            f"Protein ({req.protein_g_per_kg:.1f} g/kg) is below ~1.6 g/kg; muscle "
            "retention in a deficit will suffer. 2.2-2.6 g/kg is recommended when "
            "cutting."
        )

    return warnings


def build_projection(req: CalculateRequest) -> CalculateResponse:
    runs = {s.label: _run_scenario(req, s) for s in SCENARIOS}
    expected = runs["expected"]

    lean0 = req.weight_kg * (1.0 - req.body_fat_pct / 100.0)
    start_bmr = blended_bmr(
        req.sex, req.weight_kg, req.height_cm, req.age_years, lean0
    )
    start_tdee = tdee(start_bmr, req.activity_level)

    return CalculateResponse(
        bmr_kcal=round(start_bmr, 1),
        maintenance_kcal=round(start_tdee, 1),
        daily_calorie_delta=round(req.planned_daily_calories - start_tdee, 1),
        expected=expected,
        conservative=runs["conservative"],
        optimistic=runs["optimistic"],
        warnings=_detect_warnings(req, expected),
    )
