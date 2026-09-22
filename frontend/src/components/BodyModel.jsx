import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { clamp01 } from "../lib/bodyParams";
import { useBodySuspense } from "../lib/bodyMesh";
import { applyFrame, blendWithMeasurements } from "../lib/bodyShape";

const CLAY = new THREE.MeshStandardMaterial({
  color: "#c78a66",
  roughness: 0.74,
  metalness: 0.0,
});

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
    g.computeVertexNormals();
    g.computeBoundingBox();
    const c = new THREE.Vector3();
    g.boundingBox.getCenter(c);
    const offset = { x: -c.x, y: -g.boundingBox.min.y, z: -c.z };
    g.translate(offset.x, offset.y, offset.z);

    const m = new THREE.Mesh(g, CLAY);
    m.castShadow = true;
    m.receiveShadow = true;
    // the effect below re-derives position from data.base fresh each time
    // rather than working off the already-translated geometry, so it needs
    // this same recentring offset to match.
    m.userData.centerOffset = offset;
    return m;
  }, [data]);

  // Swapping sex builds a whole new geometry (~640KB of vertex + morph buffers)
  // and useMemo simply drops the old reference - but its GPU-side buffers are
  // not reachable by the garbage collector, so every toggle leaked one mesh's
  // worth of VRAM. CLAY is module-level and shared, so it must NOT be disposed
  // here; only the per-mesh geometry is ours to free.
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);

  // `shape` is a new object on every parent render (scrubbing re-renders ~8x a
  // second) - key the reshape on its VALUES so an unchanged body isn't rebuilt.
  const shapeKey = JSON.stringify(shape || {});

  useEffect(() => {
    const { muscle = 0.5, fat = 0.5, bmi = data.refBMI, heightM = data.baseHeight, measurements = {} } = shape || {};
    const infMuscle = clamp01(muscle);
    const infHeavy = Math.max(0, fat * 2 - 1); // heavy
    const infLean = Math.max(0, 1 - fat * 2); // lean

    // --- size: the FRAME only, from weight/height - a stand-in for skeletal
    //     scale, deliberately independent of the morphs' own shape change and
    //     of body-fat % entirely (see the class doc above). XZ matches the
    //     real cross-section area (mass / height); Y matches height. ---
    const frameScale = Math.sqrt((bmi / data.refBMI) * (heightM / data.baseHeight));
    const heightScale = heightM / data.baseHeight;

    // One path for every body: blend the morphs on the CPU (plus any
    // measurement overrides - see blendWithMeasurements), then compute
    // normals from the ACTUAL shape. This used to be GPU morph targets, which
    // lit every morphed body with the unmorphed mesh's normals (blocky
    // shoulders, a hard line under the belly on heavy figures); GPU-blended
    // morph normals fixed most of that but a linear blend of normals is only
    // approximate - on a heavy muscular build 126 vertices were off by >15deg
    // (worst 70deg), enough to paint a bright streak across the shoulder.
    // Exact normals cost ~3ms per shape change on desktop, and the shape only
    // changes on input or a timeline step, not every frame.
    const posAttr = mesh.geometry.attributes.position;
    const p = posAttr.array;
    blendWithMeasurements(p, data, infMuscle, infHeavy, infLean, measurements, frameScale);
    // width per vertex, so the head, hands and feet keep bony proportions
    applyFrame(p, data, frameScale, heightScale, mesh.userData.centerOffset);
    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere(); // positions now carry the size

    mesh.scale.set(1, heightScale, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shapeKey stands in for shape
  }, [mesh, data, shapeKey]);

  return <primitive object={mesh} />;
}
