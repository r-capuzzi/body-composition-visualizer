// Measurement overrides against the real meshes: each one has to land on the
// number the user typed, and has to do it without tearing the surface. A tear
// is an edge stretched far past the override's own ratio - what a hard
// region cut used to do across the upper arm (waist) and down the chest's
// sides (chest), where one end of an edge moved and the other didn't.

import { readFileSync } from "fs";
import { resolve } from "path";

async function loadMesh(sex) {
  const file = readFileSync(resolve(__dirname, `../../public/models/${sex}.bin`));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf })));
  vi.resetModules();
  const mesh = await import("./bodyMesh");
  const shape = await import("./bodyShape");
  const data = await mesh.getBodyData(sex);
  vi.unstubAllGlobals();
  return { mesh, shape, data };
}

// a fixed mid-range body: some muscle, a little heavy, at the mesh's own size
const INF = [0.6, 0.2, 0];

function shaped({ shape, data }, measurements) {
  const pos = new Float32Array(data.base.length);
  shape.blendWithMeasurements(pos, data, ...INF, measurements, 1);
  return pos;
}

function maxEdgeStretch(index, a, b) {
  let worst = 1;
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = index[t + e] * 3, j = index[t + ((e + 1) % 3)] * 3;
      const la = Math.hypot(a[i] - a[j], a[i + 1] - a[j + 1], a[i + 2] - a[j + 2]);
      const lb = Math.hypot(b[i] - b[j], b[i + 1] - b[j + 1], b[i + 2] - b[j + 2]);
      if (la > 1e-5) worst = Math.max(worst, lb / la);
    }
  }
  return worst;
}

describe.each(["male", "female"])("%s measurement overrides", (sex) => {
  let m;
  beforeAll(async () => { m = await loadMesh(sex); }, 30000);

  const cases = sex === "male"
    ? { shoulder: [40, 52], chest: [90, 118], waist: [76, 105], hip: [92, 110] }
    : { shoulder: [36, 46], chest: [82, 102], waist: [66, 90], hip: [96, 115] };

  test.each(Object.keys(cases))("%s hits its target without tearing", (key) => {
    const { mesh, data } = m;
    const plain = shaped(m, {});
    const measure = (pos) => mesh.rawToCm(key, mesh.measureRegions(pos, data.index, data.landmarks, data.regions, data.part)[key], 1);
    const before = measure(plain);
    for (const cm of cases[key]) {
      const pos = shaped(m, { [key]: cm });
      // calibrated against the neutral mesh, so it lands on target x (live / neutral)
      const neutral = mesh.rawToCm(key, data.neutralMeasurements[key], 1);
      expect(measure(pos)).toBeCloseTo((cm * before) / neutral, 0);
      const ratio = cm / neutral;
      expect(maxEdgeStretch(data.index, plain, pos)).toBeLessThan(Math.max(ratio, 1 / ratio) * 1.35);
    }
  });

  test("a more muscular body never measures a smaller chest", () => {
    // the muscle morph lifts chest vertices up to 5cm, so the live chest
    // slice crosses triangles from above the armpit; counting only torso
    // triangles there read a full-muscle man's chest as 78.6cm (neutral 94.1)
    const { mesh, data } = m;
    const chest = (muscle) => mesh.rawToCm("chest",
      mesh.measureRegions(mesh.blendPositions(data, muscle, 0, 0), data.index, data.landmarks, data.regions, data.part).chest, 1);
    let prev = chest(0);
    for (const muscle of [0.25, 0.5, 0.75, 1]) {
      const c = chest(muscle);
      expect(c).toBeGreaterThanOrEqual(prev - 0.5);
      prev = c;
    }
  });

  test("a heavier frame widens the body but not the hands, feet or head as much", () => {
    const { mesh, shape, data } = m;
    const off = { x: 0, y: 0, z: 0 };
    const framed = (frame) => {
      const pos = shaped(m, {});
      shape.applyFrame(pos, data, frame, 1, off);
      return pos;
    };
    // x/z spread of one extremity group's fully-weighted vertices
    const spread = (pos, g) => {
      let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < data.extremities.group.length; v++) {
        if (data.extremities.group[v] !== g || data.extremities.weight[v] < 1) continue;
        lo = Math.min(lo, pos[v * 3 + 2]); hi = Math.max(hi, pos[v * 3 + 2]);
      }
      return hi - lo;
    };
    const one = framed(1), big = framed(1.46); // BMI ~45 on the base male
    for (const g of [mesh.EXT_HEAD, mesh.EXT_HAND_R, mesh.EXT_HAND_L, mesh.EXT_FOOT_R, mesh.EXT_FOOT_L]) {
      expect(spread(big, g) / spread(one, g)).toBeCloseTo(Math.sqrt(1.46), 2);
    }
    const waist = (pos) => mesh.rawToCm("waist", mesh.measureRegions(pos, data.index, data.landmarks, data.regions, data.part).waist, 1);
    expect(waist(big) / waist(one)).toBeCloseTo(1.46, 1);
    // and the neck/wrist/ankle blends don't tear
    expect(maxEdgeStretch(data.index, one, big)).toBeLessThan(1.46 * 1.15);
  });

  test("shoulder width actually moves the arms apart", () => {
    const { data } = m;
    const tipX = (pos) => { let x = 0; for (let i = 0; i < pos.length; i += 3) x = Math.max(x, pos[i]); return x; };
    const [narrow, broad] = cases.shoulder;
    // each fingertip moves by half the width change
    expect((tipX(shaped(m, { shoulder: broad })) - tipX(shaped(m, { shoulder: narrow }))) * 2 * 100)
      .toBeGreaterThan((broad - narrow) * 0.9);
    expect(data.landmarks.shoulder / data.baseHeight).toBeGreaterThan(0.79);
  });
});
