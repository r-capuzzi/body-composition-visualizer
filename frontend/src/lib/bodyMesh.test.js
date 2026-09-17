import { sliceMeasure, inArmBand, rawToCm, cmToRawTarget } from "./bodyMesh";

// A 1x1x1 cube from y=0 to y=1, centred on x=0/z=0 (half-width 0.5 each way).
// Only the 4 side faces matter for a horizontal slice (top/bottom never cross
// a mid-height plane), 2 triangles per side = 8 triangles total.
function cubeMesh() {
  const v = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], // 0-3 bottom
    [-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], // 4-7 top
  ];
  const pos = new Float32Array(v.flat());
  const index = new Uint32Array([
    0, 1, 5, 0, 5, 4, // front (z=-0.5)
    1, 2, 6, 1, 6, 5, // right (x=0.5)
    2, 3, 7, 2, 7, 6, // back (z=0.5)
    3, 0, 4, 3, 4, 7, // left (x=-0.5)
  ]);
  return { pos, index };
}

test("sliceMeasure: a 1x1x1 cube's mid-height slice has perimeter 4 and half-width 0.5", () => {
  const { pos, index } = cubeMesh();
  const { perimeter, maxAbsX } = sliceMeasure(pos, index, 0.5);
  expect(perimeter).toBeCloseTo(4, 6); // 4 sides of length 1
  expect(maxAbsX).toBeCloseTo(0.5, 6);
});

test("sliceMeasure: maxAx excludes the left/right faces (|x|=0.5), keeping only front+back", () => {
  const { pos, index } = cubeMesh();
  const { perimeter } = sliceMeasure(pos, index, 0.5, 0.3);
  expect(perimeter).toBeCloseTo(2, 6); // just the front and back sides
});

test("sliceMeasure: a plane outside the mesh's y-range crosses nothing", () => {
  const { pos, index } = cubeMesh();
  const { perimeter, maxAbsX } = sliceMeasure(pos, index, 5);
  expect(perimeter).toBe(0);
  expect(maxAbsX).toBe(0);
});

test("inArmBand: selects the correct side and radial range", () => {
  expect(inArmBand(0.22, 0.19, 0.27, 1)).toBe(true);
  expect(inArmBand(0.22, 0.19, 0.27, -1)).toBe(false); // wrong side
  expect(inArmBand(-0.22, 0.19, 0.27, -1)).toBe(true);
  expect(inArmBand(0.1, 0.19, 0.27, 1)).toBe(false); // inside the exclusion radius
  expect(inArmBand(0.3, 0.19, 0.27, 1)).toBe(false); // outside the band
});

// These pin down the exact bug fixed this session: `sliceMeasure` returns a
// TRUE PERIMETER for the torso regions (already circumference-equivalent, no
// further conversion), but a MEAN RADIUS for the `local` arm region (which
// does need the radius->circumference 2*PI step). Getting this backwards is
// what made "show current measurements" briefly display ~650cm for a real
// ~103cm chest, and had been silently clamping every waist/chest/hip
// override to the same ratio floor regardless of the typed-in value. A naive
// "does cmToRawTarget invert rawToCm" round-trip test would NOT have caught
// this - both functions had the same erroneous 2*PI, so composing them
// cancelled it out. These check each function against its own real-world
// meaning instead.
test("rawToCm: non-local circumference (waist/chest/hip) treats raw as an already-true perimeter", () => {
  // sliceMeasure's perimeter for a real 1m-circumference cross-section is
  // exactly 1 (in mesh metres); at frameScale=1 that must be 100cm directly.
  expect(rawToCm("waist", 1, 1)).toBeCloseTo(100, 6);
  expect(rawToCm("chest", 1, 1)).toBeCloseTo(100, 6);
  expect(rawToCm("hip", 1, 1)).toBeCloseTo(100, 6);
});

test("rawToCm: local (arm) treats raw as a mean radius, needs 2*PI to become a circumference", () => {
  expect(rawToCm("arm", 1, 1)).toBeCloseTo(2 * Math.PI * 100, 6);
});

test("rawToCm: width (shoulder) doubles a half-width into a full width", () => {
  expect(rawToCm("shoulder", 1, 1)).toBeCloseTo(200, 6);
});

test("rawToCm respects frameScale", () => {
  expect(rawToCm("waist", 1, 1.1)).toBeCloseTo(110, 6);
});

test("cmToRawTarget is the semantic inverse of rawToCm at frameScale=1, per region", () => {
  for (const key of ["waist", "chest", "hip", "arm", "shoulder"]) {
    const raw = 0.8;
    const cm = rawToCm(key, raw, 1);
    expect(cmToRawTarget(key, cm)).toBeCloseTo(raw, 6);
  }
});
