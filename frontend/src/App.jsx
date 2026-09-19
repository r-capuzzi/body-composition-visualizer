import { lazy, Suspense, useEffect, useState } from "react";

import "./App.css";

import {
  cmToFeetInches,
  cmToIn,
  feetInchesToCm,
  inToCm,
  kgToLb,
  lbToKg,
} from "./lib/units";
import { TRAINING_EXPERIENCE, describeTrainingFrequency } from "./lib/trainingLevels";
import { BODY_TYPE_PRESETS } from "./lib/bodyTypePresets";
import { bodyParamsFromStats, weightForFfmi } from "./lib/bodyParams";
import { getBodyData, blendPositions, measureRegions, rawToCm } from "./lib/bodyMesh";
import { useProjection } from "./hooks/useProjection";
import { usePersistentState } from "./hooks/usePersistentState";
import ActivityPicker from "./components/ActivityPicker";

// ResultsPanel pulls in recharts (plus, transitively, the avatar's own
// React.lazy'd three.js chunk) - neither is needed for the very first paint,
// which is just the input form. Same reasoning as AvatarScene's own lazy load
// one level down: keep heavy, not-immediately-needed JS out of the critical
// path instead of blocking on it before the form is even interactive.
const ResultsPanel = lazy(() => import("./components/ResultsPanel"));

const round1 = (n) => Math.round(n * 10) / 10;

// The whole form lives in one state object. Each <input> is "controlled":
// its displayed value comes from state, and every keystroke calls updateField,
// which produces a NEW object (never mutate state in React) so the component
// re-renders with the new value.
const INITIAL_FORM = {
  sex: "male",
  age_years: 28,
  // metric height/weight
  height_cm: 178,
  weight_kg: 78,
  // imperial mirrors (kept in sync when the unit toggle is flipped)
  height_ft: 5,
  height_in: 10,
  weight_lb: 172,
  body_fat_pct: 20,
  activity_level: "moderate",
  training_experience: "intermediate",
  training_frequency_per_week: 3,
  protein_g_per_kg: 1.8,
  planned_daily_calories: 2400,
  plan_duration_weeks: 16,
  // Optional avatar-only refinements (lib/bodyParams.js's fat/muscle estimate
  // is used for any of these left blank) - never sent to the API, they don't
  // affect the calorie math. Metric/imperial mirrors, kept in sync in
  // switchUnits the same way height/weight are.
  measure_shoulder_cm: "",
  measure_chest_cm: "",
  measure_waist_cm: "",
  measure_hip_cm: "",
  measure_arm_cm: "",
  measure_shoulder_in: "",
  measure_chest_in: "",
  measure_waist_in: "",
  measure_hip_in: "",
  measure_arm_in: "",
};

// The optional tape measurements. Bounds are real anthropometric ranges
// (NHANES/ACE-style references, see project memory) - roughly petite to
// plus-size/heavyweight - and they do double duty: each input's own min/max,
// and in buildMeasurements the line between a measurement and a number still
// being typed.
const MEASURE_FIELDS = [
  { key: "shoulder", label: "Shoulder width", cm: [30, 60], in: [12, 24] },
  { key: "chest", label: "Chest / bust", cm: [70, 160], in: [28, 63] },
  { key: "waist", label: "Waist", cm: [55, 180], in: [22, 71] },
  { key: "hip", label: "Hips", cm: [60, 170], in: [24, 67] },
  { key: "arm", label: "Upper arm", cm: [18, 55], in: [7, 22] },
];

// Empty-string-safe unit conversion for the optional measurement fields -
// "" means "not provided", and should stay "" rather than becoming NaN/"0".
const convertMeasure = (raw, convert) =>
  raw === "" || raw == null ? "" : round1(convert(Number(raw)));

export default function App() {
  // Persisted across reloads (localStorage). "bcv." namespaces our keys.
  const [units, setUnits] = usePersistentState("bcv.units", "metric");
  const [form, setForm] = usePersistentState("bcv.form", INITIAL_FORM);
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState("");

  const updateField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  function resetAll() {
    setForm(INITIAL_FORM);
    setUnits("metric");
  }

  // Flip units and convert the current height/weight so the number the user
  // sees stays physically the same.
  function switchUnits(next) {
    if (next === units) return;
    setForm((f) => {
      if (next === "imperial") {
        let { feet, inches } = cmToFeetInches(Number(f.height_cm));
        inches = Math.round(inches); // height fields hold whole inches only
        if (inches === 12) {
          feet += 1;
          inches = 0;
        }
        return {
          ...f,
          height_ft: feet,
          height_in: inches,
          weight_lb: round1(kgToLb(Number(f.weight_kg))),
          measure_shoulder_in: convertMeasure(f.measure_shoulder_cm, cmToIn),
          measure_chest_in: convertMeasure(f.measure_chest_cm, cmToIn),
          measure_waist_in: convertMeasure(f.measure_waist_cm, cmToIn),
          measure_hip_in: convertMeasure(f.measure_hip_cm, cmToIn),
          measure_arm_in: convertMeasure(f.measure_arm_cm, cmToIn),
        };
      }
      return {
        ...f,
        height_cm: round1(
          feetInchesToCm(Number(f.height_ft), Number(f.height_in))
        ),
        weight_kg: round1(lbToKg(Number(f.weight_lb))),
        measure_shoulder_cm: convertMeasure(f.measure_shoulder_in, inToCm),
        measure_chest_cm: convertMeasure(f.measure_chest_in, inToCm),
        measure_waist_cm: convertMeasure(f.measure_waist_in, inToCm),
        measure_hip_cm: convertMeasure(f.measure_hip_in, inToCm),
        measure_arm_cm: convertMeasure(f.measure_arm_in, inToCm),
      };
    });
    setUnits(next);
  }

  // Fill in body_fat_pct (sex-specific - see lib/bodyTypePresets.js) and, for
  // "Muscular", weight too, so the derived FFMI actually reaches an athletic
  // build instead of drifting with whatever weight was already typed in.
  function applyBodyTypePreset(presetValue) {
    const preset = BODY_TYPE_PRESETS.find((p) => p.value === presetValue);
    if (!preset) return;
    setForm((f) => {
      const bodyFatPct = preset.bodyFatPct[f.sex];
      const next = { ...f, body_fat_pct: bodyFatPct };
      if (preset.targetFfmi != null) {
        const heightCm =
          units === "metric"
            ? Number(f.height_cm)
            : feetInchesToCm(Number(f.height_ft), Number(f.height_in));
        const weightKg = weightForFfmi(preset.targetFfmi, bodyFatPct, heightCm);
        if (units === "metric") next.weight_kg = round1(weightKg);
        else next.weight_lb = round1(kgToLb(weightKg));
      }
      return next;
    });
  }

  // Assemble the METRIC payload the API expects.
  function buildPayload() {
    const height_cm =
      units === "metric"
        ? Number(form.height_cm)
        : feetInchesToCm(Number(form.height_ft), Number(form.height_in));
    const weight_kg =
      units === "metric"
        ? Number(form.weight_kg)
        : lbToKg(Number(form.weight_lb));

    return {
      sex: form.sex,
      age_years: Number(form.age_years),
      height_cm: round1(height_cm),
      weight_kg: round1(weight_kg),
      body_fat_pct: Number(form.body_fat_pct),
      activity_level: form.activity_level,
      training_experience: form.training_experience,
      training_frequency_per_week: Number(form.training_frequency_per_week),
      protein_g_per_kg: Number(form.protein_g_per_kg),
      planned_daily_calories: Number(form.planned_daily_calories),
      plan_duration_weeks: Number(form.plan_duration_weeks),
    };
  }

  // Avatar-only, in cm regardless of the active unit toggle - kept separate
  // from buildPayload() since the API never sees these. A field stays null
  // (not 0) when blank so BodyModel falls back to the fat/muscle estimate for
  // just that one region instead of collapsing it to zero.
  function buildMeasurements() {
    const metric = units === "metric";
    const out = {};
    for (const { key, cm, in: inches } of MEASURE_FIELDS) {
      const raw = form[`measure_${key}_${metric ? "cm" : "in"}`];
      const num = raw === "" || raw == null ? NaN : Number(raw);
      const [min] = metric ? cm : inches;
      // Below the field's minimum it's a number still being typed, not a
      // measurement: "45" passes through "4" on the way, and these apply
      // live, so the arm visibly shrank to the 60% ratio floor for a
      // keystroke. A prefix is always smaller, so only the lower bound needs
      // to gate - an over-max value is deliberate and clampRatio caps it.
      out[key] = Number.isFinite(num) && num >= min ? (metric ? num : inToCm(num)) : null;
    }
    return out;
  }

  // "Show current measurements" button: a one-shot snapshot of what the
  // avatar's auto-estimate (from height/weight/body fat %, ignoring any
  // override already in these fields) works out to for each region, written
  // in as real, editable starting points. Deliberately NOT a live default
  // recomputed on every render - continuously overwriting these fields as
  // the body-fat slider moves is exactly what caused the wasp-waist pinch
  // fixed earlier (a measurement has to be a snapshot of one moment, not an
  // invariant the slider has to keep re-satisfying). One click, one measure.
  async function fillCurrentMeasurements() {
    // Measure from the last inputs the backend ACCEPTED, not the live form: an
    // empty or half-typed height here used to write "NaN" into all five
    // fields. Once the form settles, `input` equals it anyway.
    if (!input) {
      setMeasureError("Wait for your projection to load, then try again.");
      return;
    }
    setMeasuring(true);
    setMeasureError("");
    try {
      const payload = input;
      const point = {
        weight_kg: payload.weight_kg,
        body_fat_pct: payload.body_fat_pct,
        lean_mass_kg: payload.weight_kg * (1 - payload.body_fat_pct / 100),
      };
      const shape = bodyParamsFromStats(point, payload.height_cm);
      const data = await getBodyData(payload.sex === "female" ? "female" : "male");

      const infMuscle = shape.muscle;
      const infHeavy = Math.max(0, shape.fat * 2 - 1);
      const infLean = Math.max(0, 1 - shape.fat * 2);
      const pos = blendPositions(data, infMuscle, infHeavy, infLean);
      const raw = measureRegions(pos, data.index, data.landmarks);
      const frameScale = Math.sqrt((shape.bmi / data.refBMI) * (shape.heightM / data.baseHeight));

      const cmOf = (key) => (raw[key] == null ? null : rawToCm(key, raw[key], frameScale));
      const cmVal = (key) => { const v = cmOf(key); return v == null ? "" : round1(v); };
      const inVal = (key) => { const v = cmOf(key); return v == null ? "" : round1(cmToIn(v)); };

      setForm((f) => ({
        ...f,
        measure_shoulder_cm: cmVal("shoulder"),
        measure_chest_cm: cmVal("chest"),
        measure_waist_cm: cmVal("waist"),
        measure_hip_cm: cmVal("hip"),
        measure_arm_cm: cmVal("arm"),
        measure_shoulder_in: inVal("shoulder"),
        measure_chest_in: inVal("chest"),
        measure_waist_in: inVal("waist"),
        measure_hip_in: inVal("hip"),
        measure_arm_in: inVal("arm"),
      }));
    } catch (err) {
      // Logged for whoever debugs it, but also SHOWN - this used to only reach
      // the console, so a failed model load looked like a button that did
      // nothing when clicked.
      console.error("Couldn't read the current measurements:", err);
      setMeasureError("Couldn't read measurements from the 3D model. Please try again.");
    } finally {
      setMeasuring(false);
    }
  }

  // The projection recalculates itself whenever the payload changes (debounced).
  // No submit button - drag a slider and the chart follows.
  const payload = buildPayload();
  // `input` is the payload `result` was computed from - see useProjection.
  const { status, result, input, error } = useProjection(payload);

  // The backend runs on a free tier that sleeps after ~15 minutes idle, and
  // waking it takes ~20-50s (measured 21.6s cold vs 0.36s warm). Without this
  // a first-time visitor just watches "Calculating…" and reasonably concludes
  // the app is broken. Only the very first load can hit it - once a result
  // exists, useProjection keeps showing it while later requests run.
  const waitingForFirstResult = status === "loading" && !result;
  const [slowFirstLoad, setSlowFirstLoad] = useState(false);
  useEffect(() => {
    if (!waitingForFirstResult) return;
    const timer = setTimeout(() => setSlowFirstLoad(true), 4000);
    return () => clearTimeout(timer);
  }, [waitingForFirstResult]);

  return (
    <div className="app">
      <h1>Body Composition Visualizer</h1>
      <p className="tagline">
        Project how your weight, fat and muscle change over a plan.
      </p>

      <div className="layout">
        <form className="panel" onSubmit={(e) => e.preventDefault()}>
          <div className="form-top">
            <div className="unit-toggle" role="group" aria-label="Units">
              <button
                type="button"
                className={units === "metric" ? "active" : ""}
                aria-pressed={units === "metric"}
                onClick={() => switchUnits("metric")}
              >
                Metric
              </button>
              <button
                type="button"
                className={units === "imperial" ? "active" : ""}
                aria-pressed={units === "imperial"}
                onClick={() => switchUnits("imperial")}
              >
                Imperial
              </button>
            </div>
            <button type="button" className="link-btn" onClick={resetAll}>
              Reset
            </button>
          </div>

          <div className="field">
            <label htmlFor="sex">Sex</label>
            <select
              id="sex"
              value={form.sex}
              onChange={(e) => updateField("sex", e.target.value)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          <NumberField
            label="Age"
            name="age_years"
            value={form.age_years}
            onChange={updateField}
            min={14}
            max={100}
          />

          {units === "metric" ? (
            <>
              <NumberField
                label="Height (cm)"
                name="height_cm"
                value={form.height_cm}
                onChange={updateField}
                step="any"
              />
              <NumberField
                label="Weight (kg)"
                name="weight_kg"
                value={form.weight_kg}
                onChange={updateField}
                step="any"
              />
            </>
          ) : (
            <>
              <div className="field">
                <label>Height (ft / in)</label>
                <div className="row">
                  <input
                    type="number"
                    aria-label="Height, feet"
                    step="1"
                    min="3"
                    max="8"
                    value={form.height_ft}
                    onChange={(e) => updateField("height_ft", e.target.value)}
                  />
                  <input
                    type="number"
                    aria-label="Height, inches"
                    step="1"
                    min="0"
                    max="11"
                    value={form.height_in}
                    onChange={(e) => updateField("height_in", e.target.value)}
                  />
                </div>
              </div>
              <NumberField
                label="Weight (lb)"
                name="weight_lb"
                value={form.weight_lb}
                onChange={updateField}
                step="any"
              />
            </>
          )}

          <div className="field">
            <label htmlFor="body_type_preset">
              Not sure of your body fat %? Jump to a body type
            </label>
            <select
              id="body_type_preset"
              defaultValue=""
              onChange={(e) => {
                applyBodyTypePreset(e.target.value);
                e.target.value = ""; // one-shot fill, not a tracked field itself
              }}
            >
              <option value="" disabled>
                Select…
              </option>
              {BODY_TYPE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>
              Sets body fat % (and, for "Muscular", weight too) to match that
              body type in the 3D model.
            </p>
          </div>

          <div className="field">
            <label htmlFor="body_fat_pct">
              Body fat: {Number(form.body_fat_pct).toFixed(0)}%
            </label>
            <input
              id="body_fat_pct"
              type="range"
              min={3}
              max={50}
              step={0.5}
              value={form.body_fat_pct}
              onChange={(e) => updateField("body_fat_pct", e.target.value)}
            />
          </div>

          <details className="measure-details">
            <summary>Prefer exact measurements? (optional)</summary>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "0.5rem 0 0.75rem" }}>
              Leave any of these blank to keep the estimate from your body fat
              % and muscle. Filling one in only adjusts that region in the 3D
              model.
            </p>
            <button
              type="button"
              className="link-btn"
              onClick={fillCurrentMeasurements}
              disabled={measuring}
              style={{ display: "block", marginBottom: "0.85rem" }}
            >
              {measuring ? "Reading the model…" : "Show current measurements"}
            </button>
            {measureError && (
              <p className="muted" role="status" style={{ fontSize: "0.8rem", margin: "-0.5rem 0 0.85rem" }}>
                {measureError}
              </p>
            )}
            {MEASURE_FIELDS.map(({ key, label, cm, in: inches }) => {
              const unit = units === "metric" ? "cm" : "in";
              const [min, max] = units === "metric" ? cm : inches;
              const name = `measure_${key}_${unit}`;
              return (
                <NumberField
                  key={name}
                  label={`${label} (${unit})`}
                  name={name}
                  value={form[name]}
                  onChange={updateField}
                  step="any"
                  min={min}
                  max={max}
                />
              );
            })}
          </details>

          <ActivityPicker
            value={form.activity_level}
            onChange={(v) => updateField("activity_level", v)}
          />

          <div className="field">
            <label htmlFor="training_experience">Training experience</label>
            <select
              id="training_experience"
              value={form.training_experience}
              onChange={(e) =>
                updateField("training_experience", e.target.value)
              }
            >
              {TRAINING_EXPERIENCE.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label} — {e.summary}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="training_frequency_per_week">
              Training frequency:{" "}
              {describeTrainingFrequency(Number(form.training_frequency_per_week))}
            </label>
            <input
              id="training_frequency_per_week"
              type="range"
              min={0}
              max={7}
              step={1}
              value={form.training_frequency_per_week}
              onChange={(e) =>
                updateField("training_frequency_per_week", e.target.value)
              }
            />
          </div>

          <NumberField
            label="Protein (g per kg bodyweight)"
            name="protein_g_per_kg"
            value={form.protein_g_per_kg}
            onChange={updateField}
            step={0.1}
            min={0}
            max={4}
          />
          <NumberField
            label="Planned daily calories"
            name="planned_daily_calories"
            value={form.planned_daily_calories}
            onChange={updateField}
            step="any"
          />
          <NumberField
            label="Plan length (weeks)"
            name="plan_duration_weeks"
            value={form.plan_duration_weeks}
            onChange={updateField}
            min={1}
            max={260}
          />

          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
            The projection updates automatically as you change any value.
          </p>
        </form>

        <div>
          {status === "error" && (
            <div className="panel error-box" style={{ marginBottom: "1rem" }}>
              <strong>Check your inputs</strong>
              <p style={{ margin: "0.4rem 0 0" }}>{error}</p>
              {result && (
                <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                  Showing the last valid projection below.
                </p>
              )}
            </div>
          )}
          {result ? (
            <Suspense fallback={<div className="panel muted">Calculating…</div>}>
              <ResultsPanel
                result={result}
                units={units}
                // the inputs this result was computed from, NOT the live form,
                // which mid-edit can hold an empty or half-typed height
                sex={input.sex}
                heightCm={input.height_cm}
                loading={status === "loading"}
                measurements={buildMeasurements()}
              />
            </Suspense>
          ) : (
            <div className="panel muted" role="status">
              {status !== "loading"
                ? "Enter your details to see a projection."
                : slowFirstLoad
                ? "Waking up the calculation server… It sleeps when nobody's using it, so the first projection can take up to a minute. After that it's instant."
                : "Calculating…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A small reusable wrapper so every numeric input isn't 6 repeated lines.
// `onChange` here is the parent's updateField(name, value).
function NumberField({ label, name, value, onChange, ...inputProps }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="number"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        {...inputProps}
      />
    </div>
  );
}
