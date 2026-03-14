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

// ─── Möller 1997 triangle-triangle intersection test ──────────────────────────
// Returns true when two non-coplanar, non-adjacent triangles geometrically
// cross each other. Uses the full interval-overlap test (no false positives).
type Vec3 = [number, number, number];

function triTriIntersect(
  p0: Vec3, p1: Vec3, p2: Vec3,
  q0: Vec3, q1: Vec3, q2: Vec3,
): boolean {
  const EPS = 1e-7;

  // Plane of T2
  const n2x = (q1[1]-q0[1])*(q2[2]-q0[2]) - (q1[2]-q0[2])*(q2[1]-q0[1]);
  const n2y = (q1[2]-q0[2])*(q2[0]-q0[0]) - (q1[0]-q0[0])*(q2[2]-q0[2]);
  const n2z = (q1[0]-q0[0])*(q2[1]-q0[1]) - (q1[1]-q0[1])*(q2[0]-q0[0]);
  const d2  = n2x*q0[0] + n2y*q0[1] + n2z*q0[2];
  const dp0 = n2x*p0[0] + n2y*p0[1] + n2z*p0[2] - d2;
  const dp1 = n2x*p1[0] + n2y*p1[1] + n2z*p1[2] - d2;
  const dp2 = n2x*p2[0] + n2y*p2[1] + n2z*p2[2] - d2;
  if (dp0 > EPS && dp1 > EPS && dp2 > EPS) return false;
  if (dp0 < -EPS && dp1 < -EPS && dp2 < -EPS) return false;

  // Plane of T1
  const n1x = (p1[1]-p0[1])*(p2[2]-p0[2]) - (p1[2]-p0[2])*(p2[1]-p0[1]);
  const n1y = (p1[2]-p0[2])*(p2[0]-p0[0]) - (p1[0]-p0[0])*(p2[2]-p0[2]);
  const n1z = (p1[0]-p0[0])*(p2[1]-p0[1]) - (p1[1]-p0[1])*(p2[0]-p0[0]);
  const d1  = n1x*p0[0] + n1y*p0[1] + n1z*p0[2];
  const dq0 = n1x*q0[0] + n1y*q0[1] + n1z*q0[2] - d1;
  const dq1 = n1x*q1[0] + n1y*q1[1] + n1z*q1[2] - d1;
  const dq2 = n1x*q2[0] + n1y*q2[1] + n1z*q2[2] - d1;
  if (dq0 > EPS && dq1 > EPS && dq2 > EPS) return false;
  if (dq0 < -EPS && dq1 < -EPS && dq2 < -EPS) return false;

  // Intersection line direction D = N1 × N2
  const Dx = n1y*n2z - n1z*n2y;
  const Dy = n1z*n2x - n1x*n2z;
  const Dz = n1x*n2y - n1y*n2x;
  // Degenerate (coplanar triangles) → skip
  if (Math.abs(Dx) + Math.abs(Dy) + Math.abs(Dz) < EPS) return false;

  // Project T1 vertices onto D
  const pD0 = Dx*p0[0] + Dy*p0[1] + Dz*p0[2];
  const pD1 = Dx*p1[0] + Dy*p1[1] + Dz*p1[2];
  const pD2 = Dx*p2[0] + Dy*p2[1] + Dz*p2[2];
  // Project T2 vertices onto D
  const qD0 = Dx*q0[0] + Dy*q0[1] + Dz*q0[2];
  const qD1 = Dx*q1[0] + Dy*q1[1] + Dz*q1[2];
  const qD2 = Dx*q2[0] + Dy*q2[1] + Dz*q2[2];

  // Compute intersection interval for T1 on D
  const sp = [dp0 >= 0 ? 1 : -1, dp1 >= 0 ? 1 : -1, dp2 >= 0 ? 1 : -1];
  let t1lo: number, t1hi: number;
  if (sp[0] !== sp[1] && sp[0] !== sp[2]) {
    t1lo = pD0 + (pD1 - pD0) * dp0 / (dp0 - dp1);
    t1hi = pD0 + (pD2 - pD0) * dp0 / (dp0 - dp2);
  } else if (sp[1] !== sp[0] && sp[1] !== sp[2]) {
    t1lo = pD1 + (pD0 - pD1) * dp1 / (dp1 - dp0);
    t1hi = pD1 + (pD2 - pD1) * dp1 / (dp1 - dp2);
  } else {
    if (Math.abs(dp0) + Math.abs(dp1) + Math.abs(dp2) < EPS) return false;
    const denom0 = dp2 - dp0, denom1 = dp2 - dp1;
    if (Math.abs(denom0) < EPS || Math.abs(denom1) < EPS) return false;
    t1lo = pD2 + (pD0 - pD2) * dp2 / denom0;
    t1hi = pD2 + (pD1 - pD2) * dp2 / denom1;
  }
  if (t1lo > t1hi) { const tmp = t1lo; t1lo = t1hi; t1hi = tmp; }

  // Compute intersection interval for T2 on D
  const sq = [dq0 >= 0 ? 1 : -1, dq1 >= 0 ? 1 : -1, dq2 >= 0 ? 1 : -1];
  let t2lo: number, t2hi: number;
  if (sq[0] !== sq[1] && sq[0] !== sq[2]) {
    t2lo = qD0 + (qD1 - qD0) * dq0 / (dq0 - dq1);
    t2hi = qD0 + (qD2 - qD0) * dq0 / (dq0 - dq2);
  } else if (sq[1] !== sq[0] && sq[1] !== sq[2]) {
    t2lo = qD1 + (qD0 - qD1) * dq1 / (dq1 - dq0);
    t2hi = qD1 + (qD2 - qD1) * dq1 / (dq1 - dq2);
  } else {
    if (Math.abs(dq0) + Math.abs(dq1) + Math.abs(dq2) < EPS) return false;
    const denom0 = dq2 - dq0, denom1 = dq2 - dq1;
    if (Math.abs(denom0) < EPS || Math.abs(denom1) < EPS) return false;
    t2lo = qD2 + (qD0 - qD2) * dq2 / denom0;
    t2hi = qD2 + (qD1 - qD2) * dq2 / denom1;
  }
  if (t2lo > t2hi) { const tmp = t2lo; t2lo = t2hi; t2hi = tmp; }

  // Intervals overlap → triangles intersect
  return t1lo <= t2hi + EPS && t2lo <= t1hi + EPS;
}

// ─── Self-intersection removal for single-shell models ────────────────────────
// For meshes where different parts (e.g. feather + vest) are merged into one
// topological shell, uses the Möller test to find triangles that geometrically
// cross each other (they don't just touch at shared vertices/edges — they
// actually pierce through each other). Removes all crossing triangles.
//
// After removal the mesh has open holes at each crossing zone. FillHoles then
// caps those holes, producing clean boundaries. If the removed zone was the
// ONLY connection between two parts, detectShells will now see them as separate
// shells, enabling multi-color painting in BambuLab / Orca Slicer.
function removeSelfIntersections(
  triangles: Triangle[],
): { triangles: Triangle[]; resolved: number } {
  if (triangles.length < 4) return { triangles, resolved: 0 };

  const n = triangles.length;
  const PREC = 1e4;
  const vk4 = (v: readonly number[]) =>
    `${Math.round(v[0] * PREC)},${Math.round(v[1] * PREC)},${Math.round(v[2] * PREC)}`;

  // Precompute numeric vertex IDs for O(1) adjacency checking
  const vertIDMap = new Map<string, number>();
  let nextVID = 0;
  const triVIDs = new Array<[number, number, number]>(n);
  for (let i = 0; i < n; i++) {
    const { v1, v2, v3 } = triangles[i];
    const gid = (v: readonly number[]): number => {
      const k = vk4(v);
      let id = vertIDMap.get(k);
      if (id === undefined) { id = nextVID++; vertIDMap.set(k, id); }
      return id;
    };
    triVIDs[i] = [gid(v1), gid(v2), gid(v3)];
  }

  const adjacent = (i: number, j: number): boolean => {
    const [ia, ib, ic] = triVIDs[i];
    const [ja, jb, jc] = triVIDs[j];
    return ia===ja||ia===jb||ia===jc||
           ib===ja||ib===jb||ib===jc||
           ic===ja||ic===jb||ic===jc;
  };

  // 3-D spatial hash grid
  const aabb = meshAABB(triangles);
  const GRID = 32;
  const sX = Math.max(1e-9, aabb.maxX - aabb.minX);
  const sY = Math.max(1e-9, aabb.maxY - aabb.minY);
  const sZ = Math.max(1e-9, aabb.maxZ - aabb.minZ);
  const cellIdx = (v: number, span: number, min: number) =>
    Math.max(0, Math.min(GRID - 1, Math.floor((v - min) / span * GRID)));

  const cellTris = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const { v1, v2, v3 } = triangles[i];
    const cxLo = cellIdx(Math.min(v1[0], v2[0], v3[0]), sX, aabb.minX);
    const cxHi = cellIdx(Math.max(v1[0], v2[0], v3[0]), sX, aabb.minX);
    const cyLo = cellIdx(Math.min(v1[1], v2[1], v3[1]), sY, aabb.minY);
    const cyHi = cellIdx(Math.max(v1[1], v2[1], v3[1]), sY, aabb.minY);
    const czLo = cellIdx(Math.min(v1[2], v2[2], v3[2]), sZ, aabb.minZ);
    const czHi = cellIdx(Math.max(v1[2], v2[2], v3[2]), sZ, aabb.minZ);
    for (let cx = cxLo; cx <= cxHi; cx++)
      for (let cy = cyLo; cy <= cyHi; cy++)
        for (let cz = czLo; cz <= czHi; cz++) {
          const key = cx * GRID * GRID + cy * GRID + cz;
          const arr = cellTris.get(key);
          if (arr) arr.push(i); else cellTris.set(key, [i]);
        }
  }

  const toRemove = new Set<number>();
  // Intentionally no global pair-dedup set: storing up to n² pair keys would
  // exhaust memory for large (1M-tri) models. Pairs spanning multiple cells may
  // be checked a few extra times — safe because triTriIntersect is idempotent
  // and the result set absorbs duplicates.
  let pairsChecked = 0;

  for (const cellList of cellTris.values()) {
    if (cellList.length < 2) continue;
    // Cap per-cell density to avoid O(k²) blowup in ultra-dense zones
    const limit = Math.min(cellList.length, 80);
    for (let a = 0; a < limit; a++) {
      const i = cellList[a];
      if (toRemove.has(i)) continue; // already marked — skip inner loop early
      for (let b = a + 1; b < limit; b++) {
        const j = cellList[b];
        if (toRemove.has(j)) continue;
        pairsChecked++;
        if (adjacent(i, j)) continue;
        const T1 = triangles[i], T2 = triangles[j];
        if (triTriIntersect(
          T1.v1 as Vec3, T1.v2 as Vec3, T1.v3 as Vec3,
          T2.v1 as Vec3, T2.v2 as Vec3, T2.v3 as Vec3,
        )) {
          toRemove.add(i);
          toRemove.add(j);
        }
      }
    }
  }

  console.log(
    `[removeSelfIntersections] checked ${pairsChecked} pairs → ` +
    `${toRemove.size} self-intersecting triangles removed`,
  );

  return {
    triangles: triangles.filter((_, i) => !toRemove.has(i)),
    resolved: toRemove.size,
  };
}

function findShells(triangles: Triangle[]): Map<number, number[]> {
  // IMPORTANT: use EDGE-based connectivity, NOT vertex-based.
  //
  // Vertex-based union causes a critical false-negative: in character models, a
  // feather mesh and the vest mesh often share vertex POSITIONS where they touch
  // (their surfaces are coincident at the boundary). Vertex-based union would
  // merge them into one shell → resolveIntersections sees 1 shell → bails out.
  //
  // Edge-based union only merges triangles that share a COMPLETE EDGE (both
  // endpoint vertices match). Two meshes that merely touch at isolated vertex
  // points remain separate shells, which is the correct geometric interpretation.
  const PREC = 1e4;
  const vk = (v: [number, number, number]) =>
    `${Math.round(v[0] * PREC)},${Math.round(v[1] * PREC)},${Math.round(v[2] * PREC)}`;

  const edgeKey = (a: [number, number, number], b: [number, number, number]): string => {
    const ka = vk(a), kb = vk(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  const parent = Array.from({ length: triangles.length }, (_, i) => i);
  const rank = new Array<number>(triangles.length).fill(0);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  };

  // Build edge → list of triangle indices using that edge
  const edgeMap = new Map<string, number[]>();
  for (let i = 0; i < triangles.length; i++) {
    const { v1, v2, v3 } = triangles[i];
    for (const [a, b] of [
      [v1, v2], [v2, v3], [v3, v1],
    ] as [[number, number, number], [number, number, number]][]) {
      const k = edgeKey(a, b);
      const arr = edgeMap.get(k);
      if (arr) arr.push(i); else edgeMap.set(k, [i]);
    }
  }

  // Union triangles that share a FULL EDGE (not just a vertex point)
  for (const idxs of edgeMap.values()) {
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

  const shellList = [...shellMap.values()].sort((a, b) => b.length - a.length);
  const totalTris = triangles.length;
  const largestSize = shellList[0]?.length ?? 0;

  console.log(`[resolveIntersections] found ${shellMap.size} shell(s) in ${totalTris} triangles`);
  for (let s = 0; s < shellList.length; s++) {
    console.log(`  shell ${s}: ${shellList[s].length} triangles`);
  }

  // Detect "dominant-shell" case: one shell holds ≥ 80% of all triangles.
  // This means the parts (feather, vest, etc.) are MERGED into a single
  // connected mesh — the between-shell algorithm won't help. Fall back to
  // geometric self-intersection detection (Möller triangle-triangle test).
  const dominantFraction = largestSize / totalTris;
  const hasDominantShell = dominantFraction >= 0.8;

  const toRemove = new Set<number>();

  if (hasDominantShell) {
    console.log(
      `[resolveIntersections] dominant single shell (${(dominantFraction * 100).toFixed(1)}% of triangles) ` +
      `→ switching to Möller self-intersection detection`,
    );
    // Mark tiny separate shells (floating debris) for removal by object ref
    const tinyShellObjs = new Set<Triangle>();
    for (let s = 1; s < shellList.length; s++) {
      if (shellList[s].length < 100) {
        for (const idx of shellList[s]) tinyShellObjs.add(triangles[idx]);
      }
    }
    // Run geometric self-intersection detection on the full mesh
    const selfResult = removeSelfIntersections(triangles);
    return {
      triangles: selfResult.triangles.filter((t) => !tinyShellObjs.has(t)),
      resolved: selfResult.resolved + tinyShellObjs.size,
    };
  }

  if (shellList.length < 2) return { triangles, resolved: 0 };

  // Multi-shell path: remove faces of shell A that are hidden inside shell B
  const shells = shellList.map((idxs) => {
    const tris = idxs.map((i) => triangles[i]);
    const aabb = meshAABB(tris);
    const gX = new TriGrid(tris, aabb, 0);
    const gY = new TriGrid(tris, aabb, 1);
    const gZ = new TriGrid(tris, aabb, 2);
    return { idxs, tris, aabb, gX, gY, gZ };
  });

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
