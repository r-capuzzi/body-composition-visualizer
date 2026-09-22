import { render, screen } from "@testing-library/react";
import ResultsPanel from "./ResultsPanel";

// The 3D scene needs WebGL, which jsdom doesn't have - stub it out.
vi.mock("./AvatarScene", () => ({ default: () => null }));

// The real backend returns one point per week with index === week; mirror that.
function series(perWeek) {
  return perWeek.map((p, week) => ({
    week,
    maintenance_kcal: 2600 - week * 15,
    ...p,
  }));
}

const fakeResult = {
  bmr_kcal: 1700,
  maintenance_kcal: 2600,
  daily_calorie_delta: -300,
  warnings: [],
  expected: series([
    { weight_kg: 80, fat_mass_kg: 16.0, lean_mass_kg: 64.0, body_fat_pct: 20.0 },
    { weight_kg: 79.4, fat_mass_kg: 15.4, lean_mass_kg: 64.0, body_fat_pct: 19.4 },
    { weight_kg: 78.9, fat_mass_kg: 14.9, lean_mass_kg: 64.0, body_fat_pct: 18.9 },
    { weight_kg: 78.5, fat_mass_kg: 14.5, lean_mass_kg: 64.0, body_fat_pct: 18.5 },
    { weight_kg: 78.0, fat_mass_kg: 14.0, lean_mass_kg: 64.0, body_fat_pct: 17.9 },
  ]),
  conservative: series([
    { weight_kg: 80, fat_mass_kg: 16.0, lean_mass_kg: 64.0, body_fat_pct: 20.0 },
    { weight_kg: 79.6, fat_mass_kg: 15.6, lean_mass_kg: 64.0, body_fat_pct: 19.6 },
    { weight_kg: 79.2, fat_mass_kg: 15.2, lean_mass_kg: 64.0, body_fat_pct: 19.2 },
    { weight_kg: 78.9, fat_mass_kg: 14.9, lean_mass_kg: 64.0, body_fat_pct: 18.9 },
    { weight_kg: 78.6, fat_mass_kg: 14.6, lean_mass_kg: 64.0, body_fat_pct: 18.6 },
  ]),
  optimistic: series([
    { weight_kg: 80, fat_mass_kg: 16.0, lean_mass_kg: 64.0, body_fat_pct: 20.0 },
    { weight_kg: 79.2, fat_mass_kg: 15.1, lean_mass_kg: 64.1, body_fat_pct: 19.1 },
    { weight_kg: 78.5, fat_mass_kg: 14.3, lean_mass_kg: 64.2, body_fat_pct: 18.2 },
    { weight_kg: 77.9, fat_mass_kg: 13.6, lean_mass_kg: 64.3, body_fat_pct: 17.5 },
    { weight_kg: 77.2, fat_mass_kg: 12.8, lean_mass_kg: 64.4, body_fat_pct: 16.6 },
  ]),
};

test("defaults to the end of the plan and shows the net change", () => {
  render(<ResultsPanel result={fakeResult} units="metric" heightCm={178} />);
  expect(screen.getByText("Change through week 4")).toBeInTheDocument();
  // fat: 16.0 -> 14.0 over the plan
  expect(screen.getAllByText("−2.0 kg").length).toBeGreaterThan(0);
});

test("notes render in their own style, not as warnings", () => {
  const result = {
    ...fakeResult,
    warnings: ["Protein is low."],
    notes: ["On a fixed intake, weight loss eases over the plan."],
  };
  render(<ResultsPanel result={result} units="metric" heightCm={178} />);
  expect(screen.getByText("Protein is low.")).toHaveClass("warning");
  const note = screen.getByText(/weight loss eases/);
  expect(note).toHaveClass("note");
  expect(note).not.toHaveClass("warning");
});

test("renders against a backend response that has no notes field", () => {
  // fakeResult has no `notes` - what a pre-notes backend sends
  render(<ResultsPanel result={fakeResult} units="metric" heightCm={178} />);
  expect(screen.getByText("Change through week 4")).toBeInTheDocument();
});

test("the plan label reads naturally, including right at maintenance", () => {
  const label = (d) => {
    const { unmount } = render(
      <ResultsPanel result={{ ...fakeResult, daily_calorie_delta: d }} units="metric" heightCm={178} />
    );
    const text = screen.getByText("Your plan").previousSibling.textContent;
    unmount();
    return text;
  };
  // typing the displayed (rounded) maintenance back in lands a fraction off
  expect(label(-0.2)).toBe("at maintenance");
  expect(label(0.3)).toBe("at maintenance");
  expect(label(-293)).toBe("293 kcal deficit");   // not "-293 kcal deficit"
  expect(label(315)).toBe("315 kcal surplus");
});

test("renders lean/fat change per scenario", () => {
  render(<ResultsPanel result={fakeResult} units="metric" heightCm={178} />);
  expect(screen.getByText("Conservative")).toBeInTheDocument();
  expect(screen.getByText("Optimistic")).toBeInTheDocument();
});
