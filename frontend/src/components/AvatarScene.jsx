import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";

import BodyModel from "./BodyModel";

/**
 * The 3D viewport. <Canvas> sets up a Three.js renderer, scene and camera and
 * runs a render loop; everything inside it is scene content, not DOM.
 */
export default function AvatarScene({ sex, shape }) {
  return (
    <div className="avatar-scene">
      <Canvas camera={{ position: [0, 0.95, 3.4], fov: 40 }} dpr={[1, 2]} shadows>
        <color attach="background" args={["#14161c"]} />

        <ambientLight intensity={0.75} />
        <directionalLight
          position={[3, 6, 4]}
          intensity={1.9}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} />

        <Suspense fallback={null}>
          <BodyModel sex={sex} shape={shape} />
        </Suspense>

        <ContactShadows
          position={[0, 0.0, 0]}
          opacity={0.55}
          scale={2.6}
          blur={2.2}
          far={1.4}
        />

        {/* face-front by default; drag to rotate but not all the way to the back */}
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 3.4}
          maxPolarAngle={Math.PI / 2.05}
          minAzimuthAngle={-Math.PI * 0.6}
          maxAzimuthAngle={Math.PI * 0.6}
          target={[0, 0.92, 0]}
        />
      </Canvas>
    </div>
  );
}
