/**
 * Mesh splitting — divides an STL mesh into printable pieces.
 *
 * Algorithm:
 *  1. Scale the mesh to the desired target size.
 *  2. Compute how many cuts are needed in X, Y, Z to fit the bed.
 *  3. For every cell (xi, yi, zi) clip all triangles to the AABB of that cell
 *     using the Sutherland-Hodgman algorithm (exact, handles any convex cell).
 *  4. Close the cut faces: boundary edges that lie on a cut plane are traced
 *     into loops and fan-triangulated from their centroid.
 *  5. Write each non-empty cell as a binary STL buffer.
 */

import { Triangle, writeBinaryStl } from "./stl-parser.js";

type Vec3 = [number, number, number];

// ── Geometry helpers ─────────────────────────────────────────────────────────

function dot3(ax: number, ay: number, az: number, v: Vec3): number {
  return ax * v[0] + ay * v[1] + az * v[2];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function len(v: Vec3): number {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function norm(v: Vec3): Vec3 {
  const l = len(v);
  return l < 1e-12 ? [0, 0, 1] : [v[0] / l, v[1] / l, v[2] / l];
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  return norm(cross(sub(v2, v1), sub(v3, v1)));
}

// ── Sutherland-Hodgman polygon clipping ──────────────────────────────────────
// Clips a convex polygon against the half-space  n·v >= d  (inside side).

function clipByPlane(
  poly: Vec3[],
  nx: number, ny: number, nz: number,
  d: number,
): Vec3[] {
  if (poly.length === 0) return [];
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot3(nx, ny, nz, a) - d;
    const db = dot3(nx, ny, nz, b) - d;
    if (da >= -1e-9) out.push(a);
    if ((da > 1e-9) !== (db > 1e-9)) {
      const t = da / (da - db);
      out.push(lerp(a, b, t));
    }
  }
  return out;
}

function clipToBox(
  tri: Triangle,
  xMin: number, xMax: number,
  yMin: number, yMax: number,
  zMin: number, zMax: number,
): Vec3[] {
  let p: Vec3[] = [tri.v1 as Vec3, tri.v2 as Vec3, tri.v3 as Vec3];
  p = clipByPlane(p,  1,  0,  0, xMin);
  p = clipByPlane(p, -1,  0,  0, -xMax);
  p = clipByPlane(p,  0,  1,  0, yMin);
  p = clipByPlane(p,  0, -1,  0, -yMax);
  p = clipByPlane(p,  0,  0,  1, zMin);
  p = clipByPlane(p,  0,  0, -1, -zMax);
  return p;
}

// Convert a clipped polygon (≥3 verts) to triangles via fan from first vertex.
function polyToTriangles(poly: Vec3[]): Triangle[] {
  const tris: Triangle[] = [];
  for (let i = 1; i < poly.length - 1; i++) {
    const v1 = poly[0], v2 = poly[i], v3 = poly[i + 1];
    tris.push({ normal: computeNormal(v1, v2, v3), v1, v2, v3 });
  }
  return tris;
}

// ── Cap generation ────────────────────────────────────────────────────────────
// After clipping, each cut face is an open boundary. We find boundary edges
// that lie on a cut plane and fill them with flat caps.

const EPS = 1e-3; // 0.001 mm tolerance for "on plane" checks

function onPlane(v: Vec3, axis: 0 | 1 | 2, val: number): boolean {
  return Math.abs(v[axis] - val) < EPS;
}

function vertKey(v: Vec3): string {
  return `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
}

function generateCaps(triangles: Triangle[], cutPlanes: { axis: 0 | 1 | 2; val: number }[]): Triangle[] {
  const capTriangles: Triangle[] = [];

  for (const { axis, val } of cutPlanes) {
    // Collect all edges (pairs of consecutive vertices in triangle) where
    // BOTH endpoints lie on this cut plane.
    const edgeMap = new Map<number, number[]>(); // vertex idx → [next vertex idxs]
    const verts: Vec3[] = [];
    const keyToIdx = new Map<string, number>();

    function getIdx(v: Vec3): number {
      const k = vertKey(v);
      if (keyToIdx.has(k)) return keyToIdx.get(k)!;
      const idx = verts.length;
      verts.push(v);
      keyToIdx.set(k, idx);
      return idx;
    }

    for (const tri of triangles) {
      const pts = [tri.v1, tri.v2, tri.v3] as Vec3[];
      for (let i = 0; i < 3; i++) {
        const a = pts[i], b = pts[(i + 1) % 3];
        if (onPlane(a, axis, val) && onPlane(b, axis, val)) {
          const ai = getIdx(a), bi = getIdx(b);
          if (!edgeMap.has(ai)) edgeMap.set(ai, []);
          edgeMap.get(ai)!.push(bi);
        }
      }
    }

    if (verts.length < 3) continue;

    // Trace boundary loops from the edge map.
    const visited = new Set<number>();
    const loops: number[][] = [];

    for (const start of edgeMap.keys()) {
      if (visited.has(start)) continue;
      const loop: number[] = [];
      let cur = start;
      let safety = 0;
      while (!visited.has(cur) && safety++ < 100_000) {
        visited.add(cur);
        loop.push(cur);
        const nexts = edgeMap.get(cur);
        if (!nexts || nexts.length === 0) break;
        const nxt = nexts.find((n) => !visited.has(n));
        if (nxt === undefined) break;
        cur = nxt;
      }
      if (loop.length >= 3) loops.push(loop);
    }

    // For each loop, fan-triangulate from the centroid.
    for (const loop of loops) {
      const loopVerts = loop.map((i) => verts[i]);
      let cx = 0, cy = 0, cz = 0;
      for (const v of loopVerts) { cx += v[0]; cy += v[1]; cz += v[2]; }
      const centroid: Vec3 = [cx / loopVerts.length, cy / loopVerts.length, cz / loopVerts.length];

      // Determine correct winding based on cut plane normal
      // Cut plane normal points outward (away from cell interior).
      // We want the cap to face outward as well.
      for (let i = 0; i < loopVerts.length; i++) {
        const v1 = loopVerts[i];
        const v2 = loopVerts[(i + 1) % loopVerts.length];
        const n = computeNormal(v1, v2, centroid);

        // The cap normal should align with the axis direction.
        // If the cut is at xMin, normal should point in -X (outward from cell).
        // If at xMax, normal should point in +X. Correct winding accordingly.
        const axisNormal: Vec3 = [0, 0, 0];
        axisNormal[axis] = 1; // will be flipped if needed
        const d = n[0] * axisNormal[0] + n[1] * axisNormal[1] + n[2] * axisNormal[2];

        let tri: Triangle;
        if (d >= 0) {
          tri = { normal: n, v1, v2, v3: centroid };
        } else {
          const fn = computeNormal(v1, centroid, v2);
          tri = { normal: fn, v1, v2: centroid, v3: v2 };
        }
        capTriangles.push(tri);
      }
    }
  }

  return capTriangles;
}

// ── Bounding box ─────────────────────────────────────────────────────────────

function meshBBox(triangles: Triangle[]): { min: Vec3; max: Vec3 } {
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { v1, v2, v3 } of triangles) {
    for (const v of [v1, v2, v3] as Vec3[]) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < mn[i]) mn[i] = v[i];
        if (v[i] > mx[i]) mx[i] = v[i];
      }
    }
  }
  return { min: mn, max: mx };
}

// ── Scale ────────────────────────────────────────────────────────────────────

function scaleMesh(triangles: Triangle[], sx: number, sy: number, sz: number): Triangle[] {
  return triangles.map(({ v1, v2, v3 }) => {
    const sv1: Vec3 = [v1[0] * sx, v1[1] * sy, v1[2] * sz];
    const sv2: Vec3 = [v2[0] * sx, v2[1] * sy, v2[2] * sz];
    const sv3: Vec3 = [v3[0] * sx, v3[1] * sy, v3[2] * sz];
    return { normal: computeNormal(sv1, sv2, sv3), v1: sv1, v2: sv2, v3: sv3 };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SplitOptions {
  /** Desired final print size in mm (per axis). 0 or undefined = keep original. */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  /** Print bed dimensions in mm */
  bedX: number;
  bedY: number;
  bedZ: number;
}

export interface SplitPiece {
  label: string;  // e.g. "X1_Y0_Z0"
  xi: number; yi: number; zi: number;
  stlBuffer: Buffer;
  triangleCount: number;
}

export interface SplitResult {
  pieces: SplitPiece[];
  gridX: number;
  gridY: number;
  gridZ: number;
  totalPieces: number;
  scaledSizeX: number;
  scaledSizeY: number;
  scaledSizeZ: number;
}

export function splitMesh(triangles: Triangle[], opts: SplitOptions): SplitResult {
  const { bedX, bedY, bedZ } = opts;

  // 1. Compute bounding box
  const { min, max } = meshBBox(triangles);
  const sizeX = max[0] - min[0];
  const sizeY = max[1] - min[1];
  const sizeZ = max[2] - min[2];

  // 2. Compute scale factors
  let sx = 1, sy = 1, sz = 1;
  if (opts.targetX && opts.targetX > 0) sx = opts.targetX / sizeX;
  if (opts.targetY && opts.targetY > 0) sy = opts.targetY / sizeY;
  if (opts.targetZ && opts.targetZ > 0) sz = opts.targetZ / sizeZ;

  // If only one target dimension is set, scale uniformly
  const setCount = [opts.targetX, opts.targetY, opts.targetZ].filter((v) => v && v > 0).length;
  if (setCount === 1) {
    // Uniform scale based on the one set axis
    const s = sx !== 1 ? sx : sy !== 1 ? sy : sz;
    sx = sy = sz = s;
  }

  // 3. Scale the mesh (also translate so bounding box starts at origin)
  const scaled = scaleMesh(
    triangles.map(({ v1, v2, v3, normal }) => ({
      normal,
      v1: [v1[0] - min[0], v1[1] - min[1], v1[2] - min[2]] as Vec3,
      v2: [v2[0] - min[0], v2[1] - min[1], v2[2] - min[2]] as Vec3,
      v3: [v3[0] - min[0], v3[1] - min[1], v3[2] - min[2]] as Vec3,
    })),
    sx, sy, sz,
  );

  const scaledX = sizeX * sx;
  const scaledY = sizeY * sy;
  const scaledZ = sizeZ * sz;

  // 4. Compute grid
  const gridX = Math.ceil(scaledX / bedX);
  const gridY = Math.ceil(scaledY / bedY);
  const gridZ = Math.ceil(scaledZ / bedZ);

  console.log(
    `[split] scaled size: ${scaledX.toFixed(1)}x${scaledY.toFixed(1)}x${scaledZ.toFixed(1)} mm` +
    ` → grid: ${gridX}x${gridY}x${gridZ} = ${gridX * gridY * gridZ} pieces`,
  );

  const pieces: SplitPiece[] = [];

  // 5. For each cell, clip and cap
  for (let xi = 0; xi < gridX; xi++) {
    for (let yi = 0; yi < gridY; yi++) {
      for (let zi = 0; zi < gridZ; zi++) {
        const xMin = xi * bedX;
        const xMax = Math.min((xi + 1) * bedX, scaledX);
        const yMin = yi * bedY;
        const yMax = Math.min((yi + 1) * bedY, scaledY);
        const zMin = zi * bedZ;
        const zMax = Math.min((zi + 1) * bedZ, scaledZ);

        // Clip all triangles to this cell
        const cellTris: Triangle[] = [];
        for (const tri of scaled) {
          const poly = clipToBox(tri, xMin, xMax, yMin, yMax, zMin, zMax);
          if (poly.length >= 3) {
            cellTris.push(...polyToTriangles(poly));
          }
        }

        if (cellTris.length === 0) continue;

        // Determine which faces of this cell are CUT faces (i.e., inside the model)
        // Boundary faces of the whole model are NOT cut faces.
        const cutPlanes: { axis: 0 | 1 | 2; val: number }[] = [];
        if (xi > 0)           cutPlanes.push({ axis: 0, val: xMin });
        if (xi < gridX - 1)   cutPlanes.push({ axis: 0, val: xMax });
        if (yi > 0)           cutPlanes.push({ axis: 1, val: yMin });
        if (yi < gridY - 1)   cutPlanes.push({ axis: 1, val: yMax });
        if (zi > 0)           cutPlanes.push({ axis: 2, val: zMin });
        if (zi < gridZ - 1)   cutPlanes.push({ axis: 2, val: zMax });

        // Generate caps to close cut faces
        const caps = cutPlanes.length > 0 ? generateCaps(cellTris, cutPlanes) : [];
        const allTris = [...cellTris, ...caps];

        // Translate piece back to origin (so each STL starts at 0,0,0)
        const localTris: Triangle[] = allTris.map(({ v1, v2, v3 }) => {
          const lv1: Vec3 = [v1[0] - xMin, v1[1] - yMin, v1[2] - zMin];
          const lv2: Vec3 = [v2[0] - xMin, v2[1] - yMin, v2[2] - zMin];
          const lv3: Vec3 = [v3[0] - xMin, v3[1] - yMin, v3[2] - zMin];
          return { normal: computeNormal(lv1, lv2, lv3), v1: lv1, v2: lv2, v3: lv3 };
        });

        const stlBuffer = writeBinaryStl(localTris);
        const label = `X${xi + 1}_Y${yi + 1}_Z${zi + 1}`;

        pieces.push({ label, xi, yi, zi, stlBuffer, triangleCount: localTris.length });
        console.log(`[split] piece ${label}: ${localTris.length} triangles`);
      }
    }
  }

  return {
    pieces,
    gridX, gridY, gridZ,
    totalPieces: pieces.length,
    scaledSizeX: scaledX,
    scaledSizeY: scaledY,
    scaledSizeZ: scaledZ,
  };
}
