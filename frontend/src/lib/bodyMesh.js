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

// Every distance below was tuned by hand on the MALE mesh (1.733m tall), and
// used to be applied as absolute metres to both meshes. The female mesh is
// 1.593m, so each window landed somewhere else on her body: the arm band sat
// above her arms (zero vertices - the arm override silently did nothing), the
// chest slice ran through her armpit where arm and torso are one surface
// (110cm neutral chest), and the hip search pinned above her hips (87.5cm,
// smaller than that chest). So they are written here in male-mesh units and
// scaled per mesh by baseHeight / MALE_REFERENCE_HEIGHT - identical for the
// male mesh by construction, and on the female mesh the chest landmark lands
// at 72.6% of height, the same fraction as the male's.
export const MALE_REFERENCE_HEIGHT = 1.733;

// Fraction of height over which the head blends from body-width scaling to
// its own (from the narrowest point of the neck upward) - see BodyModel.
const HEAD_BLEND = 0.04;

// Search windows are deliberately narrow - wide enough to cover build-to-build
// variation in where each landmark falls, not so wide they'd find the wrong
// anatomical feature (hip's window stops short of where upper-thigh flare
// would out-measure the actual hip). maxAx=0.19-0.22 for chest/shoulder keeps
// the search from seeing the arm-inflated part of the scan; waist/hip don't
// need it as tight since the outstretched arm doesn't reach that low.
const LANDMARK_WINDOWS = {
  hip: [0.86, 0.94, 0.32, "perimeter", true],
  waist: [0.96, 1.12, 0.32, "perimeter", false],
  chest: [1.15, 1.26, 0.19, "perimeter", true],
  shoulder: [1.28, 1.44, 0.22, "width", true],
};

function findAllLandmarks(base, index, scale = 1) {
  const out = {};
  for (const [key, [yFrom, yTo, maxAx, metric, wantMax]] of Object.entries(LANDMARK_WINDOWS)) {
    out[key] = findLandmark(base, index, yFrom * scale, yTo * scale, maxAx * scale, metric, wantMax);
  }
  // narrowest point of the neck - where the head stops taking the body's
  // width scaling (see BodyModel). maxAx keeps the shoulders out of the slice.
  let neckBest = Infinity;
  out.neck = 1.5 * scale;
  for (let y = 1.4 * scale; y <= 1.58 * scale; y += 0.004) {
    const p = sliceMeasure(base, index, y, 0.12 * scale).perimeter;
    if (p > 0.05 && p < neckBest) { neckBest = p; out.neck = y; }
  }
  // the arm's `local` measurement (below) centres on the arm's own mean
  // position instead of slicing about the origin, so the min/max search above
  // doesn't apply to it - fixed at the upper-arm band, verified arm-only on
  // both meshes (one continuous ring of vertices, not arm + torso bleed).
  out.arm = 1.33 * scale;
  return out;
}

// In male-mesh units - use regionsForScale() for a given mesh. `bandHalf` is
// the arm band's half-height in y.
export const MEASURE_REGIONS = {
  shoulder: { mode: "width", maxAx: 0.22 },
  chest: { mode: "circumference", maxAx: 0.19 },
  waist: { mode: "circumference", maxAx: 0.32, torsoOnly: true },
  hip: { mode: "circumference", maxAx: 0.32, torsoOnly: true },
  arm: { mode: "circumference", minAx: 0.19, maxAx: 0.27, bandHalf: 0.03, local: true },
};

const SCALED_KEYS = ["maxAx", "minAx", "bandHalf"];
export function regionsForScale(scale) {
  const out = {};
  for (const [key, region] of Object.entries(MEASURE_REGIONS)) {
    out[key] = { ...region };
    for (const k of SCALED_KEYS) if (region[k] != null) out[key][k] = region[k] * scale;
  }
  return out;
}

// True for a vertex whose |x| falls in this region's arm band, on the given
// side (sign > 0 for the +x arm, < 0 for the -x arm). Torso regions (no
// minAx/maxAx pairing beyond a single maxAx) don't use this.
export const inArmBand = (x, minAx, maxAx, sign) =>
  sign > 0 ? x >= minAx && x <= maxAx : x <= -minAx && x >= -maxAx;

// Raw (pre-frameScale, mesh-unit) measurement for every region against
// WHATEVER position array is passed in - the unmorphed base (a fixed
// calibration reference, see BodyModel.jsx) or a live muscle/fat blend (to
// show the current estimate in the form). `regions` must be the scaled set
// for this mesh (data.regions) - the unscaled MEASURE_REGIONS only fit the
// male mesh.
export function measureRegions(pos, index, landmarks, regions = MEASURE_REGIONS) {
  const out = {};
  for (const key of Object.keys(regions)) {
    const { mode, maxAx, minAx = 0, bandHalf = 0.03, local } = regions[key];
    const y0 = landmarks[key];
    if (local) {
      const yLo = y0 - bandHalf, yHi = y0 + bandHalf;
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

export function buildAdjacency(vc, index) {
  const sets = Array.from({ length: vc }, () => new Set());
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e], b = index[t + ((e + 1) % 3)];
      sets[a].add(b); sets[b].add(a);
    }
  }
  return sets.map((s) => Uint32Array.from(s));
}

// Which vertices a flood fill over the mesh's edges reaches from `seeds`
// without ever stepping onto a vertex at or above `ceilY` (base-mesh y).
// Returns a Uint8Array, 1 = reached.
export function floodBelow(adj, base, seeds, ceilY) {
  const reached = new Uint8Array(adj.length);
  // explicit stack, not recursion (13k vertices); mark on push so no vertex
  // is ever queued twice
  const stack = [];
  for (const s of seeds) {
    if (base[s * 3 + 1] < ceilY && !reached[s]) { reached[s] = 1; stack.push(s); }
  }
  while (stack.length) {
    const nb = adj[stack.pop()];
    for (let i = 0; i < nb.length; i++) {
      const w = nb[i];
      if (reached[w] || base[w * 3 + 1] >= ceilY) continue;
      reached[w] = 1;
      stack.push(w);
    }
  }
  return reached;
}

// Below the armpit the A-pose arm and the torso are separate surfaces, so a
// flood from the belly under a y ceiling reaches the torso (and legs) but not
// the arms - until the ceiling rises past where they join. Binary-search that
// height (the armpit), then keep the torso set from just under it. Torso
// regions use this instead of an |x| cut: the arm's inner edge dips inside
// the waist's maxAx from ~1.16m on the male mesh and ~1.05m on the female,
// so a bigger waist was tearing a seam across the upper arm.
function segmentTorso(base, adj, y0, scale) {
  const seeds = [];
  let hand = 0;
  for (let v = 0; v < adj.length; v++) {
    const x = base[v * 3], y = base[v * 3 + 1];
    if (Math.abs(x) < 0.03 * scale && Math.abs(y - y0) < 0.02 * scale) seeds.push(v);
    if (x > base[hand * 3]) hand = v; // outermost fingertip of the +x arm
  }
  let lo = y0, hi = y0 + 0.5 * scale;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (floodBelow(adj, base, seeds, mid)[hand]) hi = mid;
    else lo = mid;
  }
  return { armpit: lo, torso: floodBelow(adj, base, seeds, lo) };
}

const DELTA_SMOOTH_PASSES = 6;

// Uniform-Laplacian smoothing of a per-vertex offset field: each pass moves
// every offset halfway toward the mean of its neighbours'.
export function smoothDeltas(delta, adj, iters) {
  let cur = Float32Array.from(delta), nxt = new Float32Array(delta.length);
  const pass = (k) => {
    for (let v = 0; v < adj.length; v++) {
      const A = adj[v]; let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < A.length; i++) { const w = A[i] * 3; sx += cur[w]; sy += cur[w + 1]; sz += cur[w + 2]; }
      const n = A.length || 1, j = v * 3;
      nxt[j] = cur[j] + k * (sx / n - cur[j]);
      nxt[j + 1] = cur[j + 1] + k * (sy / n - cur[j + 1]);
      nxt[j + 2] = cur[j + 2] + k * (sz / n - cur[j + 2]);
    }
    [cur, nxt] = [nxt, cur];
  };
  for (let i = 0; i < iters; i++) pass(0.5);
  return cur;
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
    .then((r) => {
      // fetch only rejects on network failure - a 404 or a 500 resolves
      // normally, so without this the error page's bytes get parsed as mesh
      // data and either blow up on a confusing RangeError or read a garbage
      // vertex count and try to allocate an absurd typed array.
      if (!r.ok) {
        throw new Error(`Could not load the ${sex} body model (HTTP ${r.status}).`);
      }
      return r.arrayBuffer();
    })
    .then((buf) => {
      if (buf.byteLength < HEADER) {
        throw new Error(`The ${sex} body model file looks truncated or corrupt.`);
      }
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
      // Smooth the morph OFFSETS (never the base mesh, so the face and hands
      // keep their detail). The MakeHuman targets carry small lumps that the
      // old lighting hid and correct lighting reveals: a ball-shaped deltoid
      // with a hard crease against the chest on heavy/muscular builds, and a
      // faceted band at the elbow. Measured over every edge, heavy at full
      // strength folds 949 edges >25deg sharper than the base mesh; 6 passes
      // of Laplacian smoothing cut that to 116 (-88%) at the cost of ~0.8cm
      // of forward belly (9.7 -> 8.9cm). Taubin smoothing kept the belly
      // almost exactly but left the deltoid ball and elbow facets visible,
      // which were the problems - so Laplacian, chosen by side-by-side renders.
      const adj = buildAdjacency(vc, data.index);
      for (const k of ["dMuscle", "dHeavy", "dLean"]) data[k] = smoothDeltas(data[k], adj, DELTA_SMOOTH_PASSES);
      data.scale = data.baseHeight / MALE_REFERENCE_HEIGHT;
      data.regions = regionsForScale(data.scale);
      data.landmarks = findAllLandmarks(data.base, data.index, data.scale);
      // fixed calibration reference - see BodyModel.jsx's blendWithMeasurements.
      data.neutralMeasurements = measureRegions(data.base, data.index, data.landmarks, data.regions);
      Object.assign(data, segmentTorso(data.base, adj, data.landmarks.waist, data.scale));
      // the head's own horizontal centre, so BodyModel can scale it about
      // itself (a head that sits forward of the body's centre line would
      // otherwise drift as the scale changes)
      const headFrom = data.landmarks.neck + HEAD_BLEND * data.baseHeight;
      let hn = 0, hx = 0, hz = 0;
      for (let i = 0; i < data.base.length; i += 3) {
        if (data.base[i + 1] < headFrom) continue;
        hn++; hx += data.base[i]; hz += data.base[i + 2];
      }
      data.head = { from: data.landmarks.neck, to: headFrom, cx: hx / hn, cz: hz / hn };
      entry.status = "done";
      entry.data = data;
      return data;
    })
    .catch((err) => {
      entry.status = "error";
      entry.err = err;
      // Drop the failed entry so a later attempt refetches. The caller that is
      // mid-render still holds this object and still sees status "error", so
      // it fails now as it should - but a transient blip (these files are
      // ~940KB over whatever connection the user has) would otherwise be
      // cached as permanent, and no amount of retrying could ever recover
      // without a full page reload.
      cache.delete(url);
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

// Fire-and-forget warm-up of the shared cache, started at app mount so the
// ~380KB model downloads in parallel with the projection request instead of
// after it. The error is dropped on purpose: a failed load is evicted from the
// cache, so the real consumer (BodyModel) just loads it again and reports any
// failure properly through its ErrorBoundary.
export function prefetchBodyData(sex) {
  loadBodyData(sex).promise.catch(() => {});
}

// Suspense-friendly: throws the pending/rejected promise so a <Suspense>
// boundary can catch it, matching how BodyModel's render path needs to work.
export function useBodySuspense(sex) {
  const entry = loadBodyData(sex);
  if (entry.status === "pending") throw entry.promise;
  if (entry.status === "error") throw entry.err;
  return entry.data;
}
