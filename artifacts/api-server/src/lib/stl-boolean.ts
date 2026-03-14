import type { Triangle } from "./stl-parser.js";

type AABB = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function meshAABB(tris: Triangle[]): AABB {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const v of [t.v1, t.v2, t.v3]) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function aabbsOverlap(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minY <= b.maxY && a.maxY >= b.minY &&
         a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

// Spatial grid indexed by the two axes transverse to the ray direction
class TriGrid {
  private buckets = new Map<string, Triangle[]>();
  private cellSize: number;
  readonly aabb: AABB;
  readonly axis: 0 | 1 | 2;

  constructor(tris: Triangle[], aabb: AABB, axis: 0 | 1 | 2, cells = 24) {
    this.aabb = aabb;
    this.axis = axis;
    const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const spans = [
      Math.max(aabb.maxX - aabb.minX, 1e-6),
      Math.max(aabb.maxY - aabb.minY, 1e-6),
      Math.max(aabb.maxZ - aabb.minZ, 1e-6),
    ];
    this.cellSize = Math.max(spans[a1], spans[a2]) / cells;
    const mins = [aabb.minX, aabb.minY, aabb.minZ];

    for (const tri of tris) {
      const vs = [tri.v1, tri.v2, tri.v3] as [number, number, number][];
      const u0 = Math.floor((Math.min(...vs.map(v => v[a1])) - mins[a1]) / this.cellSize);
      const u1 = Math.floor((Math.max(...vs.map(v => v[a1])) - mins[a1]) / this.cellSize);
      const w0 = Math.floor((Math.min(...vs.map(v => v[a2])) - mins[a2]) / this.cellSize);
      const w1 = Math.floor((Math.max(...vs.map(v => v[a2])) - mins[a2]) / this.cellSize);
      for (let cu = u0; cu <= u1; cu++) {
        for (let cw = w0; cw <= w1; cw++) {
          const k = `${cu},${cw}`;
          const b = this.buckets.get(k);
          if (b) b.push(tri); else this.buckets.set(k, [tri]);
        }
      }
    }
  }

  query(u: number, w: number): Triangle[] {
    const [a1, a2] = this.axis === 0 ? [1, 2] : this.axis === 1 ? [0, 2] : [0, 1];
    const mins = [this.aabb.minX, this.aabb.minY, this.aabb.minZ];
    const cu = Math.floor((u - mins[a1]) / this.cellSize);
    const cw = Math.floor((w - mins[a2]) / this.cellSize);
    return this.buckets.get(`${cu},${cw}`) ?? [];
  }
}

// Möller–Trumbore for cardinal-axis ray from point (px,py,pz) in +axis direction
function rayTriHit(
  px: number, py: number, pz: number, axis: 0 | 1 | 2,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let det: number, inv: number, u: number, v: number, t: number;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;

  if (axis === 0) {
    // D=(1,0,0) h=D×e2=(0,-e2z,e2y)
    det = e1y * (-e2z) + e1z * e2y;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sy * (-e2z) + sz * e2y) * inv;
    if (u < 0 || u > 1) return false;
    v = qx * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  } else if (axis === 1) {
    // D=(0,1,0) h=D×e2=(e2z,0,-e2x)
    det = e1x * e2z + e1z * (-e2x);
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sx * e2z + sz * (-e2x)) * inv;
    if (u < 0 || u > 1) return false;
    v = qy * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  } else {
    // D=(0,0,1) h=D×e2=(-e2y,e2x,0)
    det = e1x * (-e2y) + e1y * e2x;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sx * (-e2y) + sy * e2x) * inv;
    if (u < 0 || u > 1) return false;
    v = qz * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  }
  return t > 1e-6;
}

function countHits(px: number, py: number, pz: number, axis: 0 | 1 | 2, grid: TriGrid): number {
  const aabb = grid.aabb;
  const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const p = [px, py, pz];
  const mins = [aabb.minX, aabb.minY, aabb.minZ];
  const maxs = [aabb.maxX, aabb.maxY, aabb.maxZ];
  if (p[a1] < mins[a1] || p[a1] > maxs[a1] || p[a2] < mins[a2] || p[a2] > maxs[a2]) return 0;
  const tris = grid.query(p[a1], p[a2]);
  let hits = 0;
  for (const tri of tris) {
    if (rayTriHit(px, py, pz, axis, tri.v1[0], tri.v1[1], tri.v1[2], tri.v2[0], tri.v2[1], tri.v2[2], tri.v3[0], tri.v3[1], tri.v3[2])) hits++;
  }
  return hits;
}

// Majority-vote (3 axes) inside test
function isInsideMesh(
  px: number, py: number, pz: number,
  gX: TriGrid, gY: TriGrid, gZ: TriGrid,
): boolean {
  let votes = 0;
  if (countHits(px, py, pz, 0, gX) % 2 === 1) votes++;
  if (countHits(px, py, pz, 1, gY) % 2 === 1) votes++;
  if (countHits(px, py, pz, 2, gZ) % 2 === 1) votes++;
  return votes >= 2;
}

// Compute face normal (not normalized — we only need direction)
function faceNormal(t: Triangle): [number, number, number] {
  const e1x = t.v2[0] - t.v1[0], e1y = t.v2[1] - t.v1[1], e1z = t.v2[2] - t.v1[2];
  const e2x = t.v3[0] - t.v1[0], e2y = t.v3[1] - t.v1[1], e2z = t.v3[2] - t.v1[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function findShells(triangles: Triangle[]): Map<number, number[]> {
  const PREC = 1e4;
  const vk = (v: [number, number, number]) =>
    `${Math.round(v[0] * PREC)},${Math.round(v[1] * PREC)},${Math.round(v[2] * PREC)}`;
  const parent = Array.from({ length: triangles.length }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const vm = new Map<string, number[]>();
  for (let i = 0; i < triangles.length; i++) {
    for (const v of [triangles[i].v1, triangles[i].v2, triangles[i].v3]) {
      const k = vk(v);
      const a = vm.get(k);
      if (a) a.push(i); else vm.set(k, [i]);
    }
  }
  for (const idxs of vm.values()) {
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  }

  const shells = new Map<number, number[]>();
  for (let i = 0; i < triangles.length; i++) {
    const r = find(i);
    const a = shells.get(r);
    if (a) a.push(i); else shells.set(r, [i]);
  }
  return shells;
}

export function resolveIntersections(
  triangles: Triangle[],
): { triangles: Triangle[]; resolved: number } {
  const shellMap = findShells(triangles);
  if (shellMap.size < 2) return { triangles, resolved: 0 };

  const shells = [...shellMap.values()].map((idxs) => {
    const tris = idxs.map((i) => triangles[i]);
    const aabb = meshAABB(tris);
    // Compute a safe epsilon: 0.3% of the model diagonal
    const diag = Math.sqrt(
      (aabb.maxX - aabb.minX) ** 2 +
      (aabb.maxY - aabb.minY) ** 2 +
      (aabb.maxZ - aabb.minZ) ** 2,
    );
    const eps = Math.max(diag * 0.003, 0.05);
    const gX = new TriGrid(tris, aabb, 0);
    const gY = new TriGrid(tris, aabb, 1);
    const gZ = new TriGrid(tris, aabb, 2);
    return { idxs, tris, aabb, gX, gY, gZ, eps };
  });

  const toRemove = new Set<number>();

  for (let i = 0; i < shells.length; i++) {
    for (let j = i + 1; j < shells.length; j++) {
      const A = shells[i], B = shells[j];
      if (!aabbsOverlap(A.aabb, B.aabb)) continue;

      // A triangle from shell A is "hidden by" shell B if:
      // a point slightly AHEAD of the face (centroid + ε·normal) is INSIDE B.
      // This correctly identifies faces whose visible side faces INTO another shell,
      // while preserving outward-facing surfaces (e.g. vest exterior facing away from body).

      for (let k = 0; k < A.tris.length; k++) {
        const t = A.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        const [nx, ny, nz] = faceNormal(t);
        // Test the point just in front of this face
        const px = cx + A.eps * nx, py = cy + A.eps * ny, pz = cz + A.eps * nz;
        if (isInsideMesh(px, py, pz, B.gX, B.gY, B.gZ)) {
          toRemove.add(A.idxs[k]);
        }
      }

      for (let k = 0; k < B.tris.length; k++) {
        const t = B.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        const [nx, ny, nz] = faceNormal(t);
        const px = cx + B.eps * nx, py = cy + B.eps * ny, pz = cz + B.eps * nz;
        if (isInsideMesh(px, py, pz, A.gX, A.gY, A.gZ)) {
          toRemove.add(B.idxs[k]);
        }
      }
    }
  }

  return {
    triangles: triangles.filter((_, i) => !toRemove.has(i)),
    resolved: toRemove.size,
  };
}
