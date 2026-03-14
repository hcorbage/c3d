import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, Center, Grid } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

interface StlViewerProps {
  fileUrl: string | null;
  wireframe?: boolean;
  label?: string;
  labelColor?: "blue" | "green";
}

function Model({ url, wireframe, color }: { url: string; wireframe: boolean; color: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    setGeometry(null);
    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => {
        geo.computeVertexNormals();
        setGeometry(geo);
      },
      undefined,
      (error) => {
        console.error("Error loading STL:", error);
      }
    );
  }, [url]);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.4,
      roughness: 0.3,
      wireframe,
    });
  }, [wireframe, color]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow />
  );
}

export function StlViewer({ fileUrl, wireframe = false, label, labelColor = "blue" }: StlViewerProps) {
  const modelColor = labelColor === "green" ? "#22c55e" : "#3b82f6";
  const labelBg = labelColor === "green"
    ? "bg-green-500/20 border-green-500/40 text-green-300"
    : "bg-blue-500/20 border-blue-500/40 text-blue-300";

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
    <div className="w-full h-full relative rounded-xl overflow-hidden bg-black/20">
      {label && (
        <div className={`absolute top-3 left-3 z-10 px-3 py-1 rounded-full text-xs font-semibold border backdrop-blur-sm ${labelBg}`}>
          {label}
        </div>
      )}
      <Canvas shadows camera={{ position: [0, 0, 150], fov: 50 }}>
        <color attach="background" args={['#050505']} />

        <ambientLight intensity={0.4} />
        <spotLight position={[100, 100, 100]} angle={0.15} penumbra={1} intensity={1} castShadow />
        <pointLight position={[-100, -100, -100]} intensity={0.5} />

        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.5} contactShadow={{ opacity: 0.8, blur: 2 }}>
            <Center>
              <Model url={fileUrl} wireframe={wireframe} color={modelColor} />
            </Center>
          </Stage>
        </Suspense>

        <Grid
          infiniteGrid
          fadeDistance={200}
          sectionColor={labelColor === "green" ? "#22c55e" : "#3b82f6"}
          cellColor="#1e293b"
          sectionSize={20}
          cellSize={5}
          position={[0, -0.5, 0]}
        />

        {/* Sem autoRotate — modelo fica parado até o usuário interagir */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  );
}
