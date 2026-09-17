import { useEffect, useRef, useState } from "react";

import { calculateProjection } from "../lib/api";

/**
 * Runs the projection whenever `payload` changes, debounced so dragging a
 * slider doesn't fire dozens of requests.
 *
 * Returns { status, result, error }:
 *   status "loading" - a request is pending
 *   status "ready"   - `result` is fresh
 *   status "error"   - `error` is set; `result` still holds the LAST good one
 *                      so the UI never flashes empty on a transient bad input
 *
 * Teaching notes:
 *  - The effect depends on JSON.stringify(payload), not the object itself.
 *    buildPayload() makes a new object every render, but its *string* only
 *    changes when a value actually changes - so the effect stays put while
 *    you type in an unrelated field.
 *  - The cleanup function does two jobs: clear the pending timer, and flag any
 *    already-in-flight request as stale via the `runId` check. Without that, a
 *    slow early request could land AFTER a fast later one and overwrite it.
 */
export function useProjection(payload, { debounceMs = 350 } = {}) {
  const key = JSON.stringify(payload);
  const [state, setState] = useState({
    status: "loading",
    result: null,
    error: "",
  });
  const runId = useRef(0);

  useEffect(() => {
    const myRun = ++runId.current;
    setState((prev) => ({ ...prev, status: "loading" }));

    const timer = setTimeout(async () => {
      try {
        const result = await calculateProjection(JSON.parse(key));
        if (myRun === runId.current) {
          setState({ status: "ready", result, error: "" });
        }
      } catch (err) {
        if (myRun === runId.current) {
          setState((prev) => ({
            status: "error",
            result: prev.result, // keep showing the last good projection
            error: err.message,
          }));
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [key, debounceMs]);

  return state;
}
