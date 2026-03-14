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

// ─── Generic spatial grid indexed by two "non-ray" axes ──────────────────────
// axis: 0=X,1=Y,2=Z  — the ray is shot in the POSITIVE direction of this axis.
// The grid is indexed by the other two axes.

class TriGrid {
  private buckets = new Map<string, Triangle[]>();
  private cellSize: number;
  readonly aabb: AABB;
  readonly axis: 0 | 1 | 2;

  constructor(tris: Triangle[], aabb: AABB, axis: 0 | 1 | 2, cells = 20) {
    this.aabb = aabb;
    this.axis = axis;

    // The two "transverse" axes
    const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const spans = [
      Math.max((aabb.maxX - aabb.minX), 1e-6),
      Math.max((aabb.maxY - aabb.minY), 1e-6),
      Math.max((aabb.maxZ - aabb.minZ), 1e-6),
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

// ─── Möller–Trumbore for a ray along one of the cardinal axes ────────────────
// axis 0 = +X, axis 1 = +Y, axis 2 = +Z

function rayTriHit(
  px: number, py: number, pz: number,
  axis: 0 | 1 | 2,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

  let hy: number, hz: number;
  let det: number, inv: number;
  let sx: number, sy: number, sz: number;
  let u: number;
  let qx: number, qy: number, qz: number;
  let v: number, t: number;

  if (axis === 0) {
    // D = (1,0,0) → h = D×e2 = (0, -e2z, e2y)
    hy = -e2z; hz = e2y;
    det = e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    sx = px - ax; sy = py - ay; sz = pz - az;
    u = (sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) return false;
    qx = sy * e1z - sz * e1y; qy = sz * e1x - sx * e1z; qz = sx * e1y - sy * e1x;
    v = qx * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  } else if (axis === 1) {
    // D = (0,1,0) → h = D×e2 = (e2z, 0, -e2x)
    const hx2 = e2z; const hz2 = -e2x;
    det = e1x * hx2 + e1z * hz2;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    sx = px - ax; sy = py - ay; sz = pz - az;
    u = (sx * hx2 + sz * hz2) * inv;
    if (u < 0 || u > 1) return false;
    qx = sy * e1z - sz * e1y; qy = sz * e1x - sx * e1z; qz = sx * e1y - sy * e1x;
    v = qy * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  } else {
    // D = (0,0,1) → h = D×e2 = (-e2y, e2x, 0)
    const hx3 = -e2y; const hy3 = e2x;
    det = e1x * hx3 + e1y * hy3;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    sx = px - ax; sy = py - ay; sz = pz - az;
    u = (sx * hx3 + sy * hy3) * inv;
    if (u < 0 || u > 1) return false;
    qx = sy * e1z - sz * e1y; qy = sz * e1x - sx * e1z; qz = sx * e1y - sy * e1x;
    v = qz * inv;
    if (v < 0 || u + v > 1) return false;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  return t > 1e-6;
}

// Cast a ray along `axis` and return hit count (parity → odd=inside)
function countHits(px: number, py: number, pz: number, axis: 0 | 1 | 2, grid: TriGrid): number {
  const aabb = grid.aabb;
  const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const p = [px, py, pz];
  const u = p[a1], w = p[a2];
  const mins = [aabb.minX, aabb.minY, aabb.minZ];
  const maxs = [aabb.maxX, aabb.maxY, aabb.maxZ];
  if (u < mins[a1] || u > maxs[a1] || w < mins[a2] || w > maxs[a2]) return 0;
  const tris = grid.query(u, w);
  let hits = 0;
  for (const tri of tris) {
    if (rayTriHit(px, py, pz, axis, tri.v1[0], tri.v1[1], tri.v1[2], tri.v2[0], tri.v2[1], tri.v2[2], tri.v3[0], tri.v3[1], tri.v3[2])) hits++;
  }
  return hits;
}

// Majority-vote inside test: cast 3 rays in +X, +Y, +Z — point is inside if ≥2 agree
function isInsideMesh(
  px: number, py: number, pz: number,
  gridX: TriGrid, gridY: TriGrid, gridZ: TriGrid,
): boolean {
  let votes = 0;
  if (countHits(px, py, pz, 0, gridX) % 2 === 1) votes++;
  if (countHits(px, py, pz, 1, gridY) % 2 === 1) votes++;
  if (countHits(px, py, pz, 2, gridZ) % 2 === 1) votes++;
  return votes >= 2;
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
    // Build 3 grids (one per ray direction) for robust inside-test
    const gridX = new TriGrid(tris, aabb, 0);
    const gridY = new TriGrid(tris, aabb, 1);
    const gridZ = new TriGrid(tris, aabb, 2);
    return { idxs, tris, aabb, gridX, gridY, gridZ };
  });

  const toRemove = new Set<number>();

  for (let i = 0; i < shells.length; i++) {
    for (let j = i + 1; j < shells.length; j++) {
      const A = shells[i], B = shells[j];
      if (!aabbsOverlap(A.aabb, B.aabb)) continue;

      // Remove triangles of A that are hidden inside B
      for (let k = 0; k < A.tris.length; k++) {
        const t = A.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        if (isInsideMesh(cx, cy, cz, B.gridX, B.gridY, B.gridZ)) {
          toRemove.add(A.idxs[k]);
        }
      }

      // Remove triangles of B that are hidden inside A
      for (let k = 0; k < B.tris.length; k++) {
        const t = B.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        if (isInsideMesh(cx, cy, cz, A.gridX, A.gridY, A.gridZ)) {
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
