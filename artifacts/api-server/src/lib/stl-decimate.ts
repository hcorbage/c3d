import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

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
function vecNorm(a: Vec3): Vec3 {
  const len = vecLen(a);
  if (len < 1e-10) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  return vecNorm(vecCross(vecSub(v2, v1), vecSub(v3, v1)));
}

/**
 * Vertex-clustering decimation (voxel grid approach).
 * targetRatio: 0.0–1.0, e.g. 0.5 = reduce to 50% of triangles.
 * Fast and robust — industry standard for quick decimation.
 */
export function decimateMesh(
  triangles: Triangle[],
  targetRatio: number
): { triangles: Triangle[]; trianglesRemoved: number } {
  if (triangles.length === 0) return { triangles, trianglesRemoved: 0 };

  const ratio = Math.max(0.05, Math.min(0.99, targetRatio));

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const tri of triangles) {
    for (const v of [tri.v1, tri.v2, tri.v3] as Vec3[]) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }

  // Determine voxel size to hit target ratio
  // Total unique vertices ~= triangles * 0.5 (rough estimate for a closed mesh)
  const uniqueVerts = triangles.length / 2;
  const targetVerts = uniqueVerts * ratio;
  const vol = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  const voxelSize = Math.cbrt(vol / targetVerts);

  const eps = voxelSize > 0 ? voxelSize : 1e-3;

  // Map vertices to voxel centroids
  const voxelCentroids = new Map<string, Vec3>();

  function voxelKey(v: Vec3): string {
    const ix = Math.floor((v[0] - minX) / eps);
    const iy = Math.floor((v[1] - minY) / eps);
    const iz = Math.floor((v[2] - minZ) / eps);
    return `${ix},${iy},${iz}`;
  }

  function getOrCreateCentroid(v: Vec3): Vec3 {
    const k = voxelKey(v);
    if (!voxelCentroids.has(k)) {
      // Center of voxel
      const ix = Math.floor((v[0] - minX) / eps);
      const iy = Math.floor((v[1] - minY) / eps);
      const iz = Math.floor((v[2] - minZ) / eps);
      voxelCentroids.set(k, [
        minX + (ix + 0.5) * eps,
        minY + (iy + 0.5) * eps,
        minZ + (iz + 0.5) * eps,
      ]);
    }
    return voxelCentroids.get(k)!;
  }

  const result: Triangle[] = [];
  let removed = 0;
  const seenFaces = new Set<string>();

  for (const tri of triangles) {
    const v1 = getOrCreateCentroid(tri.v1 as Vec3);
    const v2 = getOrCreateCentroid(tri.v2 as Vec3);
    const v3 = getOrCreateCentroid(tri.v3 as Vec3);

    // Skip degenerate triangles (collapsed by voxelization)
    if (v1 === v2 || v2 === v3 || v1 === v3) {
      removed++;
      continue;
    }

    // Skip duplicate faces
    const faceKey = [
      `${v1[0].toFixed(4)},${v1[1].toFixed(4)},${v1[2].toFixed(4)}`,
      `${v2[0].toFixed(4)},${v2[1].toFixed(4)},${v2[2].toFixed(4)}`,
      `${v3[0].toFixed(4)},${v3[1].toFixed(4)},${v3[2].toFixed(4)}`,
    ].sort().join("|");

    if (seenFaces.has(faceKey)) {
      removed++;
      continue;
    }
    seenFaces.add(faceKey);

    result.push({
      normal: computeNormal(v1, v2, v3),
      v1,
      v2,
      v3,
    });
  }

  return { triangles: result, trianglesRemoved: removed };
}
