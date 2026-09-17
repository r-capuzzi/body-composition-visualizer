// Turns a projection point (weight / lean mass / fat %) into the numbers the 3D
// BodyModel needs: `muscle` and `fat` drive the morph *shape*; `bmi` drives the
// physics-based *size* (weight/height only - see BodyModel's doc comment for
// why body-fat % isn't part of sizing at all).

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Fat-Free Mass Index: lean mass normalised for height (kg / m²), the standard
 * way to compare muscularity across body sizes.
 * Reference: ~19 average, ~22 well-trained natural, ~25 near the natural limit.
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
 * @returns {{muscle:number, fat:number, bmi:number, heightM:number}}
 */
export function bodyParamsFromStats(point, heightCm) {
  // fat: body-fat % across a lean-athlete -> high range (drives morph SHAPE)
  const fat = clamp01((point.body_fat_pct - 6) / (40 - 6));

  // muscle: FFMI mapped so ~16 (untrained) -> 0 and ~24 (near ceiling) -> 1
  const muscle = clamp01((ffmi(point.lean_mass_kg, heightCm) - 16) / (24 - 16));

  // size: BMI, used by BodyModel to scale the mesh to the person's real mass
  // so composition changes don't change overall size.
  const heightM = heightCm / 100;
  const bmi = point.weight_kg / (heightM * heightM);

  return { muscle, fat, bmi, heightM };
}

export { clamp01 };
