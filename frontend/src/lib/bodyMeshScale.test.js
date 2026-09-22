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
    // 45.2 before was just 2 x the old 0.22 cap (see SHOULDER_EDGE); this is
    // the real width at the shoulder top
    expect(cm("shoulder")).toBeCloseTo(44.2, 0);
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

  // Waist/hip overrides scale only `data.torso`; before, an |x| cut let them
  // scale part of each upper arm and tear a seam across it.
  test.each(["male", "female"])("the %s torso mask stops at the armpit and leaves the arms out", (sex) => {
    const { data } = sex === "male" ? male : female;
    const { base, torso, armpit, landmarks } = data;
    // measured from where the slice's arm and torso runs merge: 1.30 / 1.20m
    expect(armpit / data.baseHeight).toBeGreaterThan(0.72);
    expect(armpit / data.baseHeight).toBeLessThan(0.78);
    let left = 0, right = 0, low = 0;
    for (let v = 0; v < torso.length; v++) {
      if (base[v * 3] < base[left * 3]) left = v;
      if (base[v * 3] > base[right * 3]) right = v;
      if (base[v * 3 + 1] < base[low * 3 + 1]) low = v;
    }
    expect(torso[left]).toBe(0);  // fingertips
    expect(torso[right]).toBe(0);
    expect(torso[low]).toBe(1);   // the legs hang off the torso, so the feet are in
    // every vertex at the waist landmark inside the old |x| cut, arm aside
    let waistRing = 0;
    for (let v = 0; v < torso.length; v++) {
      if (Math.abs(base[v * 3 + 1] - landmarks.waist) < 0.01 && Math.abs(base[v * 3]) < 0.2 * data.scale) {
        waistRing++;
        expect(torso[v]).toBe(1);
      }
    }
    expect(waistRing).toBeGreaterThan(10);
  });
});

describe("less body fat at the same weight", () => {
  let data, mesh, params;
  beforeAll(async () => {
    ({ mod: mesh, data } = await loadMesh("male"));
    params = await import("./bodyParams");
  }, 30000);

  // at 80kg, 6% has 11kg more lean mass than 20%; the lean target (really
  // MakeHuman's underweight body) used to make that man skinnier - arm 31.3cm
  // vs 35.3, chest shrinking as muscle went up
  test("reads as more muscular, not skinnier", () => {
    const at = (bf) => {
      const p = params.bodyParamsFromStats({ weight_kg: 80, body_fat_pct: bf, lean_mass_kg: 80 * (1 - bf / 100) }, 178, "male");
      const pos = mesh.blendPositions(data, p.muscle, Math.max(0, p.fat * 2 - 1), Math.max(0, 1 - p.fat * 2));
      const r = mesh.measureRegions(pos, data.index, data.landmarks, data.regions, data.part);
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, mesh.rawToCm(k, v, 1)]));
    };
    const lean = at(6), avg = at(20);
    expect(lean.chest).toBeGreaterThan(avg.chest);
    expect(lean.arm).toBeGreaterThan(avg.arm - 1);
    expect(lean.waist).toBeLessThan(avg.waist - 3);
  });
});

describe.each(["male", "female"])("more body fat at the same %s weight", (sex) => {
  let data, mesh;
  beforeAll(async () => { ({ mod: mesh, data } = await loadMesh(sex)); }, 30000);

  const volume = (p, idx) => {
    let v = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
        + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return Math.abs(v) / 6;
  };

  // the heavy morph used to add 27% (male) / 33% (female) volume at constant
  // weight, where fat's lower density accounts for ~3.5%
  test("keeps a visible belly without inflating the whole body", () => {
    const heavy = mesh.blendPositions(data, 0, 1, 0);
    expect(volume(heavy, data.index) / volume(data.base, data.index)).toBeLessThan(1.18);
    const cm = (pos, k) => mesh.rawToCm(k, mesh.measureRegions(pos, data.index, data.landmarks, data.regions, data.part)[k], 1);
    expect(cm(heavy, "waist") - cm(data.base, "waist")).toBeGreaterThan(15); // the belly
    expect(cm(heavy, "arm") - cm(data.base, "arm")).toBeLessThan(1.5);       // fat displaces arm muscle
    expect(cm(heavy, "hip") - cm(data.base, "hip")).toBeLessThan(4);
  });
});

describe("floodBelow", () => {
  test("reaches neighbours under the ceiling and never crosses it", async () => {
    const { floodBelow } = await import("./bodyMesh");
    // a path 0-1-2-3 where vertex 2 is above the ceiling, plus an isolated 4
    const ys = [0, 0.5, 2, 0, 0];
    const base = new Float32Array(ys.flatMap((y) => [0, y, 0]));
    const adj = [[1], [0, 2], [1, 3], [2], []].map((a) => Uint32Array.from(a));
    expect([...floodBelow(adj, base, [0], 1)]).toEqual([1, 1, 0, 0, 0]);
    expect([...floodBelow(adj, base, [0], 3)]).toEqual([1, 1, 1, 1, 0]);
    expect([...floodBelow(adj, base, [2], 1)]).toEqual([0, 0, 0, 0, 0]); // seed above the ceiling
  });
});
