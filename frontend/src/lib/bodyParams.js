// Turns a projection point (weight / lean mass / fat %) into the numbers the 3D
// BodyModel needs: `muscle` and `fat` drive the morph *shape*; `bmi` drives the
// physics-based *size* (weight/height only - see BodyModel's doc comment for
// why body-fat % isn't part of sizing at all).

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * FFMI reference points by sex. Women run ~3.5 lower at every level: the
 * adult (18-34) medians are 18.9 vs 15.4 in Schutz et al. 2002 (n ~5,600,
 * Int J Obes). These used to be the male values for everyone, so the female
 * "Muscular" preset targeted FFMI 24 - giving a 165cm woman 65kg of lean mass,
 * more than the app's default man - and the muscle morph couldn't reach full
 * strength for any natural woman short of the top few percent.
 * Female upper end: strength-sport collegiate athletes sit ~20-22 and the
 * 97.5th percentile is 23.9 (Harty et al. 2019, J Sports Sci), so 22 as
 * "elite" is well-supported and deliberately not the extreme tail.
 *   average/trained/elite - the reference line shown under the FFMI card
 *   morphZero/morphFull   - where the avatar's muscle morph starts and
 *                           saturates (the same 3.5 offset between sexes)
 *   presetMuscular        - mirrors bodyTypePresets' Muscular targetFfmi
 */
export const FFMI_REFERENCE = {
  male: { average: 19, trained: 22, elite: 25, morphZero: 16, morphFull: 24, presetMuscular: 24 },
  female: { average: 15, trained: 18, elite: 22, morphZero: 12.5, morphFull: 20.5, presetMuscular: 20.5 },
};
export const ffmiReference = (sex) => FFMI_REFERENCE[sex === "female" ? "female" : "male"];

/**
 * Body-fat % where the avatar's fat axis starts (lean morph at full) and
 * saturates (heavy morph at full), by sex. This used to be 6-40% for
 * everyone, which put the neutral mesh at 23% on both - average for a man,
 * but lean for a woman, so a normal-BMI woman at a typical 32% already grew a
 * belly roll. Women carry more essential and typical fat at every level: the
 * ACE categories run 7-8 points higher for women (athletes 14-20 vs 6-13,
 * obese 32+ vs 25+). The female range is shifted by 8. Gallagher et al. 2000
 * (Am J Clin Nutr, BMI vs %fat) puts the gap nearer 12-13, so 8 is the
 * cautious end: if anything she still reads slightly heavier, not leaner.
 */
export const FAT_REFERENCE = {
  male: { morphZero: 6, morphFull: 40 },
  female: { morphZero: 14, morphFull: 48 },
};
export const fatReference = (sex) => FAT_REFERENCE[sex === "female" ? "female" : "male"];

/**
 * Fat-Free Mass Index: lean mass normalised for height (kg / m²), the standard
 * way to compare muscularity across body sizes. See FFMI_REFERENCE for what
 * the numbers mean for each sex.
 */
export function ffmi(leanMassKg, heightCm) {
  const heightM = heightCm / 100;
  return leanMassKg / (heightM * heightM);
}

/**
 * FFMI with the lean mass that simply comes with carrying more fat taken
 * out - what the muscle MORPH should see. Lean mass rises with fat mass
 * without any training (bigger skeleton, organs, water, the muscle it takes
 * to carry the weight): Forbes's curve, FFM = 10.4 ln(FM) + 14.2 kg (Forbes
 * 1987, as restated in Hall 2007, Br J Nutr 97:1059). Raw FFMI put a 145kg
 * man at 42% (FFMI 26.5) past an 85kg lifter at 10% (24.1), so every obese
 * body got the full bodybuilder morph. Past each sex's reference fat mass,
 * the 10.4 ln(FM / FM_ref) kg Forbes attributes to the extra fat is taken
 * off first. FM_ref is the app's own neutral point - median FFMI at the
 * neutral body fat (FFMI_REFERENCE.average, FAT_REFERENCE midpoint), FMI
 * 5.65 men / 6.92 women. One-sided on purpose: below it the curve would
 * credit a lean body with muscle it hasn't built.
 * The FFMI card still shows the real FFMI; this only feeds the morph.
 */
const FORBES_FFM_PER_LN_FM = 10.4;
export function morphFfmi(leanMassKg, fatMassKg, heightCm, sex = "male") {
  const h2 = (heightCm / 100) ** 2;
  const { average } = ffmiReference(sex);
  const { morphZero, morphFull } = fatReference(sex);
  const neutralFat = (morphZero + morphFull) / 2 / 100;
  const fmRef = ((average * neutralFat) / (1 - neutralFat)) * h2;
  const excess = fatMassKg > fmRef ? FORBES_FFM_PER_LN_FM * Math.log(fatMassKg / fmRef) : 0;
  return (leanMassKg - excess) / h2;
}

/**
 * Inverse of ffmi(): the bodyweight (kg) that produces a given FFMI at a given
 * body-fat % and height. Used to anchor a body-type preset's weight so the
 * derived `muscle` score in bodyParamsFromStats actually reaches the target,
 * instead of only setting body_fat_pct and leaving muscle wherever the
 * person's current weight happens to put it.
 */
export function weightForFfmi(targetFfmi, bodyFatPct, heightCm) {
  const heightM = heightCm / 100;
  const leanMassKg = targetFfmi * heightM * heightM;
  return leanMassKg / (1 - bodyFatPct / 100);
}

/**
 * Maps a projection point to the avatar's `muscle`/`fat` 0..1 shape inputs
 * (plus `bmi`/`heightM` for sizing - see the module doc above).
 * @param {{lean_mass_kg:number, fat_mass_kg:number, body_fat_pct:number}} point
 * @param {number} heightCm
 * @param {"male"|"female"} [sex]
 * @returns {{muscle:number, fat:number, bmi:number, heightM:number}}
 */
export function bodyParamsFromStats(point, heightCm, sex = "male") {
  // fat: body-fat % across this sex's lean-athlete -> high range (drives
  // morph SHAPE; see FAT_REFERENCE)
  const fatRef = fatReference(sex);
  const fat = clamp01((point.body_fat_pct - fatRef.morphZero) / (fatRef.morphFull - fatRef.morphZero));

  // muscle: FFMI from a little below this sex's untrained level (-> 0) up to
  // near its natural ceiling (-> 1), net of fat-driven lean (see morphFfmi)
  const { morphZero, morphFull } = ffmiReference(sex);
  const fatMassKg = point.fat_mass_kg ?? point.weight_kg * (point.body_fat_pct / 100);
  const m = Number.isFinite(fatMassKg)
    ? morphFfmi(point.lean_mass_kg, fatMassKg, heightCm, sex)
    : ffmi(point.lean_mass_kg, heightCm);
  const muscle = clamp01((m - morphZero) / (morphFull - morphZero));

  // size: BMI, used by BodyModel to scale the mesh to the person's real mass
  // so composition changes don't change overall size.
  const heightM = heightCm / 100;
  const bmi = point.weight_kg / (heightM * heightM);

  return { muscle, fat, bmi, heightM };
}

export { clamp01 };
