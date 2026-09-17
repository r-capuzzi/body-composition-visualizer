// The five activity levels the API accepts, each with plain-language examples so
// a non-technical user can place themselves correctly. `value` is exactly the
// string the backend expects (see ActivityLevel in backend/models.py).
//
// These describe TOTAL weekly activity including all exercise (the standard
// Mifflin/Katch activity factor). The multiplier is shown so the user can see
// how big a difference one step makes (~11% of maintenance per step).

export const ACTIVITY_LEVELS = [
  {
    value: "sedentary",
    label: "Sedentary",
    multiplier: 1.2,
    summary: "Desk-bound, little to no exercise.",
    examples: [
      "Office / remote job, sitting most of the day",
      "Drive or transit everywhere, under ~5,000 steps a day",
      "No regular workouts, or the odd walk only",
    ],
  },
  {
    value: "light",
    label: "Lightly active",
    multiplier: 1.375,
    summary: "Mostly seated, plus light exercise 1-3 days a week.",
    examples: [
      "Desk job, but you walk a bit through the day (~5,000-7,500 steps)",
      "1-3 easy sessions a week: walking, light cycling, casual gym",
      "This is where most people who lift 2-3x/week and do nothing else land",
    ],
  },
  {
    value: "moderate",
    label: "Moderately active",
    multiplier: 1.55,
    summary: "On your feet a fair amount, or real exercise 3-5 days a week.",
    examples: [
      "Job that keeps you moving: teacher, nurse, retail, server (~7,500-10,000 steps)",
      "Desk job + 3-5 genuine training sessions a week (lifting + some cardio)",
      "Recreational sport a couple times a week on top of daily walking",
    ],
  },
  {
    value: "active",
    label: "Very active",
    multiplier: 1.725,
    summary: "Physically demanding day, or hard training 6-7 days a week.",
    examples: [
      "Physical trade: construction, warehouse, landscaping, mail carrier (10,000-15,000+ steps)",
      "Desk job + hard training almost every day (running, competitive sport, CrossFit)",
      "Train twice most days but with a sedentary job",
    ],
  },
  {
    value: "very_active",
    label: "Extremely active",
    multiplier: 1.9,
    summary: "Hard physical job AND intense daily training.",
    examples: [
      "Labourer or full-time athlete who also trains hard on top of the workday",
      "Two-a-day training while on your feet all day",
      "Military selection, tree surgery, competitive endurance blocks",
    ],
  },
];
