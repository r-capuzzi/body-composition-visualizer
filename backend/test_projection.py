"""
Tests for the week-by-week simulation in projection.py.
Run from the backend/ folder:  python -m pytest -q
"""

import pytest

from calculations import ESSENTIAL_FAT_FRACTION, ESSENTIAL_LEAN_FRACTION, blended_bmr, tdee
from models import ActivityLevel, CalculateRequest, Sex, TrainingExperience
from projection import build_projection


def make_request(*, daily_calorie_delta: float, **overrides) -> CalculateRequest:
    """Request whose intake sits `daily_calorie_delta` kcal from the *starting*
    TDEE (negative = deficit)."""
    base = dict(
        sex=Sex.male,
        age_years=30,
        height_cm=180.0,
        weight_kg=85.0,
        body_fat_pct=22.0,
        activity_level=ActivityLevel.moderate,
        training_experience=TrainingExperience.intermediate,
        training_frequency_per_week=3,
        protein_g_per_kg=2.0,
        plan_duration_weeks=16,
    )
    base.update(overrides)
    lean0 = base["weight_kg"] * (1 - base["body_fat_pct"] / 100)
    start_tdee = tdee(
        blended_bmr(base["sex"], base["weight_kg"], base["height_cm"],
                    base["age_years"], lean0),
        base["activity_level"],
    )
    return CalculateRequest(
        planned_daily_calories=start_tdee + daily_calorie_delta, **base
    )


def muscle_share_of_loss(points) -> float:
    """Lean as a fraction of DRY tissue lost (lean + fat), i.e. excluding the
    temporary water transient - this is what the partition model actually
    controls."""
    lean_lost = points[0].lean_mass_kg - points[-1].lean_mass_kg
    fat_lost = points[0].fat_mass_kg - points[-1].fat_mass_kg
    assert lean_lost + fat_lost > 0
    return lean_lost / (lean_lost + fat_lost)


# --------------------------------------------------------------------------- #
# Shape of the response
# --------------------------------------------------------------------------- #

def test_response_has_three_aligned_scenarios():
    resp = build_projection(make_request(daily_calorie_delta=-400))
    n = 16 + 1
    assert len(resp.expected) == n
    assert len(resp.conservative) == n
    assert len(resp.optimistic) == n
    assert [p.week for p in resp.expected] == list(range(n))


def test_conservative_is_pessimistic_relative_to_optimistic():
    resp = build_projection(make_request(daily_calorie_delta=-400))
    # On a cut, "conservative" should project LESS fat loss than "optimistic".
    cons_fat_lost = resp.conservative[0].fat_mass_kg - resp.conservative[-1].fat_mass_kg
    opt_fat_lost = resp.optimistic[0].fat_mass_kg - resp.optimistic[-1].fat_mass_kg
    assert cons_fat_lost < opt_fat_lost
    # ...and LESS muscle gain on a lean bulk.
    bulk = build_projection(make_request(daily_calorie_delta=+250))
    cons_lean = bulk.conservative[-1].lean_mass_kg - bulk.conservative[0].lean_mass_kg
    opt_lean = bulk.optimistic[-1].lean_mass_kg - bulk.optimistic[0].lean_mass_kg
    assert cons_lean < opt_lean


# --------------------------------------------------------------------------- #
# Dynamic TDEE
# --------------------------------------------------------------------------- #

def test_maintenance_drifts_down_as_weight_is_lost():
    resp = build_projection(make_request(daily_calorie_delta=-500))
    maints = [p.maintenance_kcal for p in resp.expected]
    assert maints[-1] < maints[0]                     # TDEE fell
    assert all(b <= a + 1e-6 for a, b in zip(maints, maints[1:]))  # monotone down


def test_weight_loss_decelerates_over_time():
    """With a fixed intake, a shrinking deficit -> the plateau effect."""
    pts = build_projection(make_request(daily_calorie_delta=-500)).expected
    first_month = pts[0].weight_kg - pts[4].weight_kg
    fourth_month = pts[12].weight_kg - pts[16].weight_kg
    assert fourth_month < first_month


# --------------------------------------------------------------------------- #
# Muscle-share anchors (should survive the refactor)
# --------------------------------------------------------------------------- #

def test_sustained_real_cut_with_training_keeps_muscle_loss_modest():
    # SHORT plan: the deficit stays ~constant, so this tests the partition
    # calibration before adaptation turns the back half into a recomp.
    pts = build_projection(
        make_request(daily_calorie_delta=-500, plan_duration_weeks=5,
                     training_frequency_per_week=3, body_fat_pct=18.0,
                     protein_g_per_kg=1.6)
    ).expected
    assert 0.0 <= muscle_share_of_loss(pts) <= 0.16


def test_not_training_loses_substantially_more_muscle_than_training():
    kw = dict(daily_calorie_delta=-500, plan_duration_weeks=5,
              body_fat_pct=18.0, protein_g_per_kg=1.6)
    trained = muscle_share_of_loss(
        build_projection(make_request(training_frequency_per_week=3, **kw)).expected
    )
    untrained = muscle_share_of_loss(
        build_projection(make_request(training_frequency_per_week=0, **kw)).expected
    )
    assert untrained > trained + 0.10   # meaningfully worse without lifting
    assert untrained >= 0.20


def test_long_fixed_calorie_cut_plateaus():
    resp = build_projection(
        make_request(daily_calorie_delta=-600, plan_duration_weeks=24)
    )
    pts = resp.expected
    early = (pts[0].weight_kg - pts[6].weight_kg) / 6
    late = (pts[-7].weight_kg - pts[-1].weight_kg) / 6
    assert late < 0.5 * early                       # loss rate roughly halves
    assert any("adapts" in w or "slows" in w for w in resp.warnings)


# --------------------------------------------------------------------------- #
# Water transient
# --------------------------------------------------------------------------- #

def test_first_week_drop_is_front_loaded_by_water():
    pts = build_projection(make_request(daily_calorie_delta=-500)).expected
    week1_drop = pts[0].weight_kg - pts[1].weight_kg
    later_drop = pts[8].weight_kg - pts[9].weight_kg
    assert week1_drop > later_drop * 1.5   # visible whoosh up front


# --------------------------------------------------------------------------- #
# Warnings
# --------------------------------------------------------------------------- #

def test_aggressive_deficit_warns():
    resp = build_projection(make_request(daily_calorie_delta=-1400))
    assert any("below maintenance" in w for w in resp.warnings)


def test_large_surplus_warns():
    resp = build_projection(make_request(daily_calorie_delta=+900))
    assert any("above maintenance" in w for w in resp.warnings)


def test_low_protein_cut_warns():
    resp = build_projection(
        make_request(daily_calorie_delta=-500, protein_g_per_kg=1.0)
    )
    assert any("rotein" in w for w in resp.warnings)


def test_sensible_short_plan_has_no_warnings():
    resp = build_projection(
        make_request(daily_calorie_delta=-350, protein_g_per_kg=2.2,
                     plan_duration_weeks=8)
    )
    assert resp.warnings == []


# --------------------------------------------------------------------------- #
# Long/extreme plans stay physiologically bounded. The shrinking-deficit
# feedback loop (TDEE falls as the body does, closing the gap to fixed planned
# calories) turns out to self-limit before hitting either floor at the
# model's own extremes - confirmed by running this same case with the lean
# floor removed and finding mass still settled rather than crashed. The
# `body_fat_pct = 100*fat_mass/dry_weight` divide was still unguarded, though
# (see projection.py's make_point), so this both hardens that division and
# pins down the whole-run invariants - non-negative weight, both masses at or
# above their essential floors - at the longest/most extreme input the API
# will accept.
# --------------------------------------------------------------------------- #

def test_longest_lowest_calorie_plan_never_crashes_and_stays_bounded():
    req = CalculateRequest(
        sex=Sex.female,
        age_years=25,
        height_cm=150.0,       # small frame -> low TDEE, so the fixed floor
        weight_kg=40.0,        # calorie intake below is a severe deficit
        body_fat_pct=18.0,
        activity_level=ActivityLevel.sedentary,
        training_experience=TrainingExperience.untrained,
        training_frequency_per_week=0,
        protein_g_per_kg=0.5,
        planned_daily_calories=801,   # just above the model's hard floor
        plan_duration_weeks=260,      # ~5 years, the model's max
    )
    resp = build_projection(req)

    fat_floor_frac = ESSENTIAL_FAT_FRACTION[req.sex]
    lean_floor_frac = ESSENTIAL_LEAN_FRACTION[req.sex]
    for series in (resp.expected, resp.conservative, resp.optimistic):
        for p in series:
            assert p.weight_kg > 0
            assert 0.0 <= p.body_fat_pct <= 100.0
            dry_weight = p.lean_mass_kg + p.fat_mass_kg
            if dry_weight > 0:
                # floors are approximate (see the double-clamp note in
                # weekly_body_comp_change) - allow a little slack rather than
                # asserting they hold to the exact fraction every single week.
                assert p.fat_mass_kg >= fat_floor_frac * dry_weight - 0.5
                assert p.lean_mass_kg >= lean_floor_frac * dry_weight - 0.5
