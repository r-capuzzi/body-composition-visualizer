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
            f"Projected fat gain of {_mass(net_fat, sign=True)} far outpaces muscle "
            f"gain of {_mass(net_lean, sign=True)}. Muscle gain is capped by training "
            "experience, so a smaller surplus reaches the same muscle with less fat."
        )

    essential_pct = ESSENTIAL_FAT_FRACTION[req.sex] * 100.0
    who = "women" if req.sex.value == "female" else "men"
    if req.body_fat_pct < essential_pct:
        # Input allows body fat down to 3% for either sex, but essential fat is
        # the floor a living body sustains - an entry under it is almost
        # certainly an underestimate, and every number downstream inherits it.
        # (This used to fall through to the "approaches" wording below, which
        # read as "9% approaches the 12% minimum".)
        warnings.append(
            f"The body fat you entered ({req.body_fat_pct:.0f}%) is below the "
            f"essential minimum for {who} (~{essential_pct:.0f}%), which is about "
            "as lean as a healthy body can get - it's probably an underestimate. "
            "A higher estimate will give a more realistic projection."
        )
    elif expected[-1].body_fat_pct < essential_pct + 3.0:
        warnings.append(
            f"Projected body fat falls to {expected[-1].body_fat_pct:.0f}%, close to "
            f"the essential minimum for {who} (~{essential_pct:.0f}%). Muscle loss "
            "accelerates near this level."
        )

    if req.planned_daily_calories < expected[0].maintenance_kcal and req.protein_g_per_kg < 1.6:
        warnings.append(
            f"Protein ({req.protein_g_per_kg:.1f} g/kg) is below ~1.6 g/kg; muscle "
            "retention in a deficit will suffer. 2.2-2.6 g/kg is recommended when "
            "cutting."
        )

    return warnings


def _plan_notes(
    req: CalculateRequest, expected: list[ProjectionPoint]
) -> list[str]:
    notes: list[str] = []

    # Loss eases on any long fixed-intake cut: a lighter body burns less and
    # adaptation suppresses expenditure, so the same calories become a smaller
    # deficit. This used to be a *warning* comparing first- and last-quarter
    # SCALE-weight rates - but the first quarter carries the week-1 water and
    # glycogen drop, which inflated the early rate so reliably that it fired on
    # 17 of 21 cuts tested, blaming "metabolism" for what was mostly water. On
    # fat + muscle alone the slowdown is real but near-universal (the late/early
    # ratio sat at 0.60-0.67 for every deficit and length tried), so no
    # threshold can single out a problem plan. It is information about every
    # long cut, and it is reported as that.
    if len(expected) >= 16 and req.planned_daily_calories < expected[0].maintenance_kcal:
        q = len(expected) // 4
        tissue = [p.lean_mass_kg + p.fat_mass_kg for p in expected]
        early = (tissue[0] - tissue[q]) / q
        late = (tissue[-q - 1] - tissue[-1]) / q
        # below ~0.1 kg/week the "easing" is too small to be worth a line
        if early > 0.1 and late < early:
            notes.append(
                "On a fixed intake, weight loss eases over the plan - from about "
                f"{_mass(early, digits=2)} to about {_mass(late, digits=2)} a week "
                "once early water loss is set aside. You get lighter and your "
                "metabolism adapts, so the same calories become a smaller deficit. "
                "That's normal: to hold the early pace, trim intake a little every "
                "few weeks or add activity."
            )

    return notes


KG_TO_LB = 2.2046226218


def _mass(kg: float, *, sign: bool = False, digits: int = 1) -> str:
    """A mass in both units. Warnings and notes are plain strings built here,
    and the API has no idea which unit toggle the reader has on - "+4.2 kg"
    alone is a number an imperial user has to convert in their head."""
    spec = f"{'+' if sign else ''}.{digits}f"
    return f"{kg:{spec}} kg ({kg * KG_TO_LB:{spec}} lb)"


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
        notes=_plan_notes(req, expected),
    )
