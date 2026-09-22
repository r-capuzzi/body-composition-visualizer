// Runs the real measurement code against the real .bin meshes. The region
// constants were tuned on the male mesh; before they were scaled per mesh, the
// female arm band held zero vertices and her chest slice ran through the
// armpit. These tests pin the sex-independence that the fix is for.

import { readFileSync } from "fs";
import { resolve } from "path";

async function loadMesh(sex) {
  const file = readFileSync(resolve(__dirname, `../../public/models/${sex}.bin`));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf })));
  vi.resetModules();
  const mod = await import("./bodyMesh");
  const data = await mod.getBodyData(sex);
  vi.unstubAllGlobals();
  return { mod, data };
}

describe("measurement regions scale with the mesh", () => {
  // Each load runs the full landmark scan, which is CPU-heavy - load once per
  // mesh so this file doesn't starve other test files running in parallel.
  let male, female;
  beforeAll(async () => {
    male = await loadMesh("male");
    female = await loadMesh("female");
  }, 30000);

  test("the male mesh is unchanged by scaling (the constants were built on it)", () => {
    const { mod, data } = male;
    expect(data.scale).toBeCloseTo(1, 3);
    const cm = (k) => mod.rawToCm(k, data.neutralMeasurements[k], 1);
    // neutral-mesh values from before the scaling change
    expect(cm("hip")).toBeCloseTo(99.6, 0);
    expect(cm("waist")).toBeCloseTo(74.9, 0);
    expect(cm("chest")).toBeCloseTo(94.1, 0);
    expect(cm("shoulder")).toBeCloseTo(45.2, 0);
    expect(cm("arm")).toBeCloseTo(33.1, 0);
  });

  test("the female mesh gets a real arm, a torso-only chest, and hips at the hips", () => {
    const { mod, data } = female;
    const cm = (k) => mod.rawToCm(k, data.neutralMeasurements[k], 1);
    expect(data.neutralMeasurements.arm).not.toBeNull();   // was null: band had 0 vertices
    expect(cm("arm")).toBeGreaterThan(20);
    expect(cm("arm")).toBeLessThan(35);
    expect(cm("chest")).toBeLessThan(cm("hip"));             // was 110.1 vs 87.5
  });

  test("the chest landmark sits at the same fraction of height on both meshes", () => {
    const frac = (d) => d.landmarks.chest / d.baseHeight;
    expect(Math.abs(frac(male.data) - frac(female.data))).toBeLessThan(0.01);
  });
});
