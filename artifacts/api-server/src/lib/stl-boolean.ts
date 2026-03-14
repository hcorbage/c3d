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

class TriGrid {
  private buckets = new Map<string, Triangle[]>();
  private cellSize: number;
  readonly aabb: AABB;

  constructor(tris: Triangle[], aabb: AABB) {
    this.aabb = aabb;
    const spanY = Math.max(aabb.maxY - aabb.minY, 1e-6);
    const spanZ = Math.max(aabb.maxZ - aabb.minZ, 1e-6);
    this.cellSize = Math.max(spanY, spanZ) / 12;

    for (const tri of tris) {
      const ys = [tri.v1[1], tri.v2[1], tri.v3[1]];
      const zs = [tri.v1[2], tri.v2[2], tri.v3[2]];
      const y0 = Math.floor((Math.min(...ys) - aabb.minY) / this.cellSize);
      const y1 = Math.floor((Math.max(...ys) - aabb.minY) / this.cellSize);
      const z0 = Math.floor((Math.min(...zs) - aabb.minZ) / this.cellSize);
      const z1 = Math.floor((Math.max(...zs) - aabb.minZ) / this.cellSize);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = `${cy},${cz}`;
          const b = this.buckets.get(k);
          if (b) b.push(tri); else this.buckets.set(k, [tri]);
        }
      }
    }
  }

  query(py: number, pz: number): Triangle[] {
    const cy = Math.floor((py - this.aabb.minY) / this.cellSize);
    const cz = Math.floor((pz - this.aabb.minZ) / this.cellSize);
    return this.buckets.get(`${cy},${cz}`) ?? [];
  }
}

function rayTriHit(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  // h = D × e2 where D = (1,0,0) → h = (0, -e2z, e2y)
  const hy = -e2z, hz = e2y;
  const det = e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-10) return false;
  const inv = 1 / det;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const u = (sy * hy + sz * hz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = qx * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-7;
}

function isInsideMesh(px: number, py: number, pz: number, grid: TriGrid): boolean {
  const aabb = grid.aabb;
  if (py < aabb.minY || py > aabb.maxY || pz < aabb.minZ || pz > aabb.maxZ) return false;
  const tris = grid.query(py, pz);
  let hits = 0;
  for (const t of tris) {
    if (rayTriHit(
      px, py, pz,
      t.v1[0], t.v1[1], t.v1[2],
      t.v2[0], t.v2[1], t.v2[2],
      t.v3[0], t.v3[1], t.v3[2],
    )) hits++;
  }
  return hits % 2 === 1;
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
    const grid = new TriGrid(tris, aabb);
    return { idxs, tris, aabb, grid };
  });

  const toRemove = new Set<number>();

  for (let i = 0; i < shells.length; i++) {
    for (let j = i + 1; j < shells.length; j++) {
      const A = shells[i], B = shells[j];
      if (!aabbsOverlap(A.aabb, B.aabb)) continue;

      for (let k = 0; k < A.tris.length; k++) {
        const t = A.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        if (cx > B.aabb.maxX) continue;
        if (isInsideMesh(cx, cy, cz, B.grid)) toRemove.add(A.idxs[k]);
      }

      for (let k = 0; k < B.tris.length; k++) {
        const t = B.tris[k];
        const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
        const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
        const cz = (t.v1[2] + t.v2[2] + t.v3[2]) / 3;
        if (cx > A.aabb.maxX) continue;
        if (isInsideMesh(cx, cy, cz, A.grid)) toRemove.add(B.idxs[k]);
      }
    }
  }

  return {
    triangles: triangles.filter((_, i) => !toRemove.has(i)),
    resolved: toRemove.size,
  };
}
