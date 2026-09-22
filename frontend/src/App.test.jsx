import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

// The real hook fires a debounced network request on mount; stub it so the
// form renders deterministically without touching fetch or timers. Each test
// can swap what it returns; the default is "still loading, nothing yet".
const { useProjectionMock } = vi.hoisted(() => ({ useProjectionMock: vi.fn() }));
vi.mock("./hooks/useProjection", () => ({ useProjection: useProjectionMock }));

// No WebGL in jsdom.
vi.mock("./components/AvatarScene", () => ({ default: () => null }));

const LOADING = { status: "loading", result: null, input: null, error: "" };

const pt = (week, weight_kg, fat_mass_kg, lean_mass_kg, body_fat_pct) => ({
  week, weight_kg, fat_mass_kg, lean_mass_kg, body_fat_pct, maintenance_kcal: 2693,
});
const SERIES = [pt(0, 78, 15.6, 62.4, 20), pt(1, 77.6, 15.2, 62.4, 19.6)];
// A real-shaped result plus the inputs it was computed from.
const READY = {
  status: "ready",
  error: "",
  result: {
    bmr_kcal: 1738, maintenance_kcal: 2693, daily_calorie_delta: -293,
    warnings: [], notes: [],
    expected: SERIES, conservative: SERIES, optimistic: SERIES,
  },
  input: {
    sex: "male", age_years: 28, height_cm: 178, weight_kg: 78, body_fat_pct: 20,
    activity_level: "moderate", training_experience: "intermediate",
    training_frequency_per_week: 3, protein_g_per_kg: 1.8,
    planned_daily_calories: 2400, plan_duration_weeks: 1,
  },
};

// Only getBodyData is swapped (so a test can make the model load fail); the
// rest of the mesh maths stays real.
const { getBodyDataMock, prefetchBodyDataMock } = vi.hoisted(() => ({
  getBodyDataMock: vi.fn(),
  prefetchBodyDataMock: vi.fn(),
}));
vi.mock("./lib/bodyMesh", async (importOriginal) => ({
  ...(await importOriginal()),
  getBodyData: getBodyDataMock,
  prefetchBodyData: prefetchBodyDataMock,
}));

// The form persists to localStorage; start each test from a clean slate so
// one test's edits can't leak into the next.
beforeEach(() => {
  window.localStorage.clear();
  useProjectionMock.mockReturnValue(LOADING);
});

test("renders the input form", () => {
  render(<App />);
  expect(screen.getByText(/activity level/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/training experience/i)).toBeInTheDocument();
});

test("shows the activity levels with their multipliers", () => {
  render(<App />);
  expect(screen.getByText(/moderately active/i)).toBeInTheDocument();
  expect(screen.getByText("×1.55")).toBeInTheDocument();
});

test("a body-type preset fills in body fat %", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.selectOptions(
    screen.getByLabelText(/jump to a body type/i),
    "overweight"
  );
  expect(screen.getByText("Body fat: 40%")).toBeInTheDocument();
});

test("the Muscular preset also raises weight enough to hit the muscle-morph target", async () => {
  const user = userEvent.setup();
  render(<App />);

  // default form: male, height 178cm, preset body fat 16%.
  // Target FFMI 24 -> lean mass 24*1.78^2 = 76.04kg -> weight = 76.04 / (1 - 0.16) = 90.5kg.
  await user.selectOptions(
    screen.getByLabelText(/jump to a body type/i),
    "muscular"
  );
  expect(screen.getByText("Body fat: 16%")).toBeInTheDocument();
  expect(screen.getByLabelText("Weight (kg)")).toHaveValue(90.5);
});

// Accessibility: each control must be reachable by the name a screen reader
// announces. These go through getByRole(..., { name }) deliberately - the
// tests above find the body-fat slider by its visible text ("Body fat: 40%"),
// which works even when the label isn't actually attached to the input.

test("both sliders have accessible names", () => {
  render(<App />);
  expect(screen.getByRole("slider", { name: /body fat/i })).toHaveValue("20");
  expect(screen.getByRole("slider", { name: /training frequency/i })).toHaveValue("3");
});

test("the unit toggle exposes which unit is active", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole("button", { name: "Metric" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Imperial" })).toHaveAttribute("aria-pressed", "false");

  await user.click(screen.getByRole("button", { name: "Imperial" }));
  expect(screen.getByRole("button", { name: "Imperial" })).toHaveAttribute("aria-pressed", "true");
});

test("activity levels form a named group whose radios are named by their level", () => {
  render(<App />);
  const group = screen.getByRole("radiogroup", { name: /activity level/i });
  expect(group).toBeInTheDocument();
  // the radio's name should be the level, not the whole card's worth of examples
  expect(screen.getByRole("radio", { name: "Moderately active" })).toBeChecked();
});

test("imperial height inputs are named in context", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Imperial" }));
  expect(screen.getByRole("spinbutton", { name: /height.*feet/i })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: /height.*inches/i })).toBeInTheDocument();
});

test("a stale result is drawn with its own inputs, not a half-edited height", async () => {
  // The backend rejected the empty height, so the last good result (for 178cm)
  // is still showing - it must still be drawn at 178cm, not at 0cm.
  useProjectionMock.mockReturnValue({ ...READY, status: "error", error: "Height: must be greater than 120" });
  const user = userEvent.setup();
  render(<App />);

  await user.clear(screen.getByLabelText("Height (cm)"));

  const ffmi = (await screen.findByText("FFMI")).closest(".stat");
  expect(ffmi.textContent).not.toMatch(/Infinity|NaN/);   // was "Infinity → Infinity"
  expect(ffmi.textContent).toMatch(/19\.7/);              // 62.4 / 1.78^2
});

test("a measurement still being typed doesn't reshape the avatar", async () => {
  // Capture what ResultsPanel is handed as `measurements` while typing "45"
  // into Upper arm: the "4" on the way must not be applied.
  useProjectionMock.mockReturnValue(READY);
  const seen = [];
  vi.doMock("./components/ResultsPanel", () => ({
    default: ({ measurements }) => { seen.push(measurements.arm); return null; },
  }));
  vi.resetModules();
  const { default: FreshApp } = await import("./App");
  const user = userEvent.setup();
  render(<FreshApp />);

  await user.type(screen.getByLabelText("Upper arm (cm)"), "45");
  await screen.findByLabelText("Upper arm (cm)");

  expect(seen).not.toContain(4);   // the half-typed prefix never reached the model
  expect(seen.at(-1)).toBe(45);
  vi.doUnmock("./components/ResultsPanel");
});

test("the body model starts downloading at mount, not after the projection", async () => {
  // LOADING: no result yet - the model must already be on its way.
  const user = userEvent.setup();
  render(<App />);
  expect(prefetchBodyDataMock).toHaveBeenCalledWith("male");

  // and switching sex warms the other model
  await user.selectOptions(screen.getByLabelText(/^sex$/i), "female");
  expect(prefetchBodyDataMock).toHaveBeenLastCalledWith("female");
});

test("'show current measurements' before any result asks the user to wait", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /show current measurements/i }));
  expect(screen.getByText(/wait for your projection/i)).toBeInTheDocument();
  expect(getBodyDataMock).not.toHaveBeenCalled();
});

test("a failed 'show current measurements' tells the user instead of silently doing nothing", async () => {
  useProjectionMock.mockReturnValue(READY);
  getBodyDataMock.mockRejectedValueOnce(new Error("Could not load the male body model (HTTP 503)."));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /show current measurements/i }));

  const message = await screen.findByText(/couldn.t read measurements/i);
  expect(message).toHaveAttribute("role", "status"); // announced, politely
  // and the button is usable again for a retry
  expect(screen.getByRole("button", { name: /show current measurements/i })).toBeEnabled();
  consoleError.mockRestore();
});

test("a slow first load explains the sleeping server instead of an endless 'Calculating…'", () => {
  // useProjection is mocked to stay in "loading" with no result - exactly what
  // a visitor sees while the free-tier backend wakes up.
  vi.useFakeTimers();
  try {
    render(<App />);
    expect(screen.getByText("Calculating…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText(/waking up the calculation server/i)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("the Muscular preset targets a female FFMI for women, not the male one", async () => {
  // Female, 165cm, preset 21% bf, target FFMI 20.5:
  // lean = 20.5 * 1.65^2 = 55.81kg -> weight = 55.81 / 0.79 = 70.6kg.
  // It used to target FFMI 24 -> 82.7kg, i.e. 65kg lean: more than the app's default man.
  const user = userEvent.setup();
  render(<App />);
  await user.selectOptions(screen.getByLabelText(/^sex$/i), "female");
  const height = screen.getByLabelText("Height (cm)");
  await user.clear(height);
  await user.type(height, "165");
  await user.selectOptions(screen.getByLabelText(/jump to a body type/i), "muscular");
  expect(screen.getByLabelText("Weight (kg)")).toHaveValue(70.6);
});

test("body-type presets are sex-specific", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.selectOptions(screen.getByLabelText(/^sex$/i), "female");
  await user.selectOptions(screen.getByLabelText(/jump to a body type/i), "lean");
  expect(screen.getByText("Body fat: 18%")).toBeInTheDocument();
});
