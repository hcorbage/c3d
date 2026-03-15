import { Triangle } from "./stl-parser.js";

type Vec3 = [number, number, number];

function vertKey(v: Vec3, precision = 5): string {
  return `${v[0].toFixed(precision)},${v[1].toFixed(precision)},${v[2].toFixed(precision)}`;
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

function vecScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vecNorm(a: Vec3): Vec3 {
  const len = vecLen(a);
  if (len < 1e-10) return [0, 0, 1];
  return vecScale(a, 1 / len);
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  return vecNorm(vecCross(vecSub(v2, v1), vecSub(v3, v1)));
}

/** Approximate area of a polygon (boundary loop) using the shoelace formula on
 *  the dominant plane (projection onto the plane of the average normal). */
function loopArea(loopVerts: Vec3[]): number {
  // Use 3D cross-product area sum
  if (loopVerts.length < 3) return 0;
  const c: Vec3 = [0, 0, 0];
  for (const v of loopVerts) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  c[0] /= loopVerts.length; c[1] /= loopVerts.length; c[2] /= loopVerts.length;

  let area = 0;
  for (let i = 0; i < loopVerts.length; i++) {
    const a = vecSub(loopVerts[i], c);
    const b = vecSub(loopVerts[(i + 1) % loopVerts.length], c);
    area += vecLen(vecCross(a, b));
  }
  return area * 0.5;
}

/** Axis-aligned bounding box of a set of vertices. */
function bbox(verts: Vec3[]): { min: Vec3; max: Vec3; diag: number } {
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < mn[i]) mn[i] = v[i];
      if (v[i] > mx[i]) mx[i] = v[i];
    }
  }
  const diag = vecLen(vecSub(mx, mn));
  return { min: mn, max: mx, diag };
}

export interface FillHolesResult {
  triangles: Triangle[];
  holesFilled: number;
  trianglesAdded: number;
}

export function fillHoles(triangles: Triangle[], maxHoleSize = 500): FillHolesResult {
  if (triangles.length === 0) return { triangles, holesFilled: 0, trianglesAdded: 0 };

  // ── Build vertex index ──────────────────────────────────────────────────────
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

  // ── Compute model bounding box for size validation ─────────────────────────
  const modelBbox = bbox(vertices);
  const modelDiag = Math.max(modelBbox.diag, 1e-6);

  // ── Find boundary edges (appear exactly once) ──────────────────────────────
  const edgeFaceCount = new Map<string, number>();
  const directedEdges = new Map<string, [number, number]>();

  for (const [a, b, c] of faces) {
    for (const [from, to] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const ukey = `${Math.min(from, to)}|${Math.max(from, to)}`;
      edgeFaceCount.set(ukey, (edgeFaceCount.get(ukey) ?? 0) + 1);
      directedEdges.set(`${from}|${to}`, [from, to]);
    }
  }

  // boundaryEdgeMap: vertex → list of next vertices along boundary
  const boundaryEdgeMap = new Map<number, number[]>();

  for (const [from, to] of directedEdges.values()) {
    const ukey = `${Math.min(from, to)}|${Math.max(from, to)}`;
    if (edgeFaceCount.get(ukey) === 1) {
      if (!boundaryEdgeMap.has(from)) boundaryEdgeMap.set(from, []);
      boundaryEdgeMap.get(from)!.push(to);
    }
  }

  // ── Trace boundary loops ───────────────────────────────────────────────────
  const visited = new Set<number>();
  const loops: number[][] = [];

  for (const startV of boundaryEdgeMap.keys()) {
    if (visited.has(startV)) continue;

    const loop: number[] = [];
    let current = startV;
    let safety = 0;
    const MAX_LOOP = Math.min(maxHoleSize * 3, 10_000);

    while (safety < MAX_LOOP) {
      if (visited.has(current)) break;
      visited.add(current);
      loop.push(current);

      const nexts = boundaryEdgeMap.get(current);
      if (!nexts || nexts.length === 0) break;

      // Prefer unvisited next; if none, close the loop back to start
      const nextUnvisited = nexts.find((n) => !visited.has(n));
      if (nextUnvisited !== undefined) {
        current = nextUnvisited;
      } else {
        // Loop is closed (next is startV) or broken — stop either way
        break;
      }
      safety++;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  console.log(
    `[fillHoles] ${loops.length} boundary loop(s); sizes: ${loops
      .map((l) => l.length)
      .sort((a, b) => b - a)
      .slice(0, 10)
      .join(", ")}; maxHoleSize=${maxHoleSize}`,
  );

  // ── Fill each valid loop ───────────────────────────────────────────────────
  const newTriangles: Triangle[] = [...triangles];
  let holesFilled = 0;
  let trianglesAdded = 0;

  for (const loop of loops) {
    // Size guard
    if (loop.length < 3 || loop.length > maxHoleSize) {
      if (loop.length > maxHoleSize) {
        console.log(`[fillHoles] skip loop: ${loop.length} edges > maxHoleSize ${maxHoleSize}`);
      }
      continue;
    }

    const loopVerts = loop.map((vi) => vertices[vi]);
    const loopBbox = bbox(loopVerts);

    // ── Geometry guards: reject loops that are clearly NOT real holes ─────────

    // 1. Span guard: reject if the loop bounding box diagonal is > 40 % of
    //    the whole model diagonal. A real hole is a local feature; a "phantom"
    //    loop created by bad boundary tracing across disconnected parts of the
    //    mesh will span much more of the model.
    const spanRatio = loopBbox.diag / modelDiag;
    if (spanRatio > 0.40) {
      console.log(
        `[fillHoles] skip loop: span ${(spanRatio * 100).toFixed(1)}% of model (likely phantom)`,
      );
      continue;
    }

    // 2. Area guard: reject if the filled area would be > 25% of the model's
    //    cross-section area (approximated as diag²). This catches flat, wide
    //    "cap" triangulations that create the rectangular artifact.
    const area = loopArea(loopVerts);
    const maxArea = 0.25 * modelDiag * modelDiag;
    if (area > maxArea) {
      console.log(
        `[fillHoles] skip loop: area ${area.toFixed(1)} > limit ${maxArea.toFixed(1)} (would create large flat cap)`,
      );
      continue;
    }

    // 3. Compactness guard: if the loop bounding box is very flat/elongated
    //    (one axis near 0) and wide in the other two axes it's almost certainly
    //    a degenerate cross-section cap, not a real hole.
    const extents = [
      loopBbox.max[0] - loopBbox.min[0],
      loopBbox.max[1] - loopBbox.min[1],
      loopBbox.max[2] - loopBbox.min[2],
    ].sort((a, b) => a - b); // [smallest, mid, largest]
    const flatness = extents[0] / Math.max(extents[2], 1e-6);
    if (flatness < 0.01 && extents[2] / modelDiag > 0.2) {
      console.log(`[fillHoles] skip loop: near-flat cross-section (flatness ${flatness.toFixed(4)})`);
      continue;
    }

    // ── Fan triangulation from centroid ───────────────────────────────────────
    let cx = 0, cy = 0, cz = 0;
    for (const v of loopVerts) { cx += v[0]; cy += v[1]; cz += v[2]; }
    const centroid: Vec3 = [cx / loopVerts.length, cy / loopVerts.length, cz / loopVerts.length];

    // Estimate average normal from the fan triangles
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < loop.length; i++) {
      const n = computeNormal(loopVerts[i], loopVerts[(i + 1) % loop.length], centroid);
      nx += n[0]; ny += n[1]; nz += n[2];
    }
    const avgNormal = vecNorm([nx / loop.length, ny / loop.length, nz / loop.length]);

    for (let i = 0; i < loop.length; i++) {
      const v1 = loopVerts[i];
      const v2 = loopVerts[(i + 1) % loop.length];
      const candidateNormal = computeNormal(v1, v2, centroid);
      const dot =
        candidateNormal[0] * avgNormal[0] +
        candidateNormal[1] * avgNormal[1] +
        candidateNormal[2] * avgNormal[2];

      let tri: Triangle;
      if (dot >= 0) {
        tri = { normal: candidateNormal, v1, v2, v3: centroid };
      } else {
        const flippedNormal = computeNormal(v1, centroid, v2);
        tri = { normal: flippedNormal, v1, v2: centroid, v3: v2 };
      }
      newTriangles.push(tri);
      trianglesAdded++;
    }

    holesFilled++;
  }

  console.log(`[fillHoles] filled ${holesFilled} hole(s), added ${trianglesAdded} triangles`);
  return { triangles: newTriangles, holesFilled, trianglesAdded };
}
