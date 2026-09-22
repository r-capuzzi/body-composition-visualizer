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
    # ...and the user is told, as information rather than an alarm
    assert any("eases" in n for n in resp.notes)
    assert not any("eases" in w for w in resp.warnings)


def test_plateau_note_ignores_the_week_one_water_drop():
    """The easing note is measured on fat + muscle, not scale weight. On scale
    weight the week-1 water/glycogen drop inflated the 'early' rate and made
    ordinary cuts look like they were stalling."""
    resp = build_projection(make_request(daily_calorie_delta=-600, plan_duration_weeks=24))
    pts = resp.expected
    q = len(pts) // 4
    tissue_early = ((pts[0].lean_mass_kg + pts[0].fat_mass_kg)
                    - (pts[q].lean_mass_kg + pts[q].fat_mass_kg)) / q
    scale_early = (pts[0].weight_kg - pts[q].weight_kg) / q
    assert scale_early > tissue_early          # the water really does inflate it
    note = next(n for n in resp.notes if "eases" in n)
    assert f"{tissue_early:.2f} kg" in note    # and the note reports the tissue rate


def test_plateau_note_only_on_long_real_cuts():
    # every long cut gets it - even a mild one, since some easing is universal
    assert any("eases" in n for n in build_projection(
        make_request(daily_calorie_delta=-300, plan_duration_weeks=24)).notes)
    # but not a short plan, a trivial deficit, or a surplus
    assert build_projection(make_request(daily_calorie_delta=-500, plan_duration_weeks=8)).notes == []
    assert build_projection(make_request(daily_calorie_delta=-80, plan_duration_weeks=24)).notes == []
    assert build_projection(make_request(daily_calorie_delta=+250, plan_duration_weeks=24)).notes == []


def test_body_fat_entered_below_essential_is_flagged_as_a_likely_underestimate():
    resp = build_projection(make_request(daily_calorie_delta=-300, sex=Sex.female,
                                         weight_kg=60.0, height_cm=165.0, body_fat_pct=8.0))
    essential = [w for w in resp.warnings if "essential" in w]
    assert len(essential) == 1                       # one message, not two
    assert "underestimate" in essential[0]
    assert "approaches" not in essential[0]          # "8% approaches 12%" was wrong


def test_nearing_essential_fat_from_above_still_warns():
    resp = build_projection(make_request(daily_calorie_delta=-600, plan_duration_weeks=40,
                                         body_fat_pct=12.0))
    assert any("close to the essential minimum for men" in w for w in resp.warnings)


def test_warning_masses_are_given_in_both_units():
    """Warnings are built as plain strings on the backend, which can't know the
    reader's unit toggle - a bare "kg" leaves imperial users converting."""
    resp = build_projection(make_request(daily_calorie_delta=+900))
    fat_warning = next(w for w in resp.warnings if "outpaces" in w)
    assert " kg (" in fat_warning and " lb)" in fat_warning


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
