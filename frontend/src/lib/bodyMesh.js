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
// `part` (optional, data.part) classifies triangles by their corners: any arm
// corner drops the triangle; all-torso always counts, however far a big
// chest pushes its own sides past maxAx; anything touching the unclassified
// region above the armpit falls back to the maxAx test (the muscle morph
// moves the chest's vertices up to 5cm in y, so a live chest slice does
// cross triangles from above the armpit).
export const PART_ARM = 0, PART_TORSO = 1, PART_ABOVE = 2;
export function sliceMeasure(pos, index, y0, maxAx = Infinity, part = null) {
  let perimeter = 0, maxAbsX = 0;
  for (let t = 0; t < index.length; t += 3) {
    let cut = maxAx;
    if (part) {
      const a = part[index[t]], b = part[index[t + 1]], c = part[index[t + 2]];
      if (a === PART_ARM || b === PART_ARM || c === PART_ARM) continue;
      if (a === PART_TORSO && b === PART_TORSO && c === PART_TORSO) cut = Infinity;
    }
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
    if (Math.abs((x1 + x2) / 2) > cut) continue;
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
};

// The shoulder used to be a window above too - the widest slice with |x| <=
// 0.22 - but in A-pose the arm leaves the torso sideways all the way from
// 1.275m to 1.41m (male), so every slice there hit the cap: the "neutral
// shoulder width" was just 2 x 0.22, and no morph could ever change it.
// Instead: the top of the shoulder, scanning down to the first height whose
// full, uncapped width reaches SHOULDER_EDGE - where the shoulder slope
// turns into the arm (1.41m male, 1.395 in male units female): 44.2cm on the
// slim 1.73m base male, where 45.2 used to be the cap's own 2 x 0.22.
const SHOULDER_EDGE = 0.22;

function findAllLandmarks(base, index, scale = 1) {
  const out = {};
  for (const [key, [yFrom, yTo, maxAx, metric, wantMax]] of Object.entries(LANDMARK_WINDOWS)) {
    out[key] = findLandmark(base, index, yFrom * scale, yTo * scale, maxAx * scale, metric, wantMax);
  }
  out.shoulder = 1.41 * scale;
  for (let y = 1.46 * scale; y >= 1.3 * scale; y -= 0.004) {
    if (sliceMeasure(base, index, y).maxAbsX >= SHOULDER_EDGE * scale) { out.shoulder = y; break; }
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
  shoulder: { mode: "width" }, // full width at the shoulder top, see SHOULDER_EDGE
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
// `part` (data.part) lets the chest, waist and hip rings count torso
// triangles past the |x| cut: a chest scaled up 25% pushes its sides past
// the chest's 0.19 cut, and they dropped out of the measurement (118cm
// read 87). See sliceMeasure.
export function measureRegions(pos, index, landmarks, regions = MEASURE_REGIONS, part = null) {
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
      const m = sliceMeasure(pos, index, y0, maxAx ?? Infinity, mode === "width" ? null : part);
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
  const torso = floodBelow(adj, base, seeds, lo);
  const part = new Uint8Array(torso.length);
  for (let v = 0; v < part.length; v++) {
    part[v] = torso[v] ? PART_TORSO : base[v * 3 + 1] >= lo ? PART_ABOVE : PART_ARM;
  }
  return { armpit: lo, torso, part };
}

// Head, hands and feet are mostly bone, so they must not take the body's
// full width factor (that tracks mass). Each vertex gets a group and a 0..1
// blend weight, found once on the base mesh; BodyModel measures each
// group's centre on the live shape and scales it about that. Groups:
export const EXT_HEAD = 1, EXT_HAND_R = 2, EXT_HAND_L = 3, EXT_FOOT_R = 4, EXT_FOOT_L = 5;
// - head: from the narrowest point of the neck up over HEAD_BLEND.
// - hands: along each arm's own shoulder -> fingertip axis (a fixed-|x| slice
//   cuts the sloped A-pose arm at an angle); the arm is narrowest at 0.70 of
//   that length on both meshes, which is the wrist.
// - feet: below the ankle, the narrowest leg slice (0.13 x scale on both).
const WRIST_T = 0.7, WRIST_BLEND = [-0.07, -0.01];
const ANKLE_Y = 0.13, ANKLE_BLEND = 0.05;
function segmentExtremities(base, part, landmarks, armpit, baseHeight, scale) {
  const n = part.length;
  const group = new Uint8Array(n), weight = new Float32Array(n);
  const headFrom = landmarks.neck, headTo = headFrom + HEAD_BLEND * baseHeight;
  for (let v = 0; v < n; v++) {
    const y = base[v * 3 + 1];
    if (y > headFrom) { group[v] = EXT_HEAD; weight[v] = smooth01((y - headFrom) / (headTo - headFrom)); }
    const ankle = ANKLE_Y * scale;
    if (y < ankle && part[v] !== PART_ARM) {
      group[v] = base[v * 3] >= 0 ? EXT_FOOT_R : EXT_FOOT_L;
      weight[v] = smooth01((ankle - y) / (ANKLE_BLEND * scale));
    }
  }
  for (const sign of [1, -1]) {
    let tip = -1, ax = 0, ay = 0, az = 0, an = 0;
    for (let v = 0; v < n; v++) {
      if (part[v] !== PART_ARM || Math.sign(base[v * 3]) !== sign) continue;
      if (tip < 0 || sign * base[v * 3] > sign * base[tip * 3]) tip = v;
      if (base[v * 3 + 1] > armpit - 0.03 * scale) { ax += base[v * 3]; ay += base[v * 3 + 1]; az += base[v * 3 + 2]; an++; }
    }
    if (tip < 0 || an === 0) continue;
    const A = [ax / an, ay / an, az / an];
    const d = [base[tip * 3] - A[0], base[tip * 3 + 1] - A[1], base[tip * 3 + 2] - A[2]];
    const len = Math.hypot(...d), u = d.map((c) => c / len);
    const lo = WRIST_T * len + WRIST_BLEND[0] * scale, hi = WRIST_T * len + WRIST_BLEND[1] * scale;
    for (let v = 0; v < n; v++) {
      if (part[v] !== PART_ARM || Math.sign(base[v * 3]) !== sign) continue;
      const t = (base[v * 3] - A[0]) * u[0] + (base[v * 3 + 1] - A[1]) * u[1] + (base[v * 3 + 2] - A[2]) * u[2];
      if (t <= lo) continue;
      group[v] = sign > 0 ? EXT_HAND_R : EXT_HAND_L;
      weight[v] = smooth01((t - lo) / (hi - lo));
    }
  }
  return { group, weight };
}

const DELTA_SMOOTH_PASSES = 6;

// The heavy target is gross fat gain: +16L on the base male (the fat itself
// going 23 -> 40% at his 67kg is ~12.7L), spread over belly 5.6L, torso
// sides/back 2.3, arms 2.8, shoulders/upper chest 2.6, legs/hips 2.5. But the
// fat axis is composition at CONSTANT weight (weight is the frame scale's
// job), so that fat replaces an equal mass of lean tissue, and the muscle
// morph can only take back 4.6L of the ~10L that has to go. Net, the mesh
// grew 27% (female 33%) where physics says ~3.5%: a 178cm/80kg woman at 48%
// estimated 129cm hips. In the limbs, hips and upper torso, fat really does
// displace local muscle ~1:1 by mass (the same rule build-bodies.mjs applies
// to the legs), and fat takes 1.1/0.9 the volume of lean, so a region's net
// growth is only 1 - 0.9/1.1 = 18% of the fat added there. The abdomen is
// the exception - little muscle to lose and the main fat store - so it keeps
// the full offset and the belly still reads (per the 2026-09-15 feedback
// that fat gain has to be visible).
const FAT_NET_OF_DISPLACED_LEAN = 1 - 0.9 / 1.1;
export function netHeavyOfLeanLoss(dHeavy, abdomen) {
  const out = Float32Array.from(dHeavy);
  for (let v = 0; v < abdomen.length; v++) {
    const k = abdomen[v] + (1 - abdomen[v]) * FAT_NET_OF_DISPLACED_LEAN;
    out[v * 3] *= k; out[v * 3 + 1] *= k; out[v * 3 + 2] *= k;
  }
  return out;
}

// The abdomen, as a smooth 0..1 weight: torso between just below the hips'
// landmark and a little under the armpit. Shared by the fat map above and by
// the frame's width scaling (bodyShape.js widthScale), which both treat the
// abdomen differently from the rest of the body. `band` gives the same weight
// at any height, for a measurement landmark.
export function abdomenBand(landmarks, armpit, scale) {
  return { lo: landmarks.hip - 0.02 * scale, hi: armpit - 0.04 * scale, ramp: 0.1 * scale };
}
export const abdomenAt = ({ lo, hi, ramp }, y) => smooth01((y - lo) / ramp) * smooth01((hi - y) / ramp);
function abdomenWeights(base, part, band) {
  const w = new Float32Array(part.length);
  for (let v = 0; v < part.length; v++) if (part[v] === PART_TORSO) w[v] = abdomenAt(band, base[v * 3 + 1]);
  return w;
}

// For the frame's width, the abdomen's extra growth goes mostly forward and
// to the sides, not out the lower back: applied all the way round, the back
// widened at the full rate while the glutes just below took the body's
// damped rate, and heavy bodies grew a shelf across the lower back. Same
// front bias build-bodies.mjs gives the heavy morph: full at the belly, a
// quarter at the back.
function frontBiased(abdomen, base, scale) {
  const w = new Float32Array(abdomen.length);
  for (let v = 0; v < w.length; v++) {
    if (!abdomen[v]) continue;
    w[v] = abdomen[v] * (0.25 + 0.75 * smooth01((base[v * 3 + 2] + 0.04 * scale) / (0.12 * scale)));
  }
  return w;
}

// The mean of a per-vertex field over the torso ring at height y0 - how much
// of the abdomen's width a waist/hip/chest tape measurement actually picks up.
function ringMean(field, base, part, y0, scale) {
  let s = 0, n = 0;
  for (let v = 0; v < part.length; v++) {
    if (part[v] !== PART_TORSO || Math.abs(base[v * 3 + 1] - y0) > 0.01 * scale) continue;
    s += field[v]; n++;
  }
  return n ? s / n : 0;
}
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The lean target is MakeHuman's underweight body, not a lower-fat one: on
// its own it took the male arm from 33.1 to 26.3cm and the chest from 94 to
// 86, so at constant weight an 80kg man at 6% (the most lean mass of any
// setting) rendered skinnier than at 10-20% - arm 31.3cm vs 35.3 at 20%,
// shrinking as muscle went up. Its waist change (-5.3cm) is about what 17
// points of fat off the belly does; the arms and chest were far past that.
// The heavy target is the app's own map of where fat is stored, and at
// constant weight the lean end (6%) and heavy end (40%) are the same 17
// points of fat either side of neutral - so fat loss is capped, per vertex,
// at a fraction of the fat gain there. Direction is kept (the lean target's
// shape detail stays); only the overreach goes.
// The fraction is pinned by skinfolds: US men average a ~12mm triceps
// skinfold (NHANES anthropometric reference data) - a double layer, so ~6mm
// of arm fat, ~2mm of it essential - so neutral -> 6% can take ~4mm off the
// arm's radius, and the heavy target moves the arm ~10mm: c <= 0.4. The
// belly needs ~8mm of its ~35mm heavy offset to keep the waist change the
// lean target already got right: c >= 0.24. 0.3 sits inside both; a full-
// cap version (c = 1) barely changed anything (arm 26.3 -> 28.3cm).
const LEAN_OF_HEAVY = 0.3;
export function capLeanByHeavy(dLean, dHeavy, c = LEAN_OF_HEAVY) {
  const out = Float32Array.from(dLean);
  for (let j = 0; j < out.length; j += 3) {
    const l = Math.hypot(out[j], out[j + 1], out[j + 2]);
    const h = c * Math.hypot(dHeavy[j], dHeavy[j + 1], dHeavy[j + 2]);
    if (l <= h || l === 0) continue;
    const k = h / l;
    out[j] *= k; out[j + 1] *= k; out[j + 2] *= k;
  }
  return out;
}

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
      data.dLean = capLeanByHeavy(data.dLean, data.dHeavy);
      data.scale = data.baseHeight / MALE_REFERENCE_HEIGHT;
      data.regions = regionsForScale(data.scale);
      data.landmarks = findAllLandmarks(data.base, data.index, data.scale);
      // fixed calibration reference - see BodyModel.jsx's blendWithMeasurements.
      Object.assign(data, segmentTorso(data.base, adj, data.landmarks.waist, data.scale));
      data.neutralMeasurements = measureRegions(data.base, data.index, data.landmarks, data.regions, data.part);
      // after capLeanByHeavy, which needs the gross fat map
      data.abdomenBand = abdomenBand(data.landmarks, data.armpit, data.scale);
      data.abdomen = abdomenWeights(data.base, data.part, data.abdomenBand);
      data.dHeavy = netHeavyOfLeanLoss(data.dHeavy, data.abdomen);
      data.abdomenWidth = frontBiased(data.abdomen, data.base, data.scale);
      data.ringAbdomen = {};
      for (const k of ["chest", "waist", "hip"]) {
        data.ringAbdomen[k] = ringMean(data.abdomenWidth, data.base, data.part, data.landmarks[k], data.scale);
      }
      data.extremities = segmentExtremities(data.base, data.part, data.landmarks, data.armpit, data.baseHeight, data.scale);
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
