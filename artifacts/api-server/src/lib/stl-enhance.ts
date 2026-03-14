import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
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

function vecNorm(a: Vec3): Vec3 {
  const len = vecLen(a);
  if (len < 1e-10) return [0, 0, 0];
  return vecScale(a, 1 / len);
}

function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vertKey(v: Vec3, precision = 6): string {
  return `${v[0].toFixed(precision)},${v[1].toFixed(precision)},${v[2].toFixed(precision)}`;
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  return vecNorm(vecCross(vecSub(v2, v1), vecSub(v3, v1)));
}

function triangleArea(v1: Vec3, v2: Vec3, v3: Vec3): number {
  const cross = vecCross(vecSub(v2, v1), vecSub(v3, v1));
  return vecLen(cross) / 2;
}

export function removeDuplicatesAndDegenerate(triangles: Triangle[]): {
  triangles: Triangle[];
  removedDuplicates: number;
  removedDegenerate: number;
} {
  const seen = new Set<string>();
  const result: Triangle[] = [];
  let removedDuplicates = 0;
  let removedDegenerate = 0;

  for (const tri of triangles) {
    const area = triangleArea(tri.v1, tri.v2, tri.v3);
    if (area < 1e-10) {
      removedDegenerate++;
      continue;
    }

    // Canonical key: sort vertices lexicographically so ABC == BAC etc.
    const keys = [vertKey(tri.v1), vertKey(tri.v2), vertKey(tri.v3)].sort();
    const key = keys.join("|");

    if (seen.has(key)) {
      removedDuplicates++;
      continue;
    }
    seen.add(key);
    result.push(tri);
  }

  return { triangles: result, removedDuplicates, removedDegenerate };
}

export function fixNormals(triangles: Triangle[]): Triangle[] {
  return triangles.map((tri) => {
    const computed = computeNormal(tri.v1, tri.v2, tri.v3);
    const stored = tri.normal;
    const dot = vecDot(computed, stored);

    if (dot < 0 && vecLen(stored) > 1e-10) {
      // Normal is inverted — flip vertex winding
      return {
        normal: computed,
        v1: tri.v1,
        v2: tri.v3,
        v3: tri.v2,
      };
    }

    return { ...tri, normal: computed };
  });
}

export function laplacianSmooth(triangles: Triangle[], iterations: number): Triangle[] {
  if (iterations === 0) return triangles;

  // Build vertex index map
  const keyToIdx = new Map<string, number>();
  const vertices: Vec3[] = [];

  function getOrAddVertex(v: Vec3): number {
    const k = vertKey(v);
    if (keyToIdx.has(k)) return keyToIdx.get(k)!;
    const idx = vertices.length;
    vertices.push([...v]);
    keyToIdx.set(k, idx);
    return idx;
  }

  const faces: [number, number, number][] = triangles.map((tri) => [
    getOrAddVertex(tri.v1),
    getOrAddVertex(tri.v2),
    getOrAddVertex(tri.v3),
  ]);

  const numVerts = vertices.length;

  // Build adjacency
  const neighbors: Set<number>[] = Array.from({ length: numVerts }, () => new Set<number>());

  // Detect boundary vertices: an edge key "a-b" (a<b) that appears only once is a boundary edge
  const edgeCount = new Map<string, number>();
  for (const [a, b, c] of faces) {
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);

    const edges: [number, number][] = [[a, b], [b, c], [a, c]];
    for (const [p, q] of edges) {
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }

  // A vertex is "pinned" (boundary) if any of its edges appears only once
  const pinned = new Uint8Array(numVerts);
  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split("-").map(Number);
      pinned[a] = 1;
      pinned[b] = 1;
    }
  }

  let verts = vertices.map((v) => [...v] as Vec3);

  // Very gentle lambda — keeps detail while reducing only high-freq noise
  const lambda = 0.2;

  for (let iter = 0; iter < iterations; iter++) {
    const newVerts = verts.map((v, i) => {
      // Never move boundary/open-edge vertices — they hold the shape of seams between shells
      if (pinned[i]) return v;
      const nbrs = [...neighbors[i]];
      if (nbrs.length === 0) return v;
      const avg: Vec3 = [0, 0, 0];
      for (const nb of nbrs) {
        avg[0] += verts[nb][0];
        avg[1] += verts[nb][1];
        avg[2] += verts[nb][2];
      }
      const n = nbrs.length;
      return [
        v[0] * (1 - lambda) + (avg[0] / n) * lambda,
        v[1] * (1 - lambda) + (avg[1] / n) * lambda,
        v[2] * (1 - lambda) + (avg[2] / n) * lambda,
      ] as Vec3;
    });
    verts = newVerts;
  }

  return faces.map(([a, b, c]) => {
    const v1 = verts[a];
    const v2 = verts[b];
    const v3 = verts[c];
    return {
      normal: computeNormal(v1, v2, v3),
      v1,
      v2,
      v3,
    };
  });
}
