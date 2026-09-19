// Loader/caching behaviour for the body-model .bin files. Kept in its own file
// from bodyMesh.test.js (which covers the pure geometry maths) because these
// tests need a mocked fetch and a fresh module instance per case - the cache
// lives at module scope.

async function freshGetBodyData() {
  vi.resetModules();
  const mod = await import("./bodyMesh");
  return mod.getBodyData;
}

describe("loadBodyData error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("an HTTP error is reported as one, not parsed as mesh data", async () => {
    // fetch resolves (it only rejects on network failure), so without an
    // explicit r.ok check the 404 body gets read as though it were a mesh.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }))
    );
    const getBodyData = await freshGetBodyData();
    await expect(getBodyData("male")).rejects.toThrow(/HTTP 404/);
  });

  test("a truncated file is reported as corrupt rather than throwing a RangeError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }))
    );
    const getBodyData = await freshGetBodyData();
    await expect(getBodyData("male")).rejects.toThrow(/truncated or corrupt/);
  });

  test("a failed load is not cached forever - a later call refetches", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const getBodyData = await freshGetBodyData();

    await expect(getBodyData("male")).rejects.toThrow();
    await expect(getBodyData("male")).rejects.toThrow();

    // The point: the second attempt actually hit the network again. Caching the
    // rejected entry would make a transient blip permanent until a page reload.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
