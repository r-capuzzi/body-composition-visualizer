// Quick-fill presets for people who'd rather pick a body type than dial in an
// exact body fat % and weight. body_fat_pct is sex-specific and set to what
// that body type actually tests at (e.g. "lean" is not the same % for men and
// women) - real accuracy takes priority over landing exactly on a morph
// target's full strength, unlike an earlier version of this file.
// "Muscular" also sets weight, via targetFfmi, so the derived FFMI (and so
// the muscle-morph influence in bodyParamsFromStats) actually reflects an
// athletic build instead of drifting with whatever weight was already typed
// in - body_fat_pct alone can't do that, since muscle mass isn't a form field.
export const BODY_TYPE_PRESETS = [
  {
    value: "muscular",
    label: "Muscular / athletic",
    bodyFatPct: { male: 16, female: 21 },
    // sex-specific, like body fat - see FFMI_REFERENCE in bodyParams.js
    targetFfmi: { male: 24, female: 20.5 },
  },
  {
    value: "lean",
    label: "Lean",
    bodyFatPct: { male: 12, female: 18 },
  },
  {
    value: "average",
    label: "Average",
    // The US female population average (~40%) skews obese; that group would
    // already pick "Overweight", so this is a non-obese "typical" average instead.
    bodyFatPct: { male: 23, female: 28 },
  },
  {
    value: "overweight",
    label: "Overweight",
    // each sex's full heavy-morph point (FAT_REFERENCE.morphFull) - 40% is
    // far heavier on a man than on a woman
    bodyFatPct: { male: 40, female: 48 },
  },
];
