import { render, screen } from "@testing-library/react";

import ErrorBoundary from "./ErrorBoundary";

function Boom() {
  throw new Error("mesh fetch failed");
}

describe("ErrorBoundary", () => {
  let consoleError;
  beforeEach(() => {
    // React logs the caught error; keep the test output readable.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  test("shows the fallback instead of unmounting the siblings", () => {
    render(
      <div>
        <ErrorBoundary fallback={<p>avatar unavailable</p>}>
          <Boom />
        </ErrorBoundary>
        <p>projection still here</p>
      </div>
    );
    expect(screen.getByText("avatar unavailable")).toBeInTheDocument();
    // the whole point: a broken avatar must not take the numbers down with it
    expect(screen.getByText("projection still here")).toBeInTheDocument();
  });

  test("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary fallback={<p>nope</p>}>
        <p>avatar</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("avatar")).toBeInTheDocument();
  });

  test("recovers when resetKey changes, so switching sex can retry", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="male" fallback={<p>avatar unavailable</p>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("avatar unavailable")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="female" fallback={<p>avatar unavailable</p>}>
        <p>recovered</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
