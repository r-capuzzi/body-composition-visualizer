// The measurement-override math behind BodyModel: blend the morphs, then
// reshape whichever regions have a real tape measurement so the mesh hits
// it. Pure functions on flat position arrays - kept out of the component so
// it can be tested against the real meshes without a WebGL context.

import { inArmBand, cmToRawTarget, sliceMeasure, measureRegions, blendPositions } from "./bodyMesh";

// Each region's ratio (see blendWithMeasurements) used to be computed against
// the CURRENTLY MORPHED size, live, every render - a measurement "calibrated"
// the body at whatever fat/muscle the slider happened to be at that instant.
// That fights the body-fat slider: heavy already grows the waist a lot on its
// own (see the size-vs-composition work above), so past some fat%, the LIVE
// auto-estimate outgrows the user's fixed cm target, and the override starts
// SHRINKING the waist back down to hit that fixed number even as the (not
// overridden) hip keeps growing freely next to it - a wasp-waist pinch that
// gets worse the further the slider moves. A real tape measurement describes
// one person at one moment, not an invariant that holds at every body fat %.
// The ratio is now a personal CALIBRATION CONSTANT - "this person's waist
// runs 8% bigger than the generic estimate" - measured once against a fixed
// basis and applied on top of whatever the live estimate does, so the region
// still grows and shrinks along a projection, consistently offset by how this
// real body differs. The basis was first the unmorphed base mesh, which
// fixed the pinch but never rendered what was typed; it's now the model's
// estimate for the body the user described (see blendWithMeasurements).
// Raised-cosine half-width around each landmark: 1 at the landmark, smoothly
// down to 0 at +-SPREAD, no flat plateau at all - so nearby geometry always
// moves at least a little in sympathy instead of only the touched region
// changing while its neighbour a few cm away stays exactly as auto-estimated.
// Widened hard from v1's 3cm edge-only blend on a fixed band, which is what
// produced the "pasted on" look - real torsos taper into a waist or chest
// over a good double-digit span of cm, not three.
// The waist's is [below, above]: a symmetric 0.14 stopped well short of the
// ribs, so a bigger-than-estimated waist read as an inner tube with a crease
// above it. Measured on the heavy morph (slice girth gain around the waist
// landmark, normalised to 1 there), fat reaches half strength 0.075 below
// the waist, same as before, but 0.155 above and zero by ~0.22 - abdominal
// fat runs up under the ribs. A 0.30 raised cosine above fits those samples
// to within ~0.03.
const REGION_SPREAD = { chest: 0.14, waist: [0.14, 0.3], hip: 0.14, arm: 0.09 };
const hillWeight = (y, y0, [below, above]) => {
  const spread = y < y0 ? below : above;
  const d = Math.abs(y - y0);
  return d >= spread ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / spread));
};

// A `local` region (the arm) fades out RADIALLY from the limb's own axis, not
// along |x|. The earlier version widened the arm's |x| band by REGION_SPREAD -
// but that is a Y-axis taper width, and reusing it on X reached deep into the
// torso: 366 of the 700 vertices it touched sat inside the arm's own minimum
// |x|, i.e. chest/shoulder, not arm. Worse, scaling about the arm's centre
// displaces a vertex in proportion to its DISTANCE from that centre, so those
// torso vertices moved further than the arm did - a 10% bigger bicep shifted
// 0.7cm of arm but 1.7cm of chest. Distance from the limb axis is the honest
// measure of "is this part of the arm": measured on the base mesh, arm-surface
// vertices sit within 0.076 of it while torso vertices run 0.17 out, so full
// strength to 0.065 covers the limb and the taper reaches zero well short of
// the torso (armpit geometry in between blends, which is what it should do).
// These, REGION_SPREAD above, and the region bands were all measured on the
// male mesh, so every use below multiplies by `data.scale` (1 for male; see
// MALE_REFERENCE_HEIGHT in lib/bodyMesh.js for why that matters).
const ARM_RADIAL_FULL = 0.065;
const ARM_RADIAL_ZERO = 0.115;
const radialWeight = (r, scale) => {
  const full = ARM_RADIAL_FULL * scale, zero = ARM_RADIAL_ZERO * scale;
  if (r <= full) return 1;
  if (r >= zero) return 0;
  const t = (r - full) / (zero - full);
  return 0.5 * (1 + Math.cos(Math.PI * t));
};
// Torso regions stop at |x| = maxAx, but a hard cut there scaled one side of
// a triangle and not the other: a bigger chest grew a breastplate with a
// seam down each side. Fade out over MAX_AX_FADE past maxAx instead - full
// strength inside maxAx, so the measured slice (which stops at maxAx) still
// hits its target. It was 0.03, just the gap at chest height between the
// torso's edge (0.165) and the arm's inner edge (0.222), but a SMALLER chest
// then pulled the torso side in ~2cm while the arm stayed put, and that gap
// stretched the armpit's edges 1.6x inside the 3cm band. 0.07 reaches the
// arm's inner edge at a low weight, so it moves a little with the chest
// (continuously), and the worst stretch drops to ~1.3x.
const MAX_AX_FADE = 0.07;
const edgeFade = (ax, maxAx, scale) => {
  const d = ax - maxAx, band = MAX_AX_FADE * scale;
  if (d <= 0) return 1;
  if (d >= band) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / band));
};

// Broader shoulders put the arms farther apart, so a shoulder-width override
// moves each arm sideways whole, rather than stretching the torso's x inside
// a cap (which never moved the arms: 40cm and 52cm rendered the same, and a
// big value pushed the torso edge out past the arm into a shelf). Arm
// vertices below the armpit (outside segmentTorso's torso) move fully; above
// the armpit, the traps and deltoid ramp from none at the neck to full at the
// shoulder joint, over |x| in SHOULDER_RAMP; and the torso's flanks follow
// down to SHOULDER_FLANK below the armpit. The ramp is 1 wherever arm meets
// torso at the armpit, so the two sides of that seam always move together.
const SHOULDER_RAMP = [0.08, 0.2];
const SHOULDER_FLANK = 0.12;
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// ...except the inner arm reaches the armpit at |x| 0.154 on the female mesh,
// inside the ramp, so it can't just jump to 1 below the armpit (that
// stretched one armpit edge 1.8x); it goes from the ramp's value at the
// armpit to 1 over SHOULDER_ARM_BLEND.
const SHOULDER_ARM_BLEND = 0.06;
// Every input is base-mesh position, so the weight is one smooth field over
// the surface whatever the morphs do - it can't open a seam.
function shoulderWeight(data, i) {
  const { scale, armpit, torso, base } = data;
  const xb = Math.abs(base[i]), yb = base[i + 1];
  const ramp = smooth01((xb - SHOULDER_RAMP[0] * scale) / ((SHOULDER_RAMP[1] - SHOULDER_RAMP[0]) * scale));
  if (yb >= armpit) return ramp;
  const below = armpit - yb;
  if (!torso[i / 3]) return ramp + (1 - ramp) * smooth01(below / (SHOULDER_ARM_BLEND * scale));
  return ramp * smooth01(1 - below / (SHOULDER_FLANK * scale));
}

// The morph influences for a body-params shape ({muscle, fat}) - the same
// split BodyModel renders with.
export const influences = ({ muscle = 0.5, fat = 0.5 } = {}) => ({
  infMuscle: Math.max(0, Math.min(1, muscle)),
  infHeavy: Math.max(0, fat * 2 - 1),
  infLean: Math.max(0, 1 - fat * 2),
});
export const frameScales = (data, { bmi = data.refBMI, heightM = data.baseHeight } = {}) => ({
  frameScale: Math.sqrt((bmi / data.refBMI) * (heightM / data.baseHeight)),
  heightScale: heightM / data.baseHeight,
});

// Every region's model estimate in real metres (raw x its width factor) for
// blended positions `pos` - what a tape measurement is calibrated against.
function estimateReal(data, pos, frameScale, heightScale) {
  const raw = measureRegions(pos, data.index, data.landmarks, data.regions, data.part);
  const out = {};
  for (const k of Object.keys(raw)) {
    out[k] = raw[k] == null ? null : raw[k] * regionFrameScale(data, k, frameScale, heightScale);
  }
  return out;
}

// The calibration basis for a described body (the projection's start):
// see blendWithMeasurements.
export function calibrationBasis(data, shape) {
  const { infMuscle, infHeavy, infLean } = influences(shape);
  const { frameScale, heightScale } = frameScales(data, shape);
  return estimateReal(data, blendPositions(data, infMuscle, infHeavy, infLean), frameScale, heightScale);
}

// however far off a bad measurement would otherwise push the ratio, don't let
// a single region collapse or balloon past this - typos shouldn't wreck the mesh
const clampRatio = (r) => Math.max(0.6, Math.min(1.6, r));

/**
 * Blend `base + Σ influence*delta` into `pos` (both flat [x,y,z,...] arrays),
 * then re-scale whichever regions have a `measurements[key]` (cm) override to
 * actually hit that real-world size, given the frame scale that's about to be
 * applied on top. Runs entirely on the CPU (not GPU morph targets) because
 * each region's correction has to know the blended-but-not-yet-measurement-
 * adjusted size first - something a shader can't feed back into itself.
 */
export function blendWithMeasurements(pos, data, infMuscle, infHeavy, infLean, measurements, frameScale, heightScale = 1, basis = null) {
  const { base, dMuscle, dHeavy, dLean, landmarks, regions, scale } = data;
  for (let j = 0; j < base.length; j++) {
    pos[j] = base[j] + infMuscle * dMuscle[j] + infHeavy * dHeavy[j] + infLean * dLean[j];
  }
  // no basis given: the typed numbers describe this very body
  if (!basis) basis = estimateReal(data, pos, frameScale, heightScale);

  // 1) the ratio for each measured region is calibrated against `basis` - the
  //    model's estimate for the body the user DESCRIBED (the projection's
  //    start), not the live blend and not the neutral mesh. The neutral mesh
  //    was the previous basis, and it broke both ends: at 110kg/32% a typed
  //    110cm waist rendered 128 (the heavy morph's growth stacked on a ratio
  //    already fitted to the unmorphed mesh), echoing back the "current
  //    measurements" estimate reshaped the body, and the ratio divided out
  //    this week's frame, so an overridden chest held 128cm through a 22kg
  //    cut. Against the start, what was typed renders at the start, and later
  //    weeks carry the same personal offset on the model's own change.
  //    `local` regions (the arm) still need their per-side CENTRE from the
  //    live, current blend though: that's just "where is the arm right now",
  //    which genuinely does shift a little as muscle/fat change, and scaling
  //    around a stale centre would offset the arm sideways instead of
  //    thickening it.
  const ratios = [];
  let shoulderShift = 0;
  for (const key of Object.keys(regions)) {
    const cm = measurements[key];
    if (cm == null || !Number.isFinite(cm) || cm <= 0) continue;
    const region = regions[key];
    const { maxAx, minAx = 0, bandHalf, local } = region;
    const y0 = landmarks[key];
    const basisReal = basis[key];
    if (basisReal == null || basisReal < 0.01) continue; // no vertices at this landmark / degenerate slice

    let centres;
    if (local) {
      // average both sides' own local centre, rather than the global origin,
      // so the arm doesn't get yanked toward x=0 - it's centred around
      // x=+-0.23, not 0 (verified this band is arm-only, not arm+chest
      // bleed, by listing every vertex in it and checking z formed one
      // continuous ring instead of two separated clusters).
      const yLo = y0 - bandHalf, yHi = y0 + bandHalf;
      centres = [1, -1].map((sign) => {
        let n = 0, cx = 0, cz = 0;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          if (y < yLo || y > yHi || !inArmBand(x, minAx, maxAx, sign)) continue;
          n++; cx += x; cz += z;
        }
        return n ? { x: cx / n, z: cz / n } : null;
      });
      if (centres.every((c) => !c)) continue;
    }
    const target = cmToRawTarget(key, cm);
    if (region.mode === "width") {
      // same calibration as every other region, applied to the live width
      const live = sliceMeasure(pos, data.index, y0).maxAbsX;
      shoulderShift = (clampRatio(target / basisReal) - 1) * live;
      continue;
    }
    const spread = [REGION_SPREAD[key]].flat();
    let above = (spread[1] ?? spread[0]) * scale;
    // a torso-only region can only tell torso from arm below the armpit (see
    // segmentTorso), so its taper must be finished by then
    if (region.torsoOnly) above = Math.min(above, data.armpit - y0);
    ratios.push({ region, y0, spread: [spread[0] * scale, above], ratio: clampRatio(target / basisReal), centres });
  }
  if (ratios.length === 0 && shoulderShift === 0) return;

  // 2) apply every region's ratio together in one pass.
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let sx = x, sz = z;
    if (shoulderShift) sx += Math.sign(base[i]) * shoulderShift * shoulderWeight(data, i);
    for (const { region, y0, spread, ratio, centres } of ratios) {
      const { mode, maxAx, local, torsoOnly } = region;
      if (torsoOnly && !data.torso[i / 3]) continue;
      const w = hillWeight(y, y0, spread);
      if (w <= 0) continue;
      if (local) {
        const c = centres[x >= 0 ? 0 : 1];
        if (!c) continue;
        const rw = radialWeight(Math.hypot(sx - c.x, sz - c.z), scale);
        if (rw <= 0) continue;
        const s = 1 + w * rw * (ratio - 1);
        sx = c.x + (sx - c.x) * s;
        sz = c.z + (sz - c.z) * s;
      } else {
        // base-mesh |x|, like shoulderWeight: a muscular or heavy blend can
        // push the torso's own side past maxAx, and it must still get the
        // full ratio (it's part of the measured ring)
        const fx = maxAx == null ? 1 : edgeFade(Math.abs(base[i]), maxAx, scale);
        if (fx <= 0) continue;
        const s = 1 + w * fx * (ratio - 1);
        sx *= s;
        if (mode !== "width") sz *= s;
      }
    }
    pos[i] = sx;
    pos[i + 2] = sz;
  }
}
// How much of the body's width factor the head, hands and feet take, as an
// exponent: 1 is the old behaviour (a 240kg head 88% wider than it should
// be - flattened and jowly), 0 is none (a pinhead on a cone of neck). Renders
// at 0/0.2/0.35/0.5/1 on the 240kg body: 0.35-0.5 read naturally, and 0.5
// keeps the facial fat a body that heavy genuinely carries. Measured data
// bounds it for hands too: in an obese cohort (BMI 31-87, Wiggermann et al.
// 2019, Human Factors, "Anthropometric Dimensions of Individuals With High
// Body Mass Index"),
// men's weight spans 97-213kg (5th-95th pct, 2.2x) while hand breadth spans
// only 83-101mm (1.22x) and head breadth 150-171mm (1.14x) - at most
// weight^0.25 for the hand even before stature's share of that spread, where
// the frame goes as weight^0.5. Near normal weight frameScale ~1, so
// ordinary bodies barely change.
const EXTREMITY_WIDTH_EXPONENT = 0.5;
const EXT_GROUPS = 6; // 0 = body, then EXT_HEAD..EXT_FOOT_L from bodyMesh

// Weight widens the abdomen faster than the rest of the body. A single frame
// scale (width ~ sqrt(mass/height)) put the cohort-average obese man
// (Wiggermann et al. 2019: 175.5cm, 144.8kg, BMI 47) at the right waist
// (138 vs 139cm) but chest 154 vs 135, hips 148 vs 134, shoulders +15%; the
// cohort woman the same (waist +4%, chest/hips/shoulders +10%). His mesh also
// held ~166L where 144.8kg at ~42% fat is ~144L. Fitting the non-abdominal
// width to the cohort's chest, hips and shoulders gives an exponent of
// 0.62-0.79 on the frame (mean 0.72); the abdomen keeps 1. Still weight and
// height only - composition never sets size - and at the base mesh's own
// BMI every factor is 1, so ordinary bodies are unchanged.
const BODY_WIDTH_EXPONENT = 0.72;
export const widthScale = (frameScale, heightScale, abdomen) =>
  heightScale * Math.pow(frameScale / heightScale, BODY_WIDTH_EXPONENT + (1 - BODY_WIDTH_EXPONENT) * abdomen);

// The width factor at a measurement region's landmark, for turning a raw
// mesh measurement into real cm (and back) - the arm and shoulder are never
// abdomen, the torso rings take their ring's mean abdomen width weight.
export function regionFrameScale(data, key, frameScale, heightScale) {
  return widthScale(frameScale, heightScale, data.ringAbdomen[key] ?? 0);
}

/**
 * Bake the frame's width scale into `p` (the blended body, mesh units, before
 * recentring by `off`), and recentre it; height is left to mesh.scale.y.
 * Width is baked in per vertex rather than set on mesh.scale, because the
 * head, hands and feet must not take the body's full width factor: that
 * tracks mass, and bony extremities change far less with weight than a
 * torso. Applied uniformly, a 240kg body (frameScale 1.88) got a head 88%
 * wider but no taller, and a BMI-45 body paddle hands and splayed feet.
 * Each extremity scales about its joint by a damped factor (see
 * EXTREMITY_WIDTH_EXPONENT), blended in over the neck / wrist / ankle so
 * there's no seam. Joints come from the live shape, not the base mesh:
 * the morphs and a shoulder override both move the hands, and a stale
 * centre would leave a hand behind its own arm.
 */
export function applyFrame(p, data, frameScale, heightScale, off) {
  const { group, weight } = data.extremities;
  const cx = new Float64Array(EXT_GROUPS), cz = new Float64Array(EXT_GROUPS), cn = new Float64Array(EXT_GROUPS);
  // about the JOINT - the neck / wrist / ankle ring inside the blend - not
  // the extremity's own centroid: the hand's centroid sits ~8cm past the
  // wrist, so scaling about it pulled the whole hand back toward mid-palm
  // and the blend had to stretch the wrist ~2x to close the gap.
  for (let v = 0; v < group.length; v++) {
    const g = group[v];
    if (!g || weight[v] <= 0 || weight[v] >= 1) continue;
    cx[g] += p[v * 3]; cz[g] += p[v * 3 + 2]; cn[g]++;
  }
  for (let g = 1; g < EXT_GROUPS; g++) if (cn[g]) { cx[g] = cx[g] / cn[g] + off.x; cz[g] = cz[g] / cn[g] + off.z; }
  const extScale = heightScale * Math.pow(frameScale / heightScale, EXTREMITY_WIDTH_EXPONENT);
  // the body's width factor away from the abdomen (the neck, wrists and
  // ankles are all out there, so the joints take it too) - see widthScale
  const bodyScale = widthScale(frameScale, heightScale, 0);
  const abdomen = data.abdomenWidth;
  for (let i = 0; i < p.length; i += 3) {
    const yRaw = p[i + 1];
    const x = p[i] + off.x, z = p[i + 2] + off.z;
    const a = abdomen[i / 3];
    const s = a > 0 ? widthScale(frameScale, heightScale, a) : bodyScale;
    let bx = x * s, bz = z * s;
    const g = group[i / 3], w = weight[i / 3];
    if (g && w > 0 && cn[g]) {
      bx += w * (cx[g] * bodyScale + (x - cx[g]) * extScale - bx);
      bz += w * (cz[g] * bodyScale + (z - cz[g]) * extScale - bz);
    }
    p[i] = bx;
    p[i + 1] = yRaw + off.y;
    p[i + 2] = bz;
  }
}
