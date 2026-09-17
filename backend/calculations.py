"""
Per-week body-composition physiology – the "science" layer. Every function here
answers a single-week or single-formula question; the time loop that calls them
lives in projection.py. Kept separate from the web layer (main.py) so it can be
unit-tested on its own.

==============================================================================
SOURCES for the constants (keep these for the "how were the numbers derived?"
interview question):

* BMR – Mifflin-St Jeor (Am J Clin Nutr 1990), the standard prediction equation;
  and Katch-McArdle (BMR from lean body mass), which needs no age and is more
  accurate for lean/muscular people. We blend the two 50/50.

* Energy density of tissue – adipose ~9,400 kcal/kg (it is ~87% lipid x 9,441);
  skeletal muscle ~1,800 kcal/kg (mostly water). The old flat "7,700 kcal/kg of
  body weight" is a blend that misattributes energy when the mass change is part
  muscle – so we solve fat and lean changes against their real densities.

* Natural muscle-gain rates by training age – Aragon's rate-of-gain model and
  Helms et al. "Muscle & Strength Pyramid": ~1.0-1.5 %BW/month beginner,
  0.5-1.0 % intermediate, 0.25-0.5 % advanced; women ~half. Our constants sit at
  or BELOW the low end on purpose (this tool should under-promise – a user
  should beat the projection, not fall short of it).

* Muscle loss in a deficit – Murphy & Koehler (Scand J Med Sci Sports 2022),
  Roth 2023: resistance training cuts the lean fraction of weight lost from ~25%
  to ~10-12%; deficits > ~500 kcal/day make it worse.

* Training frequency – Schoenfeld/Grgic/Krieger meta-analyses (2016, 2019):
  volume-equated, 2x/week > 1x/week, little benefit past ~3x. MPS elevated ~24h
  trained / ~48-72h untrained (Damas et al. 2021).

* Metabolic adaptation – Trexler, Smith-Ryan & Norton (J Int Soc Sports Nutr
  2014); Rosenbaum & Leibel 2010. Dieting suppresses TDEE beyond the mass-loss
  effect (NEAT drop, hormonal downshift). See metabolic_adaptation_factor().

* Energy partitioning by body fat – Forbes (2000); Hall (2007-2010): at low body
  fat a larger share of any energy imbalance is lean tissue; at high body fat
  the body gives up fat more readily and spares/builds muscle better.

* Protein & muscle retention – Longland et al. 2016 (2.4 vs 1.2 g/kg during a
  deficit); Helms et al. 2014; Morton et al. 2018 meta.

* Anabolic resistance with age – Breen & Phillips 2011: the muscle-protein-
  synthesis response to training and protein blunts from roughly the mid-40s.
==============================================================================
"""

import math

from models import ActivityLevel, Sex, TrainingExperience

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

# Reference only: a "1 kg of body weight" energy figure, used to keep the
# deficit-driven muscle-loss model calibrated to the same scale as the research
# it came from. Real mass changes are solved with the two densities below.
KCAL_PER_KG_BODY_MASS = 7700.0

ADIPOSE_KCAL_PER_KG = 9400.0   # energy released/stored per kg of fat mass
LEAN_KCAL_PER_KG = 1800.0      # energy released/stored per kg of lean mass

ACTIVITY_MULTIPLIERS = {
    ActivityLevel.sedentary: 1.2,
    ActivityLevel.light: 1.375,
    ActivityLevel.moderate: 1.55,
    ActivityLevel.active: 1.725,
    ActivityLevel.very_active: 1.9,
}

# Muscle-gain ceiling as a fraction of body weight PER MONTH, for men. Women:
# half (FEMALE_MUSCLE_RATE_FACTOR). Deliberately conservative – see module docs.
MUSCLE_GAIN_RATE_PCT_BW_PER_MONTH = {
    TrainingExperience.untrained: 0.0080,
    TrainingExperience.novice: 0.0040,
    TrainingExperience.intermediate: 0.0025,
    TrainingExperience.advanced: 0.0010,
}
FEMALE_MUSCLE_RATE_FACTOR = 0.5

# Anabolic "stimulus" 0.0-1.0 by weekly training frequency per muscle group.
MUSCLE_STIMULUS_BY_FREQUENCY = {0: 0.00, 1: 0.70, 2: 0.92, 3: 1.00}
MAX_STIMULUS_FREQUENCY = 3

# Hard floor on fat mass, as a fraction of body weight (essential fat).
ESSENTIAL_FAT_FRACTION = {Sex.male: 0.04, Sex.female: 0.12}

# Hard floor on lean mass, as a fraction of body weight - bone, organs and
# essential water alone are a non-trivial share of body weight regardless of
# how little muscle someone carries. Without this, a sustained enough deficit
# (nothing exotic - just enough weeks at a low enough fixed calorie intake)
# drives lean mass toward 0 with no floor pushing back, the mirror image of
# what ESSENTIAL_FAT_FRACTION already prevents on the fat side.
ESSENTIAL_LEAN_FRACTION = {Sex.male: 0.35, Sex.female: 0.30}

# Body-fat % where partitioning is "neutral" (favorability == 1.0).
BODY_FAT_NEUTRAL_PCT = {Sex.male: 15.0, Sex.female: 23.0}


# --------------------------------------------------------------------------- #
# Energy expenditure
# --------------------------------------------------------------------------- #

def bmr_mifflin_st_jeor(
    sex: Sex, weight_kg: float, height_cm: float, age_years: int
) -> float:
    """Resting calories/day. Mifflin-St Jeor (1990)."""
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age_years
    return base + 5 if sex == Sex.male else base - 161


def bmr_katch_mcardle(lean_mass_kg: float) -> float:
    """Resting calories/day from lean body mass. Katch-McArdle."""
    return 370 + 21.6 * lean_mass_kg


def blended_bmr(
    sex: Sex, weight_kg: float, height_cm: float, age_years: int, lean_mass_kg: float
) -> float:
    """50/50 blend of the two BMR estimators. Katch-McArdle rewards muscle and
    needs no age; Mifflin is more robust when the body-fat input is a rough
    guess. Averaging hedges the error in either direction."""
    mifflin = bmr_mifflin_st_jeor(sex, weight_kg, height_cm, age_years)
    katch = bmr_katch_mcardle(lean_mass_kg)
    return 0.5 * mifflin + 0.5 * katch


def tdee(bmr: float, activity_level: ActivityLevel) -> float:
    """Total Daily Energy Expenditure before metabolic adaptation."""
    return bmr * ACTIVITY_MULTIPLIERS[activity_level]


def metabolic_adaptation_factor(
    weeks_in_deficit: float, deficit_fraction: float
) -> float:
    """Multiplier (<= 1.0) applied to TDEE for 'adaptive thermogenesis' – the
    extra fall in energy expenditure during a diet, beyond what losing body mass
    already explains (reduced NEAT/fidgeting, hormonal downshift, greater
    mechanical efficiency). Trexler et al. 2014; Rosenbaum & Leibel 2010.

    Args:
        weeks_in_deficit: how long the person has been in a calorie deficit.
        deficit_fraction: current daily deficit / maintenance. 0.0 at or above
            maintenance; ~0.10 mild cut; ~0.25+ aggressive cut.

    Returns 1.0 (no adaptation) whenever deficit_fraction <= 0.

    Calibration:
      - Depth: adaptive thermogenesis during active restriction averages
        ~100 kcal/day (Muller 2016; Nunes 2022) ~= 3-4% of a typical TDEE for a
        moderate cut, rising to ~10-15% for aggressive/prolonged physique-style
        dieting (Trexler 2014; physique-athlete data). We map deficit_fraction
        linearly to a max suppression, capped at 15%.
      - Time course: it builds over weeks, not instantly - roughly half by
        ~3-4 weeks, near-full by ~12. Modelled as an exponential approach with
        a 5-week time constant.
    """
    if deficit_fraction <= 0.0:
        return 1.0

    max_suppression = min(deficit_fraction * 0.40, 0.15)
    time_ramp = 1.0 - math.exp(-weeks_in_deficit / 5.0)
    factor = 1.0 - max_suppression * time_ramp
    return max(0.82, min(1.0, factor))


# --------------------------------------------------------------------------- #
# Modifiers on the muscle model
# --------------------------------------------------------------------------- #

def muscle_stimulus_factor(training_frequency_per_week: int) -> float:
    """0.0-1.0 multiplier for how well the training schedule drives / defends
    muscle mass. See MUSCLE_STIMULUS_BY_FREQUENCY."""
    freq = min(training_frequency_per_week, MAX_STIMULUS_FREQUENCY)
    return MUSCLE_STIMULUS_BY_FREQUENCY[freq]


def partition_favorability(body_fat_pct: float, sex: Sex) -> float:
    """>1.0 when body fat is high (partitioning is favourable: fat comes off
    readily, muscle is spared, recomp is easier); <1.0 when lean (the reverse).
    Forbes 2000; Hall. Pivot at 15% (men) / 23% (women); clamped to [0.65, 1.35].
    """
    pivot = BODY_FAT_NEUTRAL_PCT[sex]
    raw = 1.0 + (body_fat_pct - pivot) * 0.025
    return max(0.65, min(1.35, raw))


def age_anabolic_modifier(age_years: int) -> float:
    """Muscle-building/retention capacity vs age. Flat until ~45, then ~1%/year
    decline (anabolic resistance), floored at 0.5. Breen & Phillips 2011."""
    return max(0.5, 1.0 - 0.01 * max(0, age_years - 45))


def protein_anabolic_modifier(protein_g_per_kg: float) -> float:
    """How well protein intake supports muscle GAIN/retention. 0.75 at 1.0 g/kg,
    ramping to 1.0 at 2.2 g/kg (near-maximal), flat outside. Morton 2018."""
    lo, hi = 1.0, 2.2
    t = (min(max(protein_g_per_kg, lo), hi) - lo) / (hi - lo)
    return 0.75 + t * (1.0 - 0.75)


def protein_catabolic_modifier(protein_g_per_kg: float) -> float:
    """How protein intake scales muscle LOSS in a deficit. 1.3 at 1.0 g/kg (more
    loss), 0.8 at 2.2 g/kg (less loss). Longland 2016."""
    lo, hi = 1.0, 2.2
    t = (min(max(protein_g_per_kg, lo), hi) - lo) / (hi - lo)
    return 1.3 - t * (1.3 - 0.8)


def weekly_muscle_gain_cap_kg(
    sex: Sex, weight_kg: float, training_experience: TrainingExperience
) -> float:
    """The monthly %-bodyweight ceiling converted to an absolute kg/week limit."""
    monthly_kg = MUSCLE_GAIN_RATE_PCT_BW_PER_MONTH[training_experience] * weight_kg
    if sex == Sex.female:
        monthly_kg *= FEMALE_MUSCLE_RATE_FACTOR
    return monthly_kg * 12 / 52  # months -> weeks


# --------------------------------------------------------------------------- #
# The core: one week of body-composition change
# --------------------------------------------------------------------------- #

def weekly_body_comp_change(
    *,
    energy_balance_kcal_week: float,
    sex: Sex,
    weight_kg: float,
    body_fat_pct: float,
    lean_mass_kg: float,
    fat_mass_kg: float,
    training_experience: TrainingExperience,
    training_frequency_per_week: int,
    protein_g_per_kg: float,
    age_years: int,
    anabolic_scale: float = 1.0,
) -> tuple[float, float]:
    """Split one week of energy imbalance into (lean_delta_kg, fat_delta_kg).

    Approach:
      1. Decide the LEAN change from biology: anabolic build - catabolic loss,
         each scaled by training, protein, age and body-fat favorability.
      2. Solve the FAT change from the energy books:
             E = lean_delta * LEAN_KCAL_PER_KG + fat_delta * ADIPOSE_KCAL_PER_KG
      3. Clamp fat at the essential-fat floor; any shortfall is forced onto lean
         (the body cannot burn fat it does not have).
    """
    stimulus = muscle_stimulus_factor(training_frequency_per_week)
    favor = partition_favorability(body_fat_pct, sex)
    age_mod = age_anabolic_modifier(age_years)
    prot_ana = protein_anabolic_modifier(protein_g_per_kg)
    prot_cat = protein_catabolic_modifier(protein_g_per_kg)

    anabolic_potential = (
        weekly_muscle_gain_cap_kg(sex, weight_kg, training_experience)
        * stimulus
        * age_mod
        * prot_ana
        * anabolic_scale
    )

    daily_balance = energy_balance_kcal_week / 7.0

    if energy_balance_kcal_week >= 0:
        # SURPLUS: build the training-driven ceiling; the surplus only decides
        # how much fat rides along (solved below).
        built_kg = anabolic_potential
        lost_kg = 0.0
    else:
        deficit_daily = -daily_balance

        # (a) recomposition: shallow deficits still allow muscle gain, drawing
        #     the energy from fat stores. Full near maintenance, gone by
        #     ~500 kcal/day. Favourable partitioning (higher body fat) extends it.
        recomp_factor = max(0.0, min(1.0, (500.0 - deficit_daily) / 400.0))
        # recomp can be helped by favourable partitioning but never beats what a
        # true surplus would build.
        built_kg = min(anabolic_potential, anabolic_potential * recomp_factor * favor)

        # (b) catabolic loss. Calibrated on the research scale (fraction of a
        #     "7700 kcal/kg" reference loss), then converted to kg.
        nominal_loss_kg = deficit_daily * 7 / KCAL_PER_KG_BODY_MASS
        severity = min(deficit_daily / 500.0, 1.0)
        loss_fraction = (0.27 - 0.17 * stimulus) * severity
        loss_fraction *= prot_cat          # low protein -> more loss
        loss_fraction /= favor             # leaner -> more loss
        loss_fraction += 0.15 * max(0.0, nominal_loss_kg - 0.7)  # aggressive cut

        # near the essential-fat floor the body protects fat and burns muscle
        floor_kg = ESSENTIAL_FAT_FRACTION[sex] * weight_kg
        headroom = max(0.0, fat_mass_kg - floor_kg) / max(fat_mass_kg, 1e-6)
        if headroom < 0.25:
            loss_fraction *= 1.0 + (0.25 - headroom) / 0.25   # up to 2x at floor

        loss_fraction = min(loss_fraction, 0.6)
        lost_kg = nominal_loss_kg * loss_fraction

    lean_delta = built_kg - lost_kg
    fat_delta = (
        energy_balance_kcal_week - lean_delta * LEAN_KCAL_PER_KG
    ) / ADIPOSE_KCAL_PER_KG

    # Essential-fat floor: fat cannot go below it; force the rest onto lean.
    floor_kg = ESSENTIAL_FAT_FRACTION[sex] * weight_kg
    if fat_mass_kg + fat_delta < floor_kg:
        fat_delta = floor_kg - fat_mass_kg
        lean_delta = (
            energy_balance_kcal_week - fat_delta * ADIPOSE_KCAL_PER_KG
        ) / LEAN_KCAL_PER_KG

    # Mirror image on lean: a long enough deficit at fixed calories can push
    # this past the fat floor above and keep drawing the shortfall from lean
    # (bone/organs/water, not just muscle) with nothing to stop it otherwise.
    lean_floor_kg = ESSENTIAL_LEAN_FRACTION[sex] * weight_kg
    if lean_mass_kg + lean_delta < lean_floor_kg:
        lean_delta = lean_floor_kg - lean_mass_kg
        fat_delta = (
            energy_balance_kcal_week - lean_delta * LEAN_KCAL_PER_KG
        ) / ADIPOSE_KCAL_PER_KG

    return lean_delta, fat_delta
