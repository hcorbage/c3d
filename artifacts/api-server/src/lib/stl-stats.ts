import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

function vertKey(v: Vec3, precision = 6): string {
  return `${v[0].toFixed(precision)},${v[1].toFixed(precision)},${v[2].toFixed(precision)}`;
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vecLen(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export interface MeshStats {
  triangleCount: number;
  vertexCount: number;
  boundingBox: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  };
  volume: number;
  surfaceArea: number;
  isManifold: boolean;
  duplicateTriangles: number;
  degenerateTriangles: number;
  shellCount: number;
  openEdges: number;
  unitWarning: "inches" | "meters" | null;
}

export function computeStats(triangles: Triangle[]): MeshStats {
  const vertices = new Set<string>();

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let surfaceArea = 0;
  let signedVolume = 0;
  let degenerateTriangles = 0;

  const triKeys = new Set<string>();
  let duplicateTriangles = 0;

  const edgeCount = new Map<string, number>();

  for (const tri of triangles) {
    const { v1, v2, v3 } = tri;

    for (const v of [v1, v2, v3] as Vec3[]) {
      const k = vertKey(v);
      vertices.add(k);
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }

    const cross = vecCross(vecSub(v2 as Vec3, v1 as Vec3), vecSub(v3 as Vec3, v1 as Vec3));
    const area = vecLen(cross) / 2;

    if (area < 1e-10) {
      degenerateTriangles++;
      continue;
    }

    const keys = [vertKey(v1 as Vec3), vertKey(v2 as Vec3), vertKey(v3 as Vec3)].sort();
    const triKey = keys.join("|");
    if (triKeys.has(triKey)) {
      duplicateTriangles++;
    }
    triKeys.add(triKey);

    surfaceArea += area;
    signedVolume += vecDot(v1 as Vec3, cross) / 6;

    const edgePairs: [Vec3, Vec3][] = [
      [v1 as Vec3, v2 as Vec3],
      [v2 as Vec3, v3 as Vec3],
      [v3 as Vec3, v1 as Vec3],
    ];
    for (const [a, b] of edgePairs) {
      const ka = vertKey(a);
      const kb = vertKey(b);
      const edgeKey = [ka, kb].sort().join("|");
      edgeCount.set(edgeKey, (edgeCount.get(edgeKey) ?? 0) + 1);
    }
  }

  let isManifold = true;
  let openEdges = 0;
  for (const count of edgeCount.values()) {
    if (count !== 2) {
      isManifold = false;
      openEdges++;
    }
  }

  // Shell count via Union-Find on triangles
  const n = triangles.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const vertToTris = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const v of [triangles[i].v1, triangles[i].v2, triangles[i].v3] as Vec3[]) {
      const k = vertKey(v);
      if (!vertToTris.has(k)) vertToTris.set(k, []);
      vertToTris.get(k)!.push(i);
    }
  }
  for (const tris of vertToTris.values()) {
    for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  }
  const roots = new Set(Array.from({ length: n }, (_, i) => find(i)));
  const shellCount = roots.size;

  // Unit warning heuristic (STL units are usually mm for printing)
  const maxDim = Math.max(
    isFinite(maxX) ? maxX - minX : 0,
    isFinite(maxY) ? maxY - minY : 0,
    isFinite(maxZ) ? maxZ - minZ : 0,
  );
  let unitWarning: "inches" | "meters" | null = null;
  if (maxDim > 0 && maxDim < 2) unitWarning = "meters";
  else if (maxDim > 5000) unitWarning = "inches";

  return {
    triangleCount: triangles.length,
    vertexCount: vertices.size,
    boundingBox: {
      minX: isFinite(minX) ? minX : 0,
      minY: isFinite(minY) ? minY : 0,
      minZ: isFinite(minZ) ? minZ : 0,
      maxX: isFinite(maxX) ? maxX : 0,
      maxY: isFinite(maxY) ? maxY : 0,
      maxZ: isFinite(maxZ) ? maxZ : 0,
    },
    volume: Math.abs(signedVolume),
    surfaceArea,
    isManifold,
    duplicateTriangles,
    degenerateTriangles,
    shellCount,
    openEdges,
    unitWarning,
  };
}
