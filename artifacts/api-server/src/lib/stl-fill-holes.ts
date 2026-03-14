import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

function vertKey(v: Vec3, precision = 5): string {
  return `${v[0].toFixed(precision)},${v[1].toFixed(precision)},${v[2].toFixed(precision)}`;
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
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
  if (len < 1e-10) return [0, 0, 1];
  return vecScale(a, 1 / len);
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  return vecNorm(vecCross(vecSub(v2, v1), vecSub(v3, v1)));
}

export interface FillHolesResult {
  triangles: Triangle[];
  holesFilled: number;
  trianglesAdded: number;
}

export function fillHoles(triangles: Triangle[], maxHoleSize = 500): FillHolesResult {
  // Build vertex index map
  const keyToIdx = new Map<string, number>();
  const vertices: Vec3[] = [];

  function getOrAddVertex(v: Vec3): number {
    const k = vertKey(v);
    if (keyToIdx.has(k)) return keyToIdx.get(k)!;
    const idx = vertices.length;
    vertices.push([...v] as Vec3);
    keyToIdx.set(k, idx);
    return idx;
  }

  const faces: [number, number, number][] = triangles.map((tri) => [
    getOrAddVertex(tri.v1),
    getOrAddVertex(tri.v2),
    getOrAddVertex(tri.v3),
  ]);

  // Find boundary edges: edges that appear only once (not shared by two faces)
  // Key: "minIdx|maxIdx", value: [from, to] in the directed sense
  const edgeFaceCount = new Map<string, number>();
  const directedEdges = new Map<string, [number, number]>();

  for (const [a, b, c] of faces) {
    const edges: [number, number][] = [[a, b], [b, c], [c, a]];
    for (const [from, to] of edges) {
      const undirectedKey = [Math.min(from, to), Math.max(from, to)].join("|");
      edgeFaceCount.set(undirectedKey, (edgeFaceCount.get(undirectedKey) ?? 0) + 1);
      directedEdges.set(`${from}|${to}`, [from, to]);
    }
  }

  // Boundary edges: appear exactly once — collect in directed form
  // The boundary edge is in the direction of the face that owns it
  const boundaryEdgeMap = new Map<number, number[]>(); // from -> [to, ...]

  for (const [from, to] of directedEdges.values()) {
    const undirectedKey = [Math.min(from, to), Math.max(from, to)].join("|");
    if (edgeFaceCount.get(undirectedKey) === 1) {
      if (!boundaryEdgeMap.has(from)) boundaryEdgeMap.set(from, []);
      boundaryEdgeMap.get(from)!.push(to);
    }
  }

  // Trace boundary loops
  const visited = new Set<number>();
  const loops: number[][] = [];

  for (const startV of boundaryEdgeMap.keys()) {
    if (visited.has(startV)) continue;

    const loop: number[] = [];
    let current = startV;
    let safety = 0;

    while (!visited.has(current) && safety < 10000) {
      visited.add(current);
      loop.push(current);
      const nexts = boundaryEdgeMap.get(current);
      if (!nexts || nexts.length === 0) break;
      // Pick next unvisited neighbor, or first
      const next = nexts.find((n) => !visited.has(n)) ?? nexts[0];
      current = next;
      safety++;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  // Fill each loop using ear-clipping fan triangulation from centroid
  const newTriangles: Triangle[] = [...triangles];
  let holesFilled = 0;
  let trianglesAdded = 0;

  for (const loop of loops) {
    if (loop.length < 3 || loop.length > maxHoleSize) continue;

    // Compute centroid of the loop
    let cx = 0, cy = 0, cz = 0;
    for (const vi of loop) {
      const v = vertices[vi];
      cx += v[0]; cy += v[1]; cz += v[2];
    }
    const centroid: Vec3 = [cx / loop.length, cy / loop.length, cz / loop.length];

    // Fan triangulation: connect each edge of the loop to the centroid
    // We need to determine correct winding by checking adjacent face normals
    // Use the average normal of adjacent faces as a guide
    let avgNx = 0, avgNy = 0, avgNz = 0;
    let count = 0;
    for (let i = 0; i < loop.length; i++) {
      const vi = loop[i];
      const vj = loop[(i + 1) % loop.length];
      const edgeKey = `${vi}|${vj}`;
      // Find the face that owns this directed boundary edge
      // Approximate: compute the normal of the patch triangle
      const v1 = vertices[vi];
      const v2 = vertices[vj];
      const n = computeNormal(v1, v2, centroid);
      avgNx += n[0]; avgNy += n[1]; avgNz += n[2];
      count++;
    }
    const avgNormal: Vec3 = vecNorm([avgNx / count, avgNy / count, avgNz / count]);

    for (let i = 0; i < loop.length; i++) {
      const vi = loop[i];
      const vj = loop[(i + 1) % loop.length];
      const v1 = vertices[vi];
      const v2 = vertices[vj];

      const candidateNormal = computeNormal(v1, v2, centroid);
      const dot = candidateNormal[0] * avgNormal[0] + candidateNormal[1] * avgNormal[1] + candidateNormal[2] * avgNormal[2];

      let tri: Triangle;
      if (dot >= 0) {
        tri = { normal: candidateNormal, v1, v2, v3: centroid };
      } else {
        // Flip winding
        const flippedNormal = computeNormal(v1, centroid, v2);
        tri = { normal: flippedNormal, v1, v2: centroid, v3: v2 };
      }

      newTriangles.push(tri);
      trianglesAdded++;
    }

    holesFilled++;
  }

  return { triangles: newTriangles, holesFilled, trianglesAdded };
}
