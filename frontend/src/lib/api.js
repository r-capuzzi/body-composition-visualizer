// Thin wrapper around the FastAPI backend. Keeping the fetch call in one place
// means components never touch URLs or JSON parsing directly.

// Reads VITE_API_BASE from the environment (set it in .env.local, or as a
// build-time env var on whatever host runs the frontend) so a deployed build
// can point at a real backend URL instead of the local dev server.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/**
 * POST the form values to /calculate and return the parsed CalculateResponse.
 * `payload` must already be in METRIC units and match CalculateRequest.
 * Throws an Error with a readable message if the request fails or the backend
 * rejects the input (HTTP 422).
 */
export async function calculateProjection(payload) {
  let response;
  try {
    response = await fetch(`${API_BASE}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    // fetch only rejects on network failure (server down, CORS, offline)
    throw new Error(
      "Could not reach the calculation server. Is the backend running on " +
        `${API_BASE}?`
    );
  }

  if (!response.ok) {
    // FastAPI validation errors come back as {detail: [{loc, msg, ...}]}
    let detail;
    try {
      const body = await response.json();
      detail = Array.isArray(body.detail)
        ? body.detail.map(describeValidationError).filter(Boolean).join("; ")
        : body.detail;
    } catch {
      detail = null;
    }
    throw new Error(detail || `Server error (HTTP ${response.status})`);
  }

  return response.json();
}

// The API speaks in schema field names; the person reading the error does not.
// Pydantic hands back e.g. {loc: ["body","body_fat_pct"], msg: "Input should be
// less than or equal to 60"}, and a model-level check (the BMI plausibility
// rule) reports loc ["body"] with a "Value error, " prefix - which rendered as
// the meaningless "body: Value error, ..." before this.
const FIELD_LABELS = {
  sex: "Sex",
  age_years: "Age",
  height_cm: "Height",
  weight_kg: "Weight",
  body_fat_pct: "Body fat %",
  activity_level: "Activity level",
  training_experience: "Training experience",
  training_frequency_per_week: "Training frequency",
  protein_g_per_kg: "Protein",
  planned_daily_calories: "Planned daily calories",
  plan_duration_weeks: "Plan length",
};

export function describeValidationError(d) {
  const msg = String(d?.msg ?? "")
    .replace(/^Value error,\s*/i, "")
    .replace(/^Input should be/i, "must be");
  if (!msg) return "";
  const field = d?.loc?.at(-1);
  // "body" means the whole request object failed a cross-field rule, and that
  // message already names the fields it is about - a prefix would add nothing.
  if (!field || field === "body") return msg;
  return `${FIELD_LABELS[field] || field}: ${msg}`;
}
