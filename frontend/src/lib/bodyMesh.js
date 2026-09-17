// Shared mesh-measurement math for the MakeHuman .bin bodies - used by both
// BodyModel.jsx (to actually apply a measurement override to the rendered
// mesh) and useEstimatedMeasurements.js (to show what the model's CURRENT,
// un-overridden shape measures, as a live default in the measurement form
// fields). Kept in one place so both stay in sync - two independent
// implementations of "what does this body measure" drifting apart would be
// its own bug.

const URL = (sex) => `${import.meta.env.BASE_URL}models/${sex}.bin`;
const HEADER = 12 + 5 * 4;

// --- measurement regions, v2 (see BodyModel.jsx's git history for v1's two
// real problems - wrong numbers from a circle approximation, and corrections
// that read as pasted on - both fixed by measuring the TRUE mesh cross-
// section instead of approximating it, and a wide smooth taper instead of a
// narrow edge blend; see project memory for the full writeup and sources). ---

// sliceMeasure(y0) intersects every triangle with the horizontal plane y=y0
// and sums the resulting segment lengths - the actual perimeter of the body's
// surface at that height, however non-circular it is (a closed contour's
// total length is the sum of its segments regardless of the order they're
// found in, so no path-ordering is needed). `maxAx` drops crossings whose
// segment midpoint sits out past the torso - needed at chest/shoulder height
// because this mesh's A-pose has the arm stuck out sideways, so an
// unfiltered slice there partly measures arm reach, not chest depth.
export function sliceMeasure(pos, index, y0, maxAx = Infinity) {
  let perimeter = 0, maxAbsX = 0;
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t] * 3, ib = index[t + 1] * 3, ic = index[t + 2] * 3;
    const idxs = [ia, ib, ic];
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const p1 = idxs[e], p2 = idxs[(e + 1) % 3];
      const y1 = pos[p1 + 1], y2 = pos[p2 + 1];
      if ((y1 - y0) * (y2 - y0) < 0) {
        const t2 = (y0 - y1) / (y2 - y1);
        pts.push([pos[p1] + (pos[p2] - pos[p1]) * t2, pos[p1 + 2] + (pos[p2 + 2] - pos[p1 + 2]) * t2]);
      }
    }
    if (pts.length !== 2) continue;
    const [[x1, z1], [x2, z2]] = pts;
    if (Math.abs((x1 + x2) / 2) > maxAx) continue;
    perimeter += Math.hypot(x2 - x1, z2 - z1);
    maxAbsX = Math.max(maxAbsX, Math.abs(x1), Math.abs(x2));
  }
  return { perimeter, maxAbsX };
}

// Each region's own landmark height isn't the same fraction of every body's
// total height (male/female torso proportions differ), so instead of a
// hardcoded y this finds it once per mesh: the y within [yFrom,yTo] where
// `metric` peaks (chest/hip/shoulder - the fullest point) or is smallest
// (waist - the narrowest point), scanning the UNMORPHED base shape.
function findLandmark(base, index, yFrom, yTo, maxAx, metric, wantMax) {
  let bestY = (yFrom + yTo) / 2;
  let bestV = wantMax ? -Infinity : Infinity;
  const STEP = 0.004;
  for (let y = yFrom; y <= yTo; y += STEP) {
    const m = sliceMeasure(base, index, y, maxAx);
    const v = metric === "width" ? m.maxAbsX : m.perimeter;
    if (wantMax ? v > bestV : v < bestV) { bestV = v; bestY = y; }
  }
  return bestY;
}

// Search ranges are absolute metres in this mesh's own (untranslated) space,
// deliberately narrow - wide enough to cover build-to-build variation in
// where each landmark falls, not so wide they'd find the wrong anatomical
// feature entirely (e.g. hip's range stops well short of where upper-thigh
// flare would out-measure the actual hip). maxAx=0.19-0.22 for chest/shoulder
// keeps the search from ever seeing the contaminated, arm-inflated part of
// the scan; waist/hip don't need it as tight since the outstretched arm
// doesn't reach that low.
function findAllLandmarks(base, index) {
  return {
    hip: findLandmark(base, index, 0.86, 0.94, 0.32, "perimeter", true),
    waist: findLandmark(base, index, 0.96, 1.12, 0.32, "perimeter", false),
    chest: findLandmark(base, index, 1.15, 1.26, 0.19, "perimeter", true),
    shoulder: findLandmark(base, index, 1.28, 1.44, 0.22, "width", true),
    // the arm's `local` measurement mode (below) isn't a global-origin slice
    // at all - it centres on the arm's own mean position instead - so the
    // min/max landmark search above doesn't apply to it. Fixed at the upper-
    // arm band verified arm-only, not arm+chest bleed (see measureRegions).
    arm: 1.33,
  };
}

export const MEASURE_REGIONS = {
  shoulder: { mode: "width", maxAx: 0.22 },
  chest: { mode: "circumference", maxAx: 0.19 },
  waist: { mode: "circumference", maxAx: 0.32 },
  hip: { mode: "circumference", maxAx: 0.32 },
  arm: { mode: "circumference", minAx: 0.19, maxAx: 0.27, local: true },
};

// True for a vertex whose |x| falls in this region's arm band, on the given
// side (sign > 0 for the +x arm, < 0 for the -x arm). Torso regions (no
// minAx/maxAx pairing beyond a single maxAx) don't use this.
export const inArmBand = (x, minAx, maxAx, sign) =>
  sign > 0 ? x >= minAx && x <= maxAx : x <= -minAx && x >= -maxAx;

// Raw (pre-frameScale, mesh-unit) measurement for every region against
// WHATEVER position array is passed in - the unmorphed base (a fixed
// calibration reference, see BodyModel.jsx) or a live muscle/fat blend (to
// show the current estimate in the form). Verified the arm's band (y
// 1.30-1.36, |x| 0.19-0.27) is arm-only, not arm+chest bleed, by listing
// every vertex in it and checking z formed one continuous ring instead of
// two separated clusters.
export function measureRegions(pos, index, landmarks) {
  const out = {};
  for (const key of Object.keys(MEASURE_REGIONS)) {
    const { mode, maxAx, minAx = 0, local } = MEASURE_REGIONS[key];
    const y0 = landmarks[key];
    if (local) {
      const yLo = y0 - 0.03, yHi = y0 + 0.03;
      let sumR = 0, sides = 0;
      for (const sign of [1, -1]) {
        let n = 0, cx = 0, cz = 0;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          if (y < yLo || y > yHi || !inArmBand(x, minAx, maxAx, sign)) continue;
          n++; cx += x; cz += z;
        }
        if (n === 0) continue;
        cx /= n; cz /= n;
        let sumRad = 0;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          if (y < yLo || y > yHi || !inArmBand(x, minAx, maxAx, sign)) continue;
          sumRad += Math.hypot(x - cx, z - cz);
        }
        sumR += sumRad / n; sides++;
      }
      out[key] = sides ? sumR / sides : null;
    } else {
      const m = sliceMeasure(pos, index, y0, maxAx);
      out[key] = mode === "width" ? m.maxAbsX : m.perimeter;
    }
  }
  return out;
}

// raw (mesh units, pre-frameScale) -> real-world cm, and back. Shared so the
// override math (cm -> raw target) and the live-estimate display (raw ->
// cm) can never drift apart on the width-vs-circumference distinction.
//
// Bug this fixed: non-local circumference regions (waist/chest/hip) measure
// a TRUE perimeter via sliceMeasure - already circumference-equivalent, no
// further conversion needed. `local` (the arm) instead measures a mean
// RADIUS from its own centre (a real perimeter walk isn't meaningful there,
// see measureRegions), which DOES need the radius->circumference 2*PI step.
// This used to apply that 2*PI step to every circumference-mode region
// unconditionally - a leftover from v1, when EVERY region (including the
// torso ones) measured a mean radius, before sliceMeasure replaced that with
// a true perimeter. Found because it made "show current measurements"
// display ~650cm for a real ~103cm chest (real*2*PI, compounding the already-
// circumference-equivalent value) - and the inverse bug had been silently
// clamping every waist/chest/hip override to the same 0.6 floor ratio
// (target divided by an extra, wrong 2*PI made it ~6.3x too small) regardless
// of what the user actually typed in, ever since sliceMeasure shipped.
export function rawToCm(key, raw, frameScale) {
  const { mode, local } = MEASURE_REGIONS[key];
  const real = raw * frameScale;
  if (mode === "width") return real * 2 * 100;
  return local ? real * 2 * Math.PI * 100 : real * 100;
}
export function cmToRawTarget(key, cm) {
  const { mode, local } = MEASURE_REGIONS[key];
  if (mode === "width") return cm / 100 / 2;
  return local ? cm / 100 / (2 * Math.PI) : cm / 100;
}

// base + Sigma influence*delta, flattened - the same blend BodyModel's GPU
// morph targets do, just on the CPU so region corrections (or, here, a
// measurement) can read the result back before it's rendered.
export function blendPositions(data, infMuscle, infHeavy, infLean) {
  const { base, dMuscle, dHeavy, dLean } = data;
  const pos = new Float32Array(base.length);
  for (let j = 0; j < base.length; j++) {
    pos[j] = base[j] + infMuscle * dMuscle[j] + infHeavy * dHeavy[j] + infLean * dLean[j];
  }
  return pos;
}

// --- one shared cache/loader, two access patterns on top of it: a Suspense-
// friendly throw for BodyModel's render path, and a plain awaitable promise
// for one-off callers (the "show current measurements" button) that aren't
// inside a <Suspense> boundary. Sharing the cache means both read the same
// fetch + landmark scan instead of duplicating the network request. ---
const cache = new Map(); // url -> { status: 'pending'|'done'|'error', promise, data?, err? }

function loadBodyData(sex) {
  const url = URL(sex);
  let entry = cache.get(url);
  if (entry) return entry;
  entry = { status: "pending" };
  entry.promise = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const dv = new DataView(buf);
      const vc = dv.getUint32(4, true);
      const tc = dv.getUint32(8, true);
      const meta = {
        baseHeight: dv.getFloat32(12, true),
        refBMI: dv.getFloat32(16, true),
        lin: [
          dv.getFloat32(20, true), // muscle
          dv.getFloat32(24, true), // heavy
          dv.getFloat32(28, true), // lean
        ],
      };
      let o = HEADER;
      const f32 = (n) => { const a = new Float32Array(buf, o, n); o += n * 4; return a; };
      const u32 = (n) => { const a = new Uint32Array(buf, o, n); o += n * 4; return a; };
      const data = {
        ...meta,
        base: f32(vc * 3),
        index: u32(tc * 3),
        dMuscle: f32(vc * 3),
        dHeavy: f32(vc * 3),
        dLean: f32(vc * 3),
      };
      // once per mesh, not per shape change - the skeleton-driven height of
      // e.g. "the waist" doesn't move when fat/muscle influence does, only
      // its measurement there does.
      data.landmarks = findAllLandmarks(data.base, data.index);
      // fixed calibration reference - see BodyModel.jsx's blendWithMeasurements.
      data.neutralMeasurements = measureRegions(data.base, data.index, data.landmarks);
      entry.status = "done";
      entry.data = data;
      return data;
    })
    .catch((err) => {
      entry.status = "error";
      entry.err = err;
      throw err;
    });
  cache.set(url, entry);
  return entry;
}

// Plain promise, for a one-off async caller outside any <Suspense> boundary
// (the measurement form's "show current measurements" button).
export function getBodyData(sex) {
  return loadBodyData(sex).promise;
}

// Suspense-friendly: throws the pending/rejected promise so a <Suspense>
// boundary can catch it, matching how BodyModel's render path needs to work.
export function useBodySuspense(sex) {
  const entry = loadBodyData(sex);
  if (entry.status === "pending") throw entry.promise;
  if (entry.status === "error") throw entry.err;
  return entry.data;
}
