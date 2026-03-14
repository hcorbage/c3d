import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

function vertKey(v: Vec3, precision = 6): string {
  return `${v[0].toFixed(precision)},${v[1].toFixed(precision)},${v[2].toFixed(precision)}`;
}

export interface ShellInfo {
  shellCount: number;
  shells: Triangle[][];
}

/**
 * Detect connected shells (disconnected components) in the mesh.
 * Uses EDGE-adjacency (two shared vertices) via Union-Find.
 *
 * Edge-based is more accurate than vertex-based for character models:
 * feathers/accessories often share only isolated vertex POINTS with the body
 * mesh (touching but not welded). Vertex-based union merges them into one shell;
 * edge-based correctly identifies them as separate shells.
 */
export function detectShells(triangles: Triangle[]): ShellInfo {
  const n = triangles.length;
  if (n === 0) return { shellCount: 0, shells: [] };

  const edgeKey = (a: Vec3, b: Vec3): string => {
    const ka = vertKey(a), kb = vertKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  // Build edge → triangle index list
  const edgeToTris = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const { v1, v2, v3 } = triangles[i];
    for (const [a, b] of [[v1, v2], [v2, v3], [v3, v1]] as [Vec3, Vec3][]) {
      const k = edgeKey(a, b);
      const arr = edgeToTris.get(k);
      if (arr) arr.push(i); else edgeToTris.set(k, [i]);
    }
  }

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) { parent[ra] = rb; }
    else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
    else { parent[rb] = ra; rank[ra]++; }
  }

  // Union triangles that share a FULL EDGE (not just a vertex point)
  for (const idxs of edgeToTris.values()) {
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  }

  // Group by root
  const groups = new Map<number, Triangle[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(triangles[i]);
  }

  const shells = [...groups.values()].sort((a, b) => b.length - a.length);

  return { shellCount: shells.length, shells };
}

/**
 * Merge all shells into one body by welding vertices within tolerance.
 * Returns triangles with nearby vertices snapped together.
 */
export function mergeShells(triangles: Triangle[], tolerance = 0.01): { triangles: Triangle[]; shellsMerged: number } {
  const { shellCount, shells } = detectShells(triangles);
  if (shellCount <= 1) return { triangles, shellsMerged: 0 };

  // Snap nearby vertices by rounding to grid
  const scale = 1 / tolerance;

  function snapKey(v: Vec3): string {
    return `${Math.round(v[0] * scale)},${Math.round(v[1] * scale)},${Math.round(v[2] * scale)}`;
  }

  const snapMap = new Map<string, Vec3>();

  function snapVert(v: Vec3): Vec3 {
    const k = snapKey(v);
    if (!snapMap.has(k)) snapMap.set(k, v);
    return snapMap.get(k)!;
  }

  const result: Triangle[] = [];
  for (const tri of triangles) {
    const v1 = snapVert(tri.v1 as Vec3);
    const v2 = snapVert(tri.v2 as Vec3);
    const v3 = snapVert(tri.v3 as Vec3);
    result.push({ ...tri, v1, v2, v3 });
  }

  return { triangles: result, shellsMerged: shellCount - 1 };
}
