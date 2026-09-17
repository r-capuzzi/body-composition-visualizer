// Options + helper text for the two training inputs. Values match
// TrainingExperience in backend/models.py and the 0-7 range the API allows.

export const TRAINING_EXPERIENCE = [
  {
    value: "untrained",
    label: "New to lifting",
    summary: "Less than a year of consistent resistance training.",
  },
  {
    value: "novice",
    label: "Novice",
    summary: "Roughly 1-2 years training consistently.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    summary: "Roughly 2-5 years. Progress has slowed from the early days.",
  },
  {
    value: "advanced",
    label: "Advanced",
    summary: "5+ years. Close to your natural ceiling; gains are slow.",
  },
];

// training_frequency_per_week is an integer 0-7: how often EACH major muscle
// group is trained. This maps a number to a short description for the slider.
export function describeTrainingFrequency(timesPerWeek) {
  if (timesPerWeek <= 0) return "Not resistance training";
  if (timesPerWeek === 1) return "Each muscle once a week";
  if (timesPerWeek === 2) return "Each muscle twice a week (a solid default)";
  if (timesPerWeek === 3) return "Each muscle 3x a week (near-optimal)";
  return `Each muscle ${timesPerWeek}x a week (no extra benefit past ~3)`;
}
