import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

// The real hook fires a debounced network request on mount; stub it so the
// form renders deterministically without touching fetch or timers.
vi.mock("./hooks/useProjection", () => ({
  useProjection: () => ({ status: "loading", result: null, error: "" }),
}));

// The form persists to localStorage; start each test from a clean slate so
// one test's edits can't leak into the next.
beforeEach(() => window.localStorage.clear());

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

test("body-type presets are sex-specific", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.selectOptions(screen.getByLabelText(/^sex$/i), "female");
  await user.selectOptions(screen.getByLabelText(/jump to a body type/i), "lean");
  expect(screen.getByText("Body fat: 18%")).toBeInTheDocument();
});
