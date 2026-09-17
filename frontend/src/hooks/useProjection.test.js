import { act, renderHook } from "@testing-library/react";

import { useProjection } from "./useProjection";
import { calculateProjection } from "../lib/api";

vi.mock("../lib/api");

beforeEach(() => {
  vi.useFakeTimers();
  calculateProjection.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

// Advance past the debounce AND flush the mocked promise, all inside act().
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

test("debounces: rapid payload changes only trigger one request", async () => {
  calculateProjection.mockResolvedValue({ ok: 1 });

  const { rerender } = renderHook(
    ({ p }) => useProjection(p, { debounceMs: 300 }),
    { initialProps: { p: { calories: 2400 } } }
  );
  rerender({ p: { calories: 2500 } });
  rerender({ p: { calories: 2600 } });

  await advance(300);

  expect(calculateProjection).toHaveBeenCalledTimes(1);
  expect(calculateProjection).toHaveBeenCalledWith({ calories: 2600 });
});

test("keeps the last good result when a later request errors", async () => {
  calculateProjection.mockResolvedValueOnce({ value: "good" });

  const { result, rerender } = renderHook(
    ({ p }) => useProjection(p, { debounceMs: 100 }),
    { initialProps: { p: { calories: 2400 } } }
  );

  await advance(100);
  expect(result.current.result).toEqual({ value: "good" });

  calculateProjection.mockRejectedValueOnce(new Error("age_years: too small"));
  rerender({ p: { calories: 10 } });
  await advance(100);

  expect(result.current.status).toBe("error");
  expect(result.current.error).toMatch(/too small/);
  expect(result.current.result).toEqual({ value: "good" }); // not wiped
});
