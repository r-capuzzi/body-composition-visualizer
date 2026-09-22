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
 * Fat-Free Mass Index: lean mass normalised for height (kg / m²), the standard
 * way to compare muscularity across body sizes. See FFMI_REFERENCE for what
 * the numbers mean for each sex.
 */
export function ffmi(leanMassKg, heightCm) {
  const heightM = heightCm / 100;
  return leanMassKg / (heightM * heightM);
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
  // fat: body-fat % across a lean-athlete -> high range (drives morph SHAPE)
  const fat = clamp01((point.body_fat_pct - 6) / (40 - 6));

  // muscle: FFMI from a little below this sex's untrained level (-> 0) up to
  // near its natural ceiling (-> 1)
  const { morphZero, morphFull } = ffmiReference(sex);
  const muscle = clamp01((ffmi(point.lean_mass_kg, heightCm) - morphZero) / (morphFull - morphZero));

  // size: BMI, used by BodyModel to scale the mesh to the person's real mass
  // so composition changes don't change overall size.
  const heightM = heightCm / 100;
  const bmi = point.weight_kg / (heightM * heightM);

  return { muscle, fat, bmi, heightM };
}

export { clamp01 };
