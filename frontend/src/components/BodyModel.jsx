import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { clamp01 } from "../lib/bodyParams";
import { inArmBand, cmToRawTarget, useBodySuspense } from "../lib/bodyMesh";

const CLAY = new THREE.MeshStandardMaterial({
  color: "#c78a66",
  roughness: 0.74,
  metalness: 0.0,
});

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
// Fix (see `data.neutralMeasurements`, computed once per mesh in
// lib/bodyMesh.js): measure the ratio against this fixed, morph-independent
// baseline (the UNMORPHED base mesh) instead of the live shape. The ratio
// this produces is then a personal CALIBRATION CONSTANT - "this person's
// waist runs 8% bigger than the generic estimate" - which stays valid at
// every fat/muscle/weight combination and gets applied on top of whatever
// the live auto-estimate naturally does, so the region still grows and
// shrinks with the sliders, just consistently offset by how this real body
// actually differs.
// Raised-cosine half-width around each landmark: 1 at the landmark, smoothly
// down to 0 at +-SPREAD, no flat plateau at all - so nearby geometry always
// moves at least a little in sympathy instead of only the touched region
// changing while its neighbour a few cm away stays exactly as auto-estimated.
// Widened hard from v1's 3cm edge-only blend on a fixed band, which is what
// produced the "pasted on" look - real torsos taper into a waist or chest
// over a good double-digit span of cm, not three.
const REGION_SPREAD = { shoulder: 0.11, chest: 0.14, waist: 0.14, hip: 0.14, arm: 0.09 };
const hillWeight = (y, y0, spread) => {
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
function blendWithMeasurements(pos, data, infMuscle, infHeavy, infLean, measurements, frameScale) {
  const { base, dMuscle, dHeavy, dLean, landmarks, neutralMeasurements, regions, scale } = data;
  for (let j = 0; j < base.length; j++) {
    pos[j] = base[j] + infMuscle * dMuscle[j] + infHeavy * dHeavy[j] + infLean * dLean[j];
  }

  // 1) the ratio for each measured region is calibrated against the FIXED
  //    neutral baseline (see computeNeutralMeasurements), not the live blend
  //    - that's what keeps it from fighting the body-fat slider. `local`
  //    regions (the arm) still need their per-side CENTRE from the live,
  //    current blend though: that's just "where is the arm right now", which
  //    genuinely does shift a little as muscle/fat change, and scaling around
  //    a stale centre would offset the arm sideways instead of thickening it.
  const ratios = [];
  for (const key of Object.keys(regions)) {
    const cm = measurements[key];
    if (cm == null || !Number.isFinite(cm) || cm <= 0) continue;
    const region = regions[key];
    const { maxAx, minAx = 0, bandHalf, local } = region;
    const y0 = landmarks[key];
    if (neutralMeasurements[key] == null) continue; // no vertices at this landmark
    const neutralReal = neutralMeasurements[key] * frameScale;
    if (neutralReal < 0.01) continue; // guard a degenerate slice

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
    ratios.push({ region, y0, spread: REGION_SPREAD[key] * scale, ratio: clampRatio(target / neutralReal), centres });
  }
  if (ratios.length === 0) return;

  // 2) apply every region's ratio together in one pass.
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let sx = x, sz = z;
    for (const { region, y0, spread, ratio, centres } of ratios) {
      const { mode, maxAx, local } = region;
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
        if (maxAx != null && Math.abs(x) > maxAx) continue;
        const s = 1 + w * (ratio - 1);
        sx *= s;
        if (mode !== "width") sz *= s;
      }
    }
    pos[i] = sx;
    pos[i + 2] = sz;
  }
}

/**
 * The MakeHuman body for `sex`, morphed and scaled from `shape`:
 *   { muscle, fat, bmi, heightM }
 * The three morph targets change SHAPE; a physics-derived FRAME scale (from
 * weight/height only - not composition at all) sets overall SIZE, standing
 * in for the skeleton: shoulder breadth and the rest of the frame track real
 * mass and height, the same way bone structure would, and don't get pulled
 * around by how much of that mass is muscle vs fat. The morphs' own regional
 * amplitude is damped at the source (build-bodies.mjs) so a big composition
 * swing reads as "this body's shape changed" rather than "this got bigger" -
 * unlike an earlier version, the frame scale is NOT divided by the morphs'
 * average girth effect, because compensating a LOCAL bulge (e.g. the belly)
 * with a GLOBAL shrink dragged the frame down with it too.
 *
 * frameScale used to also fold in a density term (fat is ~less dense than
 * lean tissue, so "same weight, more fat" is technically a hair more volume)
 * - dropped it. It was only ever a ~4% swing across the whole body-fat range,
 * but the user's complaint was specifically "dragging the body-fat slider
 * alone, without touching weight, changes the SIZE of the person" - and this
 * term was a second, independent way for that to happen even after the
 * correctDeltas rebalance below made the *shape* changes track weight-neutral
 * composition instead of overall size. Simpler and stricter: at constant
 * weight and height, frameScale is now EXACTLY constant, full stop - 100% of
 * any body-fat-driven visual change is now the morphs' job, none of it is the
 * frame's.
 */
export default function BodyModel({ sex = "male", shape }) {
  const data = useBodySuspense(sex === "female" ? "female" : "male");

  const mesh = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.base.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.morphAttributes.position = [
      new THREE.BufferAttribute(data.dMuscle, 3), // 0
      new THREE.BufferAttribute(data.dHeavy, 3),  // 1
      new THREE.BufferAttribute(data.dLean, 3),   // 2
    ];
    g.morphTargetsRelative = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    const c = new THREE.Vector3();
    g.boundingBox.getCenter(c);
    const offset = { x: -c.x, y: -g.boundingBox.min.y, z: -c.z };
    g.translate(offset.x, offset.y, offset.z);

    const m = new THREE.Mesh(g, CLAY);
    m.castShadow = true;
    m.receiveShadow = true;
    // the measurement-override path re-derives position from data.base fresh
    // each time (see the effect below) rather than working off the already-
    // translated geometry, so it needs this same recentring offset to match.
    m.userData.centerOffset = offset;
    return m;
  }, [data]);

  // Swapping sex builds a whole new geometry (~640KB of vertex + morph buffers)
  // and useMemo simply drops the old reference - but its GPU-side buffers are
  // not reachable by the garbage collector, so every toggle leaked one mesh's
  // worth of VRAM. CLAY is module-level and shared, so it must NOT be disposed
  // here; only the per-mesh geometry is ours to free.
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);

  useEffect(() => {
    const { muscle = 0.5, fat = 0.5, bmi = data.refBMI, heightM = data.baseHeight, measurements } = shape || {};
    const infMuscle = clamp01(muscle);
    const infHeavy = Math.max(0, fat * 2 - 1); // heavy
    const infLean = Math.max(0, 1 - fat * 2); // lean

    // --- size: the FRAME only, from weight/height - a stand-in for skeletal
    //     scale, deliberately independent of the morphs' own shape change and
    //     of body-fat % entirely (see the class doc above). XZ matches the
    //     real cross-section area (mass / height); Y matches height. ---
    const frameScale = Math.sqrt((bmi / data.refBMI) * (heightM / data.baseHeight));
    const heightScale = heightM / data.baseHeight;

    const hasMeasurements =
      measurements && Object.values(measurements).some((v) => v != null && v !== "");

    if (hasMeasurements) {
      // --- measurement-override path: blend on the CPU so per-region size
      //     corrections can be layered on top of the muscle/fat morph before
      //     the frame scale applies (see blendWithMeasurements' doc comment).
      //     Recentres from data.base fresh every time, so it doesn't matter
      //     what the position buffer held before. ---
      mesh.morphTargetInfluences[0] = 0;
      mesh.morphTargetInfluences[1] = 0;
      mesh.morphTargetInfluences[2] = 0;
      const posAttr = mesh.geometry.attributes.position;
      blendWithMeasurements(posAttr.array, data, infMuscle, infHeavy, infLean, measurements, frameScale);
      const off = mesh.userData.centerOffset;
      for (let i = 0; i < posAttr.array.length; i += 3) {
        posAttr.array[i] += off.x;
        posAttr.array[i + 1] += off.y;
        posAttr.array[i + 2] += off.z;
      }
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.userData.measurementOverrideActive = true;
    } else {
      if (mesh.userData.measurementOverrideActive) {
        // undo a previous render's CPU blend - GPU morphing below expects
        // `position` to be the plain recentred base, nothing baked into it.
        const posAttr = mesh.geometry.attributes.position;
        posAttr.array.set(data.base);
        const off = mesh.userData.centerOffset;
        for (let i = 0; i < posAttr.array.length; i += 3) {
          posAttr.array[i] += off.x;
          posAttr.array[i + 1] += off.y;
          posAttr.array[i + 2] += off.z;
        }
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.userData.measurementOverrideActive = false;
      }
      // --- fast path: GPU morph targets, unchanged from before this feature -
      //     the common case (every ordinary slider drag or timeline scrub)
      //     stays exactly as cheap as it was. ---
      const inf = mesh.morphTargetInfluences;
      inf[0] = infMuscle;
      inf[1] = infHeavy;
      inf[2] = infLean;
    }

    mesh.scale.set(frameScale, heightScale, frameScale);
  }, [mesh, data, shape]);

  return <primitive object={mesh} />;
}
