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

// ─── Spatial grid indexed by two "transverse" axes to a ray direction ────────
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

// Möller–Trumbore for a positive cardinal-axis ray
function rayTriHit(
  px: number, py: number, pz: number, axis: 0 | 1 | 2,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  let det: number, inv: number, u: number, v: number, t: number;

  if (axis === 0) {
    det = e1y * (-e2z) + e1z * e2y;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sy * (-e2z) + sz * e2y) * inv; if (u < 0 || u > 1) return false;
    v = qx * inv; if (v < 0 || u + v > 1) return false;
  } else if (axis === 1) {
    det = e1x * e2z + e1z * (-e2x);
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sx * e2z + sz * (-e2x)) * inv; if (u < 0 || u > 1) return false;
    v = qy * inv; if (v < 0 || u + v > 1) return false;
  } else {
    det = e1x * (-e2y) + e1y * e2x;
    if (Math.abs(det) < 1e-10) return false;
    inv = 1 / det;
    u = (sx * (-e2y) + sy * e2x) * inv; if (u < 0 || u > 1) return false;
    v = qz * inv; if (v < 0 || u + v > 1) return false;
  }
  t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-6;
}

function countHits(px: number, py: number, pz: number, axis: 0 | 1 | 2, grid: TriGrid): number {
  const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const aabb = grid.aabb;
  const mins = [aabb.minX, aabb.minY, aabb.minZ];
  const maxs = [aabb.maxX, aabb.maxY, aabb.maxZ];
  const p = [px, py, pz];
  if (p[a1] < mins[a1] || p[a1] > maxs[a1] || p[a2] < mins[a2] || p[a2] > maxs[a2]) return 0;
  const tris = grid.query(p[a1], p[a2]);
  let hits = 0;
  for (const tri of tris) {
    if (rayTriHit(px, py, pz, axis, tri.v1[0], tri.v1[1], tri.v1[2], tri.v2[0], tri.v2[1], tri.v2[2], tri.v3[0], tri.v3[1], tri.v3[2])) hits++;
  }
  return hits;
}

// Robust inside-mesh test using 3 rays (majority vote: ≥2/3 must agree)
// Also jitters the sample point slightly to avoid boundary ambiguity.
function isInsideMesh(
  px: number, py: number, pz: number,
  gX: TriGrid, gY: TriGrid, gZ: TriGrid,
): boolean {
  // Tiny jitter to avoid landing exactly on a face edge
  const j = 1.3e-4;
  const jx = px + j, jy = py + j * 0.7, jz = pz + j * 1.1;
  let votes = 0;
  if (countHits(jx, jy, jz, 0, gX) % 2 === 1) votes++;
  if (countHits(jx, jy, jz, 1, gY) % 2 === 1) votes++;
  if (countHits(jx, jy, jz, 2, gZ) % 2 === 1) votes++;
  return votes >= 2;
}

// ─── A triangle is considered "hidden" by another shell if:
//   centroid is inside   AND   at least 1 of the 2 edge midpoints is inside (2/3 majority).
//
// Using a 2-out-of-3 rule (centroid + 1 midpoint) removes boundary triangles that
// straddle the shell surface — the main cause of paint bleeding in BambuLab.
// The previous "all-3" rule was too conservative and left those straddling triangles.
function isTriangleHiddenBy(
  t: Triangle,
  gX: TriGrid, gY: TriGrid, gZ: TriGrid,
): boolean {
  // centroid must be inside (required anchor — prevents false positives)
  const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
  const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
  const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
  if (!isInsideMesh(cx, cy, cz, gX, gY, gZ)) return false;

  // midpoint of edge v1-v2
  const m1x = (t.v1[0] + t.v2[0]) / 2;
  const m1y = (t.v1[1] + t.v2[1]) / 2;
  const m1z = (t.v1[2] + t.v2[2]) / 2;
  if (isInsideMesh(m1x, m1y, m1z, gX, gY, gZ)) return true; // centroid + midpoint 1 ✓

  // midpoint of edge v2-v3
  const m2x = (t.v2[0] + t.v3[0]) / 2;
  const m2y = (t.v2[1] + t.v3[1]) / 2;
  const m2z = (t.v2[2] + t.v3[2]) / 2;
  if (isInsideMesh(m2x, m2y, m2z, gX, gY, gZ)) return true; // centroid + midpoint 2 ✓

  // midpoint of edge v3-v1 (extra coverage for sliver triangles)
  const m3x = (t.v3[0] + t.v1[0]) / 2;
  const m3y = (t.v3[1] + t.v1[1]) / 2;
  const m3z = (t.v3[2] + t.v1[2]) / 2;
  return isInsideMesh(m3x, m3y, m3z, gX, gY, gZ); // centroid + midpoint 3 ✓
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

  console.log(`[resolveIntersections] found ${shellMap.size} shell(s) in ${triangles.length} triangles`);
  for (const [id, idxs] of shellMap) {
    console.log(`  shell ${id}: ${idxs.length} triangles`);
  }

  if (shellMap.size < 2) return { triangles, resolved: 0 };

  const shells = [...shellMap.values()].map((idxs) => {
    const tris = idxs.map((i) => triangles[i]);
    const aabb = meshAABB(tris);
    const gX = new TriGrid(tris, aabb, 0);
    const gY = new TriGrid(tris, aabb, 1);
    const gZ = new TriGrid(tris, aabb, 2);
    return { idxs, tris, aabb, gX, gY, gZ };
  });

  const toRemove = new Set<number>();

  for (let i = 0; i < shells.length; i++) {
    for (let j = i + 1; j < shells.length; j++) {
      const A = shells[i], B = shells[j];
      if (!aabbsOverlap(A.aabb, B.aabb)) continue;

      let removedAB = 0, removedBA = 0;
      for (let k = 0; k < A.tris.length; k++) {
        if (isTriangleHiddenBy(A.tris[k], B.gX, B.gY, B.gZ)) {
          toRemove.add(A.idxs[k]);
          removedAB++;
        }
      }
      for (let k = 0; k < B.tris.length; k++) {
        if (isTriangleHiddenBy(B.tris[k], A.gX, A.gY, A.gZ)) {
          toRemove.add(B.idxs[k]);
          removedBA++;
        }
      }
      console.log(`  pair (${i},${j}): removed ${removedAB} from shell A, ${removedBA} from shell B`);
    }
  }

  return {
    triangles: triangles.filter((_, i) => !toRemove.has(i)),
    resolved: toRemove.size,
  };
}
