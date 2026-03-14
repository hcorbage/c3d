import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Line } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const PLATE  = 130;
const THICK  = 3;
const TARGET = 80;
const TICK   = 9;
const FRAME_Y = 0.25;
const H      = PLATE / 2;

interface StlViewerProps {
  fileUrl: string | null;
  wireframe?: boolean;
  label?: string;
  labelColor?: "blue" | "green";
}

function Model({
  url,
  wireframe,
  color,
  onCenterY,
}: {
  url: string;
  wireframe: boolean;
  color: string;
  onCenterY: (y: number) => void;
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  const [sc,  setSc]  = useState(1);

  useEffect(() => {
    setGeo(null);
    const loader = new STLLoader();
    loader.load(
      url,
      (g) => {
        g.computeVertexNormals();
        g.computeBoundingBox();
        const b  = g.boundingBox!;
        const sz = new THREE.Vector3();
        b.getSize(sz);
        const s = TARGET / Math.max(sz.x, sz.y, sz.z, 0.001);
        const px = -(b.min.x + sz.x / 2) * s;
        const py = -b.min.y * s;
        const pz = -(b.min.z + sz.z / 2) * s;
        setPos([px, py, pz]);
        setSc(s);
        setGeo(g);
        onCenterY(py + (sz.y * s) / 2);
      },
      undefined,
      console.error,
    );
  }, [url]);

  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0.3,
        roughness: 0.45,
        wireframe,
      }),
    [color, wireframe],
  );

  if (!geo) return null;

  return (
    <mesh
      geometry={geo}
      material={mat}
      position={pos}
      scale={sc}
      castShadow
      receiveShadow
    />
  );
}

function BuildPlate() {
  const corners: Array<[[number,number,number],[number,number,number]]> = [
    [[-H, FRAME_Y, -H], [-H + TICK, FRAME_Y, -H]],
    [[-H, FRAME_Y, -H], [-H,        FRAME_Y, -H + TICK]],
    [[ H, FRAME_Y, -H], [ H - TICK, FRAME_Y, -H]],
    [[ H, FRAME_Y, -H], [ H,        FRAME_Y, -H + TICK]],
    [[-H, FRAME_Y,  H], [-H + TICK, FRAME_Y,  H]],
    [[-H, FRAME_Y,  H], [-H,        FRAME_Y,  H - TICK]],
    [[ H, FRAME_Y,  H], [ H - TICK, FRAME_Y,  H]],
    [[ H, FRAME_Y,  H], [ H,        FRAME_Y,  H - TICK]],
  ];

  const framePoints: [number,number,number][] = [
    [-H, FRAME_Y, -H],
    [ H, FRAME_Y, -H],
    [ H, FRAME_Y,  H],
    [-H, FRAME_Y,  H],
    [-H, FRAME_Y, -H],
  ];

  return (
    <group>
      {/* Physical slab */}
      <mesh position={[0, -THICK / 2, 0]} receiveShadow>
        <boxGeometry args={[PLATE, THICK, PLATE]} />
        <meshStandardMaterial color="#18181b" metalness={0.2} roughness={0.92} />
      </mesh>

      {/* Top surface — slightly lighter PEI texture feel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[PLATE, PLATE]} />
        <meshStandardMaterial color="#202025" metalness={0.05} roughness={0.98} />
      </mesh>

      {/* Fine grid lines */}
      <gridHelper
        args={[PLATE, Math.round(PLATE / 5), "#2b2b30", "#242428"]}
        position={[0, 0.06, 0]}
      />

      {/* Dim outer border */}
      <Line points={framePoints} color="#1e5570" lineWidth={1} />

      {/* BambuLab-style corner L-marks */}
      {corners.map((pts, i) => (
        <Line key={i} points={pts} color="#00a0e9" lineWidth={2} />
      ))}

      {/* Centre crosshair */}
      <Line
        points={[[-6, FRAME_Y, 0], [6, FRAME_Y, 0]]}
        color="#00a0e9"
        lineWidth={1}
      />
      <Line
        points={[[0, FRAME_Y, -6], [0, FRAME_Y, 6]]}
        color="#00a0e9"
        lineWidth={1}
      />
    </group>
  );
}

export function StlViewer({
  fileUrl,
  wireframe = false,
  label,
  labelColor = "blue",
}: StlViewerProps) {
  const modelColor = labelColor === "green" ? "#22c55e" : "#3b82f6";
  const labelBg =
    labelColor === "green"
      ? "bg-green-500/20 border-green-500/40 text-green-300"
      : "bg-blue-500/20 border-blue-500/40 text-blue-300";

  const [targetY, setTargetY] = useState(25);
  const controlsRef = useRef<any>(null);

  const handleCenterY = (cy: number) => {
    setTargetY(cy);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, cy, 0);
      controlsRef.current.update();
    }
  };

  if (!fileUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50 border-2 border-dashed border-border rounded-xl">
        <div className="w-16 h-16 mb-4 rounded-full border-4 border-dashed border-muted flex items-center justify-center animate-[spin_10s_linear_infinite]">
          <div className="w-2 h-2 bg-muted rounded-full" />
        </div>
        <p className="font-display font-medium text-lg">No Model Loaded</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative rounded-xl overflow-hidden bg-[#0e0e11]">
      {label && (
        <div
          className={`absolute top-3 left-3 z-10 px-3 py-1 rounded-full text-xs font-semibold border backdrop-blur-sm ${labelBg}`}
        >
          {label}
        </div>
      )}

      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [110, 85, 110], fov: 40, near: 0.1, far: 8000 }}
      >
        <color attach="background" args={["#0e0e11"]} />
        <fog attach="fog" args={["#0e0e11", 450, 900]} />

        {/* Lighting */}
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[120, 180, 60]}
          intensity={1.3}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={1}
          shadow-camera-far={700}
          shadow-camera-left={-180}
          shadow-camera-right={180}
          shadow-camera-top={180}
          shadow-camera-bottom={-180}
        />
        <pointLight position={[-90, 60, -90]} intensity={0.25} color="#4488ff" />
        <pointLight position={[0, -15, 0]}    intensity={0.1}  color="#ffffff" />

        <Environment preset="studio" />

        <Suspense fallback={null}>
          <Model
            url={fileUrl}
            wireframe={wireframe}
            color={modelColor}
            onCenterY={handleCenterY}
          />
        </Suspense>

        <BuildPlate />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          target={[0, targetY, 0]}
          minDistance={20}
          maxDistance={600}
          maxPolarAngle={Math.PI / 2}
        />
      </Canvas>
    </div>
  );
}
