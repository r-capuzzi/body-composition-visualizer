import { lazy, Suspense, useState } from "react";

import { bodyParamsFromStats, ffmi, ffmiReference } from "../lib/bodyParams";
import { kgToLb } from "../lib/units";
import ErrorBoundary from "./ErrorBoundary";
import ProjectionChart from "./ProjectionChart";
import TimelineScrubber from "./TimelineScrubber";

// three.js + @react-three/fiber + drei are the bulk of the bundle (~1.5MB) but
// aren't needed until a projection actually renders, so load them in their own
// chunk instead of blocking the initial page paint. The fallback reserves the
// same footprint as the real scene (see .avatar-scene in App.css) so nothing
// jumps once it's ready.
const AvatarScene = lazy(() => import("./AvatarScene"));

/**
 * Renders a CalculateResponse: starting stats, the NET body-composition change
 * over the plan (always shown - this is the number people tweak calories
 * against), any plan warnings, the sampled week-by-week trajectory, and how the
 * three scenarios differ at the end.
 */
export default function ResultsPanel({
  result,
  units,
  sex,
  heightCm,
  loading = false,
  measurements,
}) {
  // `notes` defaults to [] so this still renders against a backend that
  // predates the field (e.g. mid-deploy, when Vercel can land before Render).
  const { bmr_kcal, maintenance_kcal, daily_calorie_delta, warnings, notes = [] } = result;

  const start = result.expected[0];
  const weeks = result.expected[result.expected.length - 1].week;

  // Which week the scrubber is parked on. Initialised huge so `week` defaults to
  // the end of the plan; once the user scrubs it holds a real index. `Math.min`
  // keeps it valid when the plan length changes under it.
  const [selectedWeek, setSelectedWeek] = useState(9999);
  const week = Math.min(selectedWeek, weeks);

  // Everything below reflects THIS moment in the plan.
  const point = result.expected[week];
  // the start sets the fat-driven lean baseline (see bodyParamsFromStats)
  const body = { ...bodyParamsFromStats(point, heightCm, sex, start), measurements };
  const ref = ffmiReference(sex);

  // Round BEFORE deciding. Maintenance is shown rounded, so typing that exact
  // number in lands a fraction of a kcal off (-0.2), which used to read as
  // "0 kcal deficit" - never "at maintenance". The word carries the sign, so the
  // number is a magnitude ("293 kcal deficit", not "-293 kcal deficit").
  const delta = Math.round(daily_calorie_delta);
  const deltaLabel =
    delta === 0
      ? "at maintenance"
      : `${Math.abs(delta)} kcal ${delta > 0 ? "surplus" : "deficit"}`;

  const rows = sampleEvenly(result.expected, 10);

  return (
    <div className={"panel" + (loading ? " is-updating" : "")}>
      <h2>
        Projection
        {loading && <span className="updating-dot"> updating…</span>}
      </h2>

      <ErrorBoundary
        resetKey={sex}
        fallback={
          <div className="avatar-scene avatar-scene-failed">
            <p className="muted">
              The 3D model couldn’t be loaded. Your projection below is unaffected.
            </p>
          </div>
        }
      >
        <Suspense fallback={<div className="avatar-scene" />}>
          <AvatarScene sex={sex} shape={body} />
        </Suspense>
      </ErrorBoundary>
      <TimelineScrubber weeks={weeks} week={week} setWeek={setSelectedWeek} />
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 1.25rem" }}>
        {week === 0
          ? "Your build now. Drag the timeline to project forward."
          : `Projected build at week ${week}. Drag to rotate the model.`}
      </p>

      <div className="stat-grid">
        <Stat label="BMR" value={`${Math.round(bmr_kcal)} kcal`} />
        <Stat label="Maintenance (start)" value={`${Math.round(maintenance_kcal)} kcal`} />
        <Stat label="Your plan" value={deltaLabel} />
      </div>

      <h3>
        {week === 0 ? "Starting point" : `Change through week ${week}`}
      </h3>
      <div className="stat-grid">
        <ChangeStat
          label="Lean mass"
          from={start.lean_mass_kg}
          to={point.lean_mass_kg}
          units={units}
          goodDirection="up"
        />
        <ChangeStat
          label="Fat mass"
          from={start.fat_mass_kg}
          to={point.fat_mass_kg}
          units={units}
          goodDirection="down"
        />
        <ChangeStat
          label="Body fat %"
          from={start.body_fat_pct}
          to={point.body_fat_pct}
          isPercent
        />
        <ChangeStat
          label="Weight"
          from={start.weight_kg}
          to={point.weight_kg}
          units={units}
        />
        <ChangeStat
          label="FFMI"
          from={ffmi(start.lean_mass_kg, heightCm)}
          to={ffmi(point.lean_mass_kg, heightCm)}
          format={(n) => n.toFixed(1)}
          goodDirection="up"
        />
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 1.25rem" }}>
        FFMI is muscularity adjusted for your height. For{" "}
        {sex === "female" ? "women" : "men"}: roughly {ref.average} average,{" "}
        {ref.trained} well-trained, {ref.elite}+ elite.
      </p>

      {(warnings.length > 0 || notes.length > 0) && (
        <div style={{ margin: "0.25rem 0 1.25rem" }}>
          {warnings.map((w) => (
            <div className="warning" key={w}>
              {w}
            </div>
          ))}
          {/* Notes are true of most plans, so they must NOT look like the
              amber warnings - a box that's always there stops being read. */}
          {notes.map((n) => (
            <div className="note" key={n}>
              {n}
            </div>
          ))}
        </div>
      )}

      <ProjectionChart result={result} units={units} markerWeek={week} />

      <h3 style={{ marginTop: "1.5rem" }}>
        Scenario range {week === 0 ? "at the start" : `at week ${week}`}
      </h3>
      <div className="table-scroll">
        <table className="projection">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Lean change</th>
              <th>Fat change</th>
              <th>Body fat</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Conservative", result.conservative[week]],
              ["Expected", result.expected[week]],
              ["Optimistic", result.optimistic[week]],
            ].map(([name, p]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{signed(p.lean_mass_kg - start.lean_mass_kg, units)}</td>
                <td>{signed(p.fat_mass_kg - start.fat_mass_kg, units)}</td>
                <td>{p.body_fat_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 1.25rem" }}>
        Plan around the conservative row — you should meet or beat it.
      </p>

      {/* <details> is the browser's native show/hide widget - no JS state
          needed. Closed by default now that the chart covers the same ground. */}
      <details className="week-table">
        <summary>Week-by-week numbers</summary>
        <div className="table-scroll">
        <table className="projection">
          <thead>
            <tr>
              <th>Week</th>
              <th>Weight</th>
              <th>Fat</th>
              <th>Lean</th>
              <th>Body fat</th>
              <th>Maint.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.week}>
                <td>{p.week}</td>
                <td>{mass(p.weight_kg, units)}</td>
                <td>{mass(p.fat_mass_kg, units)}</td>
                <td>{mass(p.lean_mass_kg, units)}</td>
                <td>{p.body_fat_pct.toFixed(1)}%</td>
                <td>{Math.round(p.maintenance_kcal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

// A stat card showing a before -> after change, coloured by whether the move is
// in the desired direction (green) or not (red for lean loss, amber for fat gain).
function ChangeStat({
  label,
  from,
  to,
  units,
  isPercent = false,
  goodDirection,
  format,
}) {
  const delta = to - from;
  const fmt =
    format || ((n) => (isPercent ? `${n.toFixed(1)}%` : mass(n, units)));

  let cls = "";
  if (goodDirection && Math.abs(delta) > 0.05) {
    const improving =
      (goodDirection === "up" && delta > 0) ||
      (goodDirection === "down" && delta < 0);
    cls = improving ? "delta-good" : goodDirection === "up" ? "delta-bad" : "delta-warn";
  }

  return (
    <div className="stat">
      <div className={"value " + cls}>
        {(delta >= 0 ? "+" : "−") + fmt(Math.abs(delta))}
      </div>
      <div className="label">{label}</div>
      <div className="label" style={{ marginTop: "0.15rem", opacity: 0.7 }}>
        {fmt(from)} → {fmt(to)}
      </div>
    </div>
  );
}

function sampleEvenly(arr, count) {
  if (arr.length <= count) return arr;
  const step = (arr.length - 1) / (count - 1);
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(arr[Math.round(i * step)]);
  return picked;
}

function mass(kg, units) {
  return units === "imperial"
    ? `${kgToLb(kg).toFixed(1)} lb`
    : `${kg.toFixed(1)} kg`;
}

// Signed mass string, e.g. "+0.4 kg" / "-2.6 kg" for a delta already in kg.
function signed(deltaKg, units) {
  const sign = deltaKg >= 0 ? "+" : "−";
  return `${sign}${mass(Math.abs(deltaKg), units)}`;
}
