// Unit conversion helpers. The UI lets the user work in metric OR imperial, but
// the API only ever sees metric (kg, cm) - so we convert right before sending.
//
// Keeping these as tiny pure functions (no React, no state) makes them trivial
// to test and reason about.

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;

// --- metric -> imperial (for displaying results / prefilling the imperial form)

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

export function cmToIn(cm) {
  return cm / CM_PER_INCH;
}

export function cmToFeetInches(cm) {
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches - feet * INCHES_PER_FOOT;
  return { feet, inches };
}

// --- imperial -> metric (what we send to the API)

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

/**
 * Convert a height given as feet + inches into centimetres.
 *   feetInchesToCm(5, 10) -> 177.8
 *   feetInchesToCm(0, 70) -> 177.8   (inches-only also works)
 */
export function feetInchesToCm(feet, inches) {
  return (Number(feet) * INCHES_PER_FOOT + Number(inches)) * CM_PER_INCH;
}

export function inToCm(inches) {
  return inches * CM_PER_INCH;
}
