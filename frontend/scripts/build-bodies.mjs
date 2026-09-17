/**
 * Preprocess the MakeHuman OBJ exports into one compact binary per sex.
 *
 * Reads  public/models/{sex}_{base,muscle,heavy,lean}.obj
 * Writes public/models/{sex}.bin :
 *   magic u32 | vertCount u32 | triCount u32
 *   baseHeight f32 | refBMI f32 | linMuscle f32 | linHeavy f32 | linLean f32
 *   base f32[vc*3] | index u32[tc*3] | dMuscle | dHeavy | dLean  (f32[vc*3] each)
 *
 * The lin* values are each morph target's fractional GIRTH effect (mean radial
 * XZ expansion / radius). Currently unused by BodyModel (which sizes the
 * figure from weight/height/density alone - see its module doc) - kept for a
 * possible future per-region use, harmless dead weight in the meantime.
 *
 * Run once after re-exporting from MakeHuman:  node scripts/build-bodies.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");
const MAGIC = 0x59444f42; // "BODY" little-endian

// The variants come from MakeHuman's Measure tab (real circumference changes),
// but its slider range is conservative. Scale the deltas up for a clearer range.
const AMP = { muscle: 1.6, heavy: 2.1, lean: 1.7 };

const smoothstep = (lo, hi, x) => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

// NOTE: two sessions' worth of attempts at re-posing the arms in code (Z/X
// rotations, then a centreline-based translation) each fixed the artifact
// they targeted but introduced a new one (a hatched arm, a torn wrist, a
// stretched armpit) and still didn't read right once fixed. Pulled back out
// entirely per user request - this build now uses MakeHuman's exported pose
// as-is, arms and all. Revisit by giving MakeHuman a real skeleton + pose and
// exporting all 8 variants in that pose, instead of faking it on the mesh.

// Build a smooth arm centreline from the base mesh: bin the arm vertices by |x|
// and take the mean (y, z) per bin, so we can inflate the lower arm radially
// about it regardless of the A-pose angle. Returns f(|x|) -> [cy, cz].
function armCentreline(base) {
  const BINS = 44, MINX = 0.17, MAXX = 0.6;
  const sy = new Float64Array(BINS), sz = new Float64Array(BINS), cn = new Float64Array(BINS);
  for (let i = 0; i < base.length; i += 3) {
    const ax = Math.abs(base[i]);
    if (ax < MINX || ax >= MAXX) continue;
    const b = Math.floor(((ax - MINX) / (MAXX - MINX)) * BINS);
    sy[b] += base[i + 1]; sz[b] += base[i + 2]; cn[b]++;
  }
  const cy = new Float64Array(BINS), cz = new Float64Array(BINS);
  let ly = 1.3, lz = 0.05;
  for (let b = 0; b < BINS; b++) {
    if (cn[b] > 3) { ly = sy[b] / cn[b]; lz = sz[b] / cn[b]; }
    cy[b] = ly; cz[b] = lz;
  }
  return (ax) => {
    const f = Math.max(0, Math.min(BINS - 1.001, ((ax - MINX) / (MAXX - MINX)) * BINS));
    const b = Math.floor(f), t = f - b;
    return [cy[b] + (cy[b + 1] - cy[b]) * t, cz[b] + (cz[b + 1] - cz[b]) * t];
  };
}

// Per-region fixes for what MakeHuman's Measure tab can't do. Applied AFTER the
// AMP scaling.
function correctDeltas(target, delta, base, armAxis) {
  const n = base.length / 3;
  for (let i = 0; i < n; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const ax = Math.abs(x);

    // --- WAIST: MakeHuman's min-waist slider (and the muscle preset) pinch the
    //     midsection to an hourglass. Nearly remove that narrowing for lean/
    //     muscle. The stomach is the single biggest real fat-storage site, so
    //     the heavy belly is barely damped (k=0.85) - people need to actually
    //     see it grow when body fat % or weight goes up. Overall SIZE staying
    //     put is handled separately (the frame scale in BodyModel.jsx tracks
    //     weight/height only, not this delta), so a big local belly here reads
    //     as "this body's composition changed", not "this got bigger".
    //
    //     This used to cut off hard at y<1.3, which put a seam right at the
    //     shoulder blades: measured on the built mesh, the muscle delta jumps
    //     ~5x from the damped waist (k=0.15) to the fully undamped back one
    //     row of vertices above it - a real geometric step, not a lighting
    //     artifact, and it read as the scapula jutting out. Ease k back to 1
    //     (undamped) over 1.05-1.45m instead of snapping, same smoothstep
    //     pattern as the hips/thighs/glutes block below.
    //
    //     Measured against BodyModel's actual render math: at fixed weight,
    //     lean->overweight grows the frame (BodyModel's weight/height/density
    //     scale) only ~4%, but this waist correction alone was growing waist
    //     radius ~39% - and MakeHuman's own circumference delta is direction-
    //     less, so that 39% came out as a uniform balloon (front, sides, AND
    //     back all pushed out ~equally). A real gut grows mostly forward
    //     (visceral fat is anterior); ballooning sideways too is what read as
    //     "this is just a bigger person" instead of "this person has a gut" -
    //     the frontal silhouette (the angle that most says "how big is this
    //     body") was carrying growth it didn't need. For heavy only, bias the
    //     growth toward the front and damp the sides/back instead.
    //
    //     First pass at this (sides 45-70% of k, back 55%, front up to 140%)
    //     cut lateral waist growth from 39%->22% - real progress, but the
    //     user tried the slider alone (no weight change) again and it still
    //     read as "changing size", not just shape. FrameScale's own density
    //     term (see BodyModel.jsx) got dropped entirely for the same reason.
    //     Cutting the sides harder here (down to 15-25% of k, from 45-70%)
    //     and the back further (30%, from 55%) while pushing the front even
    //     higher (up to 170%, from 140%) keeps the belly at least as visible
    //     while taking a lot more of the "wider from the front" out. ---
    const rTorso = Math.hypot(x, z);
    if (y > 0.92 && y < 1.55 && rTorso < 0.3) {
      const kRaw = target === "lean" ? 0.2 : target === "muscle" ? 0.15 : 0.85;
      const core = 1 - smoothstep(1.05, 1.45, y); // 1 through the waist, -> 0 by the shoulder blades
      const k = 1 - core * (1 - kRaw);
      if (target === "heavy") {
        const front = smoothstep(-0.03, 0.12, z); // 0 at the back seam, 1 by mid-belly
        delta[i * 3] *= k * (0.15 + 0.1 * front); // sides: 15-25% of k
        delta[i * 3 + 1] *= 0.55 + 0.45 * k;
        delta[i * 3 + 2] *= k * (0.3 + 1.4 * front); // back: 30% of k; front: up to 170% (the visible belly)
      } else {
        delta[i * 3] *= k;
        delta[i * 3 + 1] *= 0.55 + 0.45 * k;
        delta[i * 3 + 2] *= k;
      }
    }

    // --- LOWER ARM: MakeHuman has no forearm-circumference control, so the
    //     forearm never follows the upper arm. Inflate it radially about the
    //     arm centreline, proportional to its own thickness. This is also the
    //     only part of the arm the geometry can isolate from the torso at all
    //     (see the note below on why a separate "upper arm/underarm" region
    //     isn't attempted) so heavy's inflate here is doubled - it's carrying
    //     all of the arm's visible fat gain, not just the forearm's share.
    //
    //     The ramp used to reach full strength just 6cm past the elbow (ax
    //     0.30-0.36), then hold flat the rest of the forearm - a base-mesh-only
    //     render (all influences at 0) has a perfectly smooth elbow, so that
    //     sharp radius increase concentrated right at the joint was entirely
    //     this ramp, and it read as a ball/knob "sticking out" at the elbow
    //     instead of a tapered forearm. Spread the same rise over most of the
    //     forearm's length (ax 0.30-0.44 of the 0.30-0.51 span) instead. ---
    if (ax > 0.3 && ax < 0.51) {
      const [cy, cz] = armAxis(ax);
      const ry = y - cy, rz = z - cz;
      const rd = Math.hypot(ry, rz) || 1e-4;
      const inflate =
        target === "heavy" ? 0.35 : target === "lean" ? -0.13 : target === "muscle" ? 0.26 : 0;
      const ramp = smoothstep(0.30, 0.44, ax); // blend in across the forearm, not a 6cm ring at the elbow
      const amt = rd * inflate * ramp;
      delta[i * 3 + 1] += (ry / rd) * amt;
      delta[i * 3 + 2] += (rz / rd) * amt;
    }
    // NOTE on "underarm"/upper-arm fat: MakeHuman's raw T-pose export doesn't
    // separate the upper arm from the torso by position - at ax < ~0.27 the
    // same |x| band covers ribcage, hip and shoulder vertices all at once, so
    // a region correction there risks catching torso geometry instead of just
    // the arm (exactly the kind of contamination that caused this evening's
    // mesh bugs). ax > 0.3, used above, is the first point the arm is
    // unambiguously alone. Properly isolating the upper arm needs the geometry
    // to know which vertices belong to the arm at all - i.e. a skeleton/rig,
    // not another hand-picked threshold.

    // --- HAND: MakeHuman's only arm slider was "wrist circ", which ballooned
    //     the hand. Pull it back. ---
    if (ax > 0.51) {
      const k = 0.3;
      delta[i * 3] *= k;
      delta[i * 3 + 1] *= k;
      delta[i * 3 + 2] *= k;
    }

    // --- HIPS / THIGHS / GLUTES: the lean export over-thins the lower body
    //     (hips ~4x the whole-body mean) and the muscle export shrinks it too
    //     (no upper-leg-circ push), so dropping body fat at constant weight
    //     collapsed the legs. In the legs muscle replaces fat ~1:1 by volume,
    //     so those two stay heavily damped. Heavy is different: hips/thighs
    //     are a real, common fat-storage site and people need to see that -
    //     barely damped now (k=0.65, was 0.8, was 0.55).
    //
    //     Same "changing bf% alone still looks like a size change" complaint
    //     as the waist, and it turns out this band DOES have a direction to
    //     exploit after all: the glutes (back, z<0) are a real, visible fat-
    //     storage site, but hip WIDTH (the x-component - literally "does this
    //     person look wider standing in front of you") isn't something real
    //     fat gain moves anywhere near as much as this delta was moving it.
    //     For heavy, cut the x/lateral component hard regardless of front or
    //     back, and push what's left of the z-component toward the glutes
    //     (back) instead of the front/pubic area - visible glute growth
    //     mostly reads from the side or back, not as "wider from the front". ---
    if (y > 0.14 && y < 0.98 && ax < 0.25 && Math.hypot(x, z) < 0.34) {
      // muscle export wrongly slims the legs (no upper-leg-circ push) -> null it
      // out; lean export over-thins -> keep a sliver; heavy (leg fat is real) -> mostly through.
      const k = target === "lean" ? 0.15 : target === "muscle" ? 0.05 : 0.65;
      // ease the damper in above the ankle and out into the waist band
      const core = Math.min(smoothstep(0.14, 0.3, y), 1 - smoothstep(0.9, 0.98, y));
      const kk = 1 - core * (1 - k); // = k in the mid-leg, -> 1 (no damp) at the edges
      if (target === "heavy") {
        const back = 1 - smoothstep(-0.05, 0.08, z); // 1 at the glutes, 0 by the front/pubic area
        delta[i * 3] *= kk * 0.4; // hip WIDTH cut hard, front or back
        delta[i * 3 + 1] *= 0.5 + 0.5 * kk;
        delta[i * 3 + 2] *= kk * (0.35 + 0.85 * back); // front: 35% of kk; glutes: up to 120%
      } else {
        delta[i * 3] *= kk;
        delta[i * 3 + 1] *= 0.5 + 0.5 * kk; // keep some vertical shift so proportions hold
        delta[i * 3 + 2] *= kk;
      }
    }
  }
}

// --- parse just the `v` lines of an OBJ -> Float32Array [x,y,z, ...] ---
function readVerts(name) {
  const v = [];
  for (const line of readFileSync(join(MODELS, name), "utf8").split("\n")) {
    if (line[0] === "v" && line[1] === " ") {
      const [, x, y, z] = line.split(/\s+/);
      v.push(+x, +y, +z);
    }
  }
  return v;
}

// --- parse the body faces of the base OBJ (everything before `usemtl Eye_brown`) ---
function readBodyFaces(name) {
  const tris = [];
  let isEye = false;
  for (const line of readFileSync(join(MODELS, name), "utf8").split("\n")) {
    if (line.startsWith("usemtl")) { isEye = line.includes("Eye"); continue; }
    if (line[0] !== "f" || line[1] !== " " || isEye) continue;
    const idx = line
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((tok) => parseInt(tok, 10) - 1); // OBJ is 1-indexed; take the vertex index
    // fan-triangulate (quads and any n-gons)
    for (let k = 1; k < idx.length - 1; k++) tris.push(idx[0], idx[k], idx[k + 1]);
  }
  return tris;
}

function buildSex(sex) {
  const baseAll = readVerts(`${sex}_base.obj`);
  const trisRaw = readBodyFaces(`${sex}_base.obj`);

  // compact: keep only vertices the body actually uses, remap the indices
  const oldToNew = new Map();
  const newToOld = [];
  for (const oi of trisRaw) {
    if (!oldToNew.has(oi)) { oldToNew.set(oi, newToOld.length); newToOld.push(oi); }
  }
  const vc = newToOld.length;
  const tc = trisRaw.length / 3;
  const index = Uint32Array.from(trisRaw, (oi) => oldToNew.get(oi));

  const pick = (all) => {
    const out = new Float32Array(vc * 3);
    for (let n = 0; n < vc; n++) {
      const o = newToOld[n] * 3;
      out[n * 3] = all[o];
      out[n * 3 + 1] = all[o + 1];
      out[n * 3 + 2] = all[o + 2];
    }
    return out;
  };
  const base = pick(baseAll);
  const armAxis = armCentreline(base);
  const delta = (variant) => {
    const p = pick(readVerts(`${sex}_${variant}.obj`));
    const amp = AMP[variant];
    const d = new Float32Array(vc * 3);
    for (let i = 0; i < d.length; i++) d[i] = (p[i] - base[i]) * amp;
    correctDeltas(variant, d, base, armAxis);
    return d;
  };
  const dMuscle = delta("muscle");
  const dHeavy = delta("heavy");
  const dLean = delta("lean");

  // base mesh height (feet already at y=0)
  let baseHeight = 0;
  for (let i = 1; i < base.length; i += 3) baseHeight = Math.max(baseHeight, base[i]);

  // reference BMI: mesh volume (signed tetrahedra) -> litres -> kg at ~1.05
  let vol6 = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    vol6 +=
      base[a] * (base[b + 1] * base[c + 2] - base[b + 2] * base[c + 1]) -
      base[a + 1] * (base[b] * base[c + 2] - base[b + 2] * base[c]) +
      base[a + 2] * (base[b] * base[c + 1] - base[b + 1] * base[c]);
  }
  const litres = (Math.abs(vol6) / 6) * 1000;
  const refBMI = (litres * 1.05) / (baseHeight * baseHeight);

  // per-target girth effect: mean (radial XZ delta) / (radial XZ position),
  // over torso + limb verts (skip head, hands, feet where it's meaningless)
  const linEffect = (d) => {
    let s = 0, n = 0;
    for (let i = 0; i < vc; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      if (y < 0.15 || y > baseHeight - 0.28 || Math.abs(x) > 0.5) continue;
      const r = Math.hypot(x, z);
      if (r < 0.03) continue;
      s += (x * d[i * 3] + z * d[i * 3 + 2]) / (r * r);
      n++;
    }
    return s / n;
  };
  const lin = { muscle: linEffect(dMuscle), heavy: linEffect(dHeavy), lean: linEffect(dLean) };

  // pack (everything is 4-byte aligned)
  const HEADER = 12 + 5 * 4; // magic/vc/tc + baseHeight/refBMI/lin*3
  const floats = base.length + dMuscle.length + dHeavy.length + dLean.length;
  const buf = new ArrayBuffer(HEADER + index.byteLength + floats * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, vc, true);
  dv.setUint32(8, tc, true);
  dv.setFloat32(12, baseHeight, true);
  dv.setFloat32(16, refBMI, true);
  dv.setFloat32(20, lin.muscle, true);
  dv.setFloat32(24, lin.heavy, true);
  dv.setFloat32(28, lin.lean, true);
  let o = HEADER;
  const put = (arr, Ctor) => {
    new Ctor(buf, o, arr.length).set(arr);
    o += arr.length * Ctor.BYTES_PER_ELEMENT;
  };
  put(base, Float32Array);
  put(index, Uint32Array);
  put(dMuscle, Float32Array);
  put(dHeavy, Float32Array);
  put(dLean, Float32Array);

  writeFileSync(join(MODELS, `${sex}.bin`), Buffer.from(buf));
  console.log(
    `${sex}.bin  ${vc}v ${tc}t  h=${baseHeight.toFixed(2)}m  refBMI=${refBMI.toFixed(1)}  ` +
      `girth muscle=${lin.muscle.toFixed(3)} heavy=${lin.heavy.toFixed(3)} lean=${lin.lean.toFixed(3)}`
  );
}

buildSex("male");
buildSex("female");
