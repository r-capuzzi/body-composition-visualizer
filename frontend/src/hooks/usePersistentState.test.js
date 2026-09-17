import { act, renderHook } from "@testing-library/react";

import { usePersistentState } from "./usePersistentState";

beforeEach(() => window.localStorage.clear());

test("uses the initial value when nothing is stored, then persists writes", () => {
  const { result } = renderHook(() => usePersistentState("k", { a: 1 }));
  expect(result.current[0]).toEqual({ a: 1 });

  act(() => result.current[1]({ a: 2 }));
  expect(JSON.parse(window.localStorage.getItem("k"))).toEqual({ a: 2 });
});

test("reads a previously stored value on mount", () => {
  window.localStorage.setItem("k", JSON.stringify({ a: 9 }));
  const { result } = renderHook(() => usePersistentState("k", { a: 1, b: 2 }));
  // stored value wins, but a NEW default key (b) still appears
  expect(result.current[0]).toEqual({ a: 9, b: 2 });
});

test("falls back to the default on corrupt JSON", () => {
  window.localStorage.setItem("k", "{not json");
  const { result } = renderHook(() => usePersistentState("k", "safe"));
  expect(result.current[0]).toBe("safe");
});
