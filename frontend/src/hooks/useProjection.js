import { useEffect, useRef, useState } from "react";

import { calculateProjection } from "../lib/api";

/**
 * Runs the projection whenever `payload` changes, debounced so dragging a
 * slider doesn't fire dozens of requests.
 *
 * Returns { status, result, input, error }:
 *   status "loading" - a request is pending
 *   status "ready"   - `result` is fresh
 *   status "error"   - `error` is set; `result` still holds the LAST good one
 *                      so the UI never flashes empty on a transient bad input
 *   input            - the payload `result` was computed FROM. Render the result
 *                      with this, never with the live form: while someone is
 *                      retyping their height the form holds "" or "17", and
 *                      drawing the last good result at that height produced an
 *                      FFMI of Infinity and an avatar scaled by NaN.
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
    input: null,
    error: "",
  });
  const runId = useRef(0);

  useEffect(() => {
    const myRun = ++runId.current;
    setState((prev) => ({ ...prev, status: "loading" }));

    const timer = setTimeout(async () => {
      const input = JSON.parse(key);
      try {
        const result = await calculateProjection(input);
        if (myRun === runId.current) {
          setState({ status: "ready", result, input, error: "" });
        }
      } catch (err) {
        if (myRun === runId.current) {
          setState((prev) => ({
            status: "error",
            result: prev.result, // keep showing the last good projection...
            input: prev.input,   // ...together with the inputs that made it
            error: err.message,
          }));
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [key, debounceMs]);

  return state;
}
