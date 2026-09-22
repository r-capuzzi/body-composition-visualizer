"""
Unit tests for the per-week physiology in calculations.py.
Run from the backend/ folder:  python -m pytest -q
"""

import pytest

from calculations import (
    ADIPOSE_KCAL_PER_KG,
    LEAN_KCAL_PER_KG,
    MAX_WEEKLY_LEAN_LOSS_FRACTION,
    age_anabolic_modifier,
    blended_bmr,
    bmr_katch_mcardle,
    bmr_mifflin_st_jeor,
    metabolic_adaptation_factor,
    muscle_stimulus_factor,
    partition_favorability,
    protein_anabolic_modifier,
    protein_catabolic_modifier,
    weekly_body_comp_change,
)
from models import Sex, TrainingExperience


# --------------------------------------------------------------------------- #
# BMR
# --------------------------------------------------------------------------- #

def test_mifflin_worked_example():
    # 80 kg, 180 cm, 30 y male -> 10*80 + 6.25*180 - 5*30 + 5 = 1780
    assert bmr_mifflin_st_jeor(Sex.male, 80, 180, 30) == pytest.approx(1780)
    assert bmr_mifflin_st_jeor(Sex.female, 80, 180, 30) == pytest.approx(1614)


def test_blended_bmr_sits_between_its_two_inputs():
    lean = 64.0
    mifflin = bmr_mifflin_st_jeor(Sex.male, 80, 180, 30)
    katch = bmr_katch_mcardle(lean)
    blended = blended_bmr(Sex.male, 80, 180, 30, lean)
    assert min(mifflin, katch) < blended < max(mifflin, katch)
    assert blended == pytest.approx((mifflin + katch) / 2)


# --------------------------------------------------------------------------- #
# Modifiers
# --------------------------------------------------------------------------- #

def test_partition_favorability_direction_and_clamp():
    assert partition_favorability(15.0, Sex.male) == pytest.approx(1.0)
    assert partition_favorability(25.0, Sex.male) > 1.0   # more fat -> favourable
    assert partition_favorability(6.0, Sex.male) < 1.0    # lean -> unfavourable
    assert partition_favorability(90.0, Sex.male) == 1.35  # clamped high
    assert partition_favorability(1.0, Sex.male) == 0.65   # clamped low
    # women pivot higher
    assert partition_favorability(23.0, Sex.female) == pytest.approx(1.0)


def test_age_anabolic_modifier():
    assert age_anabolic_modifier(25) == 1.0
    assert age_anabolic_modifier(45) == 1.0
    assert age_anabolic_modifier(55) == pytest.approx(0.9)
    assert age_anabolic_modifier(120) == 0.5  # floored


def test_protein_modifiers_are_monotonic_and_bounded():
    assert protein_anabolic_modifier(0.8) == pytest.approx(0.75)
    assert protein_anabolic_modifier(3.0) == pytest.approx(1.0)
    assert protein_anabolic_modifier(1.6) < protein_anabolic_modifier(2.0)

    assert protein_catabolic_modifier(0.8) == pytest.approx(1.3)   # low -> more loss
    assert protein_catabolic_modifier(3.0) == pytest.approx(0.8)   # high -> less loss
    assert protein_catabolic_modifier(1.6) > protein_catabolic_modifier(2.0)


def test_stimulus_by_frequency():
    assert muscle_stimulus_factor(0) == 0.0
    assert muscle_stimulus_factor(3) == 1.0
    assert muscle_stimulus_factor(6) == 1.0  # capped at 3x


def test_adaptation_is_a_noop_outside_a_deficit():
    assert metabolic_adaptation_factor(0.0, 0.0) == 1.0
    assert metabolic_adaptation_factor(10.0, 0.0) == 1.0
    assert metabolic_adaptation_factor(10.0, -0.2) == 1.0


def test_adaptation_builds_over_time_and_deepens_with_the_deficit():
    mild_wk1 = metabolic_adaptation_factor(1.0, 0.10)
    mild_wk12 = metabolic_adaptation_factor(12.0, 0.10)
    deep_wk12 = metabolic_adaptation_factor(12.0, 0.30)

    assert mild_wk1 > mild_wk12          # suppression grows with time
    assert deep_wk12 < mild_wk12         # ...and with deficit depth
    assert 0.82 <= deep_wk12 <= 1.0      # stays in range
    # a moderate long cut lands around 6-9% suppression
    assert 0.90 <= metabolic_adaptation_factor(16.0, 0.18) <= 0.95


def test_adaptation_suppression_is_capped():
    # even an absurd deficit fraction can't suppress TDEE past the 0.82 floor
    assert metabolic_adaptation_factor(999.0, 0.9) == pytest.approx(0.85, abs=0.03)


# --------------------------------------------------------------------------- #
# weekly_body_comp_change
# --------------------------------------------------------------------------- #

BASE = dict(
    sex=Sex.male,
    weight_kg=80.0,
    body_fat_pct=20.0,
    lean_mass_kg=64.0,
    fat_mass_kg=16.0,
    training_experience=TrainingExperience.intermediate,
    training_frequency_per_week=3,
    protein_g_per_kg=1.8,
    age_years=30,
)


def test_energy_books_balance_when_floor_not_hit():
    for balance in (-3500.0, -1500.0, 0.0, 2000.0, 6000.0):
        lean, fat = weekly_body_comp_change(
            energy_balance_kcal_week=balance, **BASE
        )
        reconstructed = lean * LEAN_KCAL_PER_KG + fat * ADIPOSE_KCAL_PER_KG
        assert reconstructed == pytest.approx(balance, abs=1.0)


def test_surplus_muscle_is_capped_not_proportional():
    small_lean, small_fat = weekly_body_comp_change(
        energy_balance_kcal_week=1000.0, **BASE
    )
    big_lean, big_fat = weekly_body_comp_change(
        energy_balance_kcal_week=7000.0, **BASE
    )
    assert big_lean == pytest.approx(small_lean, rel=0.05)  # muscle barely moves
    assert big_fat > small_fat * 3                          # fat scales hard


def test_real_cut_loses_some_muscle_and_shallow_cut_can_gain():
    deep_lean, _ = weekly_body_comp_change(
        energy_balance_kcal_week=-500 * 7, **BASE
    )
    shallow_lean, _ = weekly_body_comp_change(
        energy_balance_kcal_week=-200 * 7, **BASE
    )
    assert deep_lean < 0            # losing muscle on a real cut
    assert shallow_lean > deep_lean  # shallow cut spares (or builds) muscle


def test_essential_fat_floor_blocks_further_fat_loss():
    lean, fat = weekly_body_comp_change(
        energy_balance_kcal_week=-6000.0,
        sex=Sex.male,
        weight_kg=70.0,
        body_fat_pct=5.0,
        lean_mass_kg=66.5,
        fat_mass_kg=3.5,           # already at ~5%, floor is 4% * 70 = 2.8
        training_experience=TrainingExperience.intermediate,
        training_frequency_per_week=3,
        protein_g_per_kg=1.8,
        age_years=30,
    )
    assert fat >= 2.8 - 3.5 - 1e-6      # cannot drop below the 2.8 kg floor
    assert lean < 0                     # the deficit is forced onto lean instead


def test_essential_lean_floor_blocks_further_lean_loss():
    # mirror of the fat-floor test above: a female at 70 kg with lean already
    # at ~30.1% (essential-lean floor is 30% * 70 = 21.0) and a severe enough
    # deficit that, uncapped, catabolism alone would burn well past that.
    lean, fat = weekly_body_comp_change(
        energy_balance_kcal_week=-6000.0,
        sex=Sex.female,
        weight_kg=70.0,
        body_fat_pct=70.0,
        lean_mass_kg=21.1,
        fat_mass_kg=48.9,
        training_experience=TrainingExperience.untrained,
        training_frequency_per_week=0,
        protein_g_per_kg=0.0,
        age_years=30,
    )
    assert lean >= 21.0 - 21.1 - 1e-6   # cannot drop below the 21.0 kg floor
    assert fat < -6000.0 / ADIPOSE_KCAL_PER_KG * 0.5  # shortfall forced onto fat instead


def test_lean_loss_rate_is_capped_at_the_fat_floor():
    """Regression: with fat pinned at its floor, the energy-conservation step
    used to divide the whole remaining deficit by LEAN_KCAL_PER_KG (1800) -
    ~5.2x smaller than ADIPOSE_KCAL_PER_KG - and hand back multi-kg weekly lean
    losses (-3.55 kg here before the cap, ~7.8 lb of tissue in one week)."""
    lean, _fat = weekly_body_comp_change(
        energy_balance_kcal_week=-9688.0,   # ~1384 kcal/day deficit
        sex=Sex.female,
        weight_kg=70.0,
        body_fat_pct=12.5,
        lean_mass_kg=61.25,
        fat_mass_kg=8.75,                   # floor is 0.12 * 70 = 8.4, no headroom
        training_experience=TrainingExperience.untrained,
        training_frequency_per_week=0,
        protein_g_per_kg=1.0,
        age_years=30,
    )
    assert lean >= -MAX_WEEKLY_LEAN_LOSS_FRACTION * 61.25 - 1e-9
    assert lean > -0.5          # ~0.43 kg/week, not 3.55


def test_lean_loss_cap_does_not_bind_on_a_normal_cut():
    """The cap is a ceiling for the starvation regime, not a brake on ordinary
    dieting - a standard 500 kcal/day deficit must be nowhere near it."""
    lean, _fat = weekly_body_comp_change(energy_balance_kcal_week=-500 * 7, **BASE)
    assert lean > -0.2 * MAX_WEEKLY_LEAN_LOSS_FRACTION * BASE["lean_mass_kg"] * 5


def test_fat_below_the_essential_floor_is_never_raised_in_a_deficit():
    """Regression: input allows body fat under the sex-specific essential floor
    (3% minimum vs a 12% female floor), and the floor clamp used to treat the
    floor as a target - forcing fat UP to it while the person was dieting.
    A woman entered at 6% gained 3.6kg of fat in week one of a deficit."""
    _lean, fat = weekly_body_comp_change(
        energy_balance_kcal_week=-500 * 7,
        sex=Sex.female,
        weight_kg=60.0,
        body_fat_pct=6.0,
        lean_mass_kg=56.4,
        fat_mass_kg=3.6,            # floor would be 0.12 * 60 = 7.2kg
        training_experience=TrainingExperience.intermediate,
        training_frequency_per_week=3,
        protein_g_per_kg=2.0,
        age_years=28,
    )
    assert fat <= 1e-9   # no fat gain in a deficit, full stop


def test_fat_mass_does_not_raise_the_muscle_gain_ceiling():
    """Regression: the ceiling was a % of TOTAL bodyweight, so an untrained
    160kg/50% man got more than twice the headroom of a 75kg/15% man."""
    from calculations import weekly_muscle_gain_cap_kg

    lean_75 = weekly_muscle_gain_cap_kg(Sex.male, 75.0, TrainingExperience.untrained, 63.75)
    heavy = weekly_muscle_gain_cap_kg(Sex.male, 160.0, TrainingExperience.untrained, 80.0)
    assert heavy < 1.3 * lean_75            # was 2.1x
    # at or below neutral body fat nothing changes (the under-promise rule
    # only allows this correction to lower a ceiling, never raise one)
    for w, lean in ((75.0, 63.75), (75.0, 67.5)):
        assert weekly_muscle_gain_cap_kg(Sex.male, w, TrainingExperience.untrained, lean) == \
            weekly_muscle_gain_cap_kg(Sex.male, w, TrainingExperience.untrained)


def test_weekly_change_uses_the_lean_based_ceiling():
    """End to end through weekly_body_comp_change, so the ceiling fix can't be
    silently disconnected at the call site."""
    common = dict(energy_balance_kcal_week=3000.0, sex=Sex.male,
                  training_experience=TrainingExperience.untrained,
                  training_frequency_per_week=3, protein_g_per_kg=1.8, age_years=30)
    lean_gain_lean_man, _ = weekly_body_comp_change(
        weight_kg=75.0, body_fat_pct=15.0, lean_mass_kg=63.75, fat_mass_kg=11.25, **common)
    lean_gain_heavy_man, _ = weekly_body_comp_change(
        weight_kg=160.0, body_fat_pct=50.0, lean_mass_kg=80.0, fat_mass_kg=80.0, **common)
    assert lean_gain_heavy_man < 1.3 * lean_gain_lean_man   # was ~2.1x


def test_more_training_frequency_preserves_more_muscle_in_a_deficit():
    leans = [
        weekly_body_comp_change(
            energy_balance_kcal_week=-500 * 7, **{**BASE, "training_frequency_per_week": f}
        )[0]
        for f in (0, 1, 2, 3)
    ]
    assert leans == sorted(leans)  # more frequency -> less negative lean delta
