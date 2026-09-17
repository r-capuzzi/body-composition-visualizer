import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimelineScrubber from "./TimelineScrubber";

test("the slider spans 0..weeks and reports changes", async () => {
  const user = userEvent.setup();
  const setWeek = vi.fn();
  render(<TimelineScrubber weeks={16} week={4} setWeek={setWeek} />);

  const slider = screen.getByLabelText("Timeline week");
  expect(slider).toHaveAttribute("max", "16");
  expect(slider).toHaveValue("4");

  await user.click(screen.getByRole("button", { name: /play/i }));
  // toggling play should flip the button to a pause control
  expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
});

test("play advances the week once per interval and clamps at the end", () => {
  vi.useFakeTimers();
  try {
    const setWeek = vi.fn();
    render(<TimelineScrubber weeks={16} week={3} setWeek={setWeek} />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    act(() => vi.advanceTimersByTime(130 * 3));

    expect(setWeek).toHaveBeenCalledTimes(3);
    const step = setWeek.mock.calls[0][0]; // the updater fn passed to setWeek
    expect(step(3)).toBe(4); // steps forward
    expect(step(16)).toBe(16); // never past the last week

    // pausing tears the interval down - no more ticks
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    act(() => vi.advanceTimersByTime(130 * 5));
    expect(setWeek).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test('shows "Now" at week 0 and a week label otherwise', () => {
  const { rerender } = render(
    <TimelineScrubber weeks={16} week={0} setWeek={() => {}} />
  );
  expect(screen.getByText("Now")).toBeInTheDocument();

  rerender(<TimelineScrubber weeks={16} week={9} setWeek={() => {}} />);
  expect(screen.getByText(/Week 9/)).toBeInTheDocument();
});
