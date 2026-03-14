import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import archiver from "archiver";
import { parseStl, writeBinaryStl } from "../lib/stl-parser.js";
import { computeStats } from "../lib/stl-stats.js";
import { removeDuplicatesAndDegenerate, fixNormals, laplacianSmooth, smoothBoundaryLoops } from "../lib/stl-enhance.js";
import { fillHoles } from "../lib/stl-fill-holes.js";
import { detectShells, mergeShells } from "../lib/stl-shells.js";
import { decimateMesh } from "../lib/stl-decimate.js";
import { resolveIntersections } from "../lib/stl-boolean.js";
import { requireAuth } from "../middlewares/auth.js";
import { db, usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post("/stl/stats", upload.single("file"), (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const mesh = parseStl(req.file.buffer);
    const stats = computeStats(mesh.triangles);
    res.json(stats);
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to parse STL", details: String(err) });
  }
});

router.post("/stl/enhance", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const isAdmin = (req as any).user?.isAdmin === true;
    let triangles = parseStl(req.file.buffer).triangles;

    // Parse options
    const shouldRemoveDuplicates = req.body.removeDuplicates !== "false";
    const shouldFixNormals = req.body.fixNormals !== "false";
    const shouldFillHoles = req.body.fillHoles !== "false";
    const shouldMergeShells = req.body.mergeShells === "true";
    const shouldDecimate = req.body.decimate === "true";
    const shouldResolveIntersections = req.body.resolveIntersections === "true";
    const shouldSplitShells = req.body.splitShells === "true";
    const shouldSmoothSeams = req.body.smoothSeams === "true";
    const decimateRatio = Math.min(0.95, Math.max(0.05, parseFloat(req.body.decimateRatio ?? "0.5") || 0.5));
    // Keep maxHoleSize conservative: filling large holes (wings, mouths, sockets)
    // with flat polygon caps creates visible flat black patches in slicers.
    // Default = 30 edges; capped at 200 to avoid destroying open-body models.
    const maxHoleSize = Math.min(200, Math.max(3, parseInt(req.body.maxHoleSize ?? "30", 10) || 30));
    const smoothingIterations = Math.min(20, Math.max(0, parseInt(req.body.smoothingIterations ?? "3", 10) || 0));

    // Credit cost
    const creditCost =
      1 +
      (shouldMergeShells ? 1 : 0) +
      (shouldDecimate ? 1 : 0) +
      (shouldResolveIntersections ? 1 : 0) +
      (shouldSplitShells ? 1 : 0);

    if (!isAdmin) {
      const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
      if (!userRow || userRow.credits < creditCost) {
        res.status(402).json({ error: "Insufficient credits", code: "NO_CREDITS" });
        return;
      }
    }

    // Track what was fixed
    const fixes = {
      holesFilled: 0,
      normalsFixed: 0,
      duplicatesRemoved: 0,
      degeneratesRemoved: 0,
      trianglesReduced: 0,
      shellsMerged: 0,
      intersectionsResolved: 0,
      seamsSmoothed: 0,
    };

    // Compute BEFORE stats
    const beforeStats = computeStats(triangles);

    // ── Resolve intersections FIRST, before any vertex merging ──────────────
    // Must run on original topology so findShells() can distinguish separate
    // shells. Running removeDuplicates first can merge boundary vertices and
    // collapse multiple shells into one, making resolveIntersections a no-op.
    // Also: we must NOT re-fill holes after resolving — those boundary holes
    // are the clean separators BambuLab needs for per-shell painting.
    if (shouldResolveIntersections) {
      const result = resolveIntersections(triangles);
      fixes.intersectionsResolved = result.resolved;
      triangles = result.triangles;
      console.log(`[resolveIntersections] removed ${result.resolved} hidden triangles`);

      // Smooth the open boundary loops left by resolveIntersections — makes the
      // seam lines between shells smooth instead of jagged/zigzagged
      triangles = smoothBoundaryLoops(triangles, 10);
      console.log(`[smoothBoundaryLoops] smoothed boundary seams (10 Taubin iterations)`);
    }

    if (shouldRemoveDuplicates) {
      const result = removeDuplicatesAndDegenerate(triangles);
      fixes.duplicatesRemoved = result.removedDuplicates;
      fixes.degeneratesRemoved = result.removedDegenerate;
      triangles = result.triangles;
    }

    if (shouldFillHoles) {
      const result = fillHoles(triangles, maxHoleSize);
      fixes.holesFilled = result.holesFilled;
      triangles = result.triangles;
    }

    if (shouldMergeShells) {
      const result = mergeShells(triangles);
      fixes.shellsMerged = result.shellsMerged;
      triangles = result.triangles;
    }

    if (shouldFixNormals) {
      const before = triangles.length;
      triangles = fixNormals(triangles);
      fixes.normalsFixed = before;
    }

    if (shouldDecimate) {
      const result = decimateMesh(triangles, 1 - decimateRatio);
      fixes.trianglesReduced = result.trianglesRemoved;
      triangles = result.triangles;
    }

    // Standalone boundary seam smoothing (also auto-runs inside resolveIntersections block above)
    if (shouldSmoothSeams && !shouldResolveIntersections) {
      const before = triangles.length;
      triangles = smoothBoundaryLoops(triangles, 10);
      fixes.seamsSmoothed = before; // just a signal that it ran
      console.log(`[smoothSeams] smoothed all boundary loops`);
    }

    if (smoothingIterations > 0) {
      triangles = laplacianSmooth(triangles, smoothingIterations);
    }

    // Compute AFTER stats
    const afterStats = computeStats(triangles);

    // Deduct credits (non-admin only)
    if (!isAdmin) {
      await db.update(usersTable).set({ credits: sql`${usersTable.credits} - ${creditCost}` }).where(eq(usersTable.id, req.user!.id));
      await db.insert(creditTransactionsTable).values({
        userId: req.user!.id,
        amount: -creditCost,
        type: "use",
        description: [
          `Reparo básico (${creditCost} crédito${creditCost > 1 ? "s" : ""})`,
          shouldMergeShells ? "mesclar cascas" : "",
          shouldDecimate ? `decimação ${Math.round(decimateRatio * 100)}%` : "",
          shouldResolveIntersections ? "resolver interseções" : "",
          shouldSplitShells ? "separar partes" : "",
        ].filter(Boolean).join(" + "),
      });
    }

    // Detect merged-shell warning: one shell holds ≥ 90% of all triangles.
    // Resolve Intersections can only separate geometrically DISTINCT overlapping
    // shells (e.g., ring placed inside sphere). If parts are welded into one mesh,
    // it cannot help — user must use Blender / MeshLab to split manually.
    const totalTrisForWarning = triangles.length;
    const { shells: shellsForWarning } = detectShells(triangles);
    const largestShellFraction =
      totalTrisForWarning > 0
        ? (shellsForWarning.reduce((m, s) => Math.max(m, s.length), 0) / totalTrisForWarning)
        : 0;
    const mergedShellWarning = largestShellFraction >= 0.9 && shellsForWarning.length > 0;

    // Build quality report
    const qualityReport = {
      before: {
        triangles: beforeStats.triangleCount,
        vertices: beforeStats.vertexCount,
        shells: beforeStats.shellCount,
        openEdges: beforeStats.openEdges,
        duplicates: beforeStats.duplicateTriangles,
        degenerates: beforeStats.degenerateTriangles,
        isManifold: beforeStats.isManifold,
        unitWarning: beforeStats.unitWarning,
        mergedShellWarning,
        dimensions: {
          x: +(beforeStats.boundingBox.maxX - beforeStats.boundingBox.minX).toFixed(2),
          y: +(beforeStats.boundingBox.maxY - beforeStats.boundingBox.minY).toFixed(2),
          z: +(beforeStats.boundingBox.maxZ - beforeStats.boundingBox.minZ).toFixed(2),
        },
      },
      after: {
        triangles: afterStats.triangleCount,
        vertices: afterStats.vertexCount,
        shells: afterStats.shellCount,
        openEdges: afterStats.openEdges,
        isManifold: afterStats.isManifold,
        dimensions: {
          x: +(afterStats.boundingBox.maxX - afterStats.boundingBox.minX).toFixed(2),
          y: +(afterStats.boundingBox.maxY - afterStats.boundingBox.minY).toFixed(2),
          z: +(afterStats.boundingBox.maxZ - afterStats.boundingBox.minZ).toFixed(2),
        },
      },
      fixes,
    };

    const exposedHeaders = "X-Quality-Report, X-Parts-Count";

    // ── Split Shells: return a ZIP with one STL per detected shell ────────────
    // IMPORTANT: We detect shells from the RAW input (before removeDuplicates /
    // resolveIntersections) because those operations weld shared boundary vertices
    // across shells, collapsing multiple shells into one from a topology standpoint.
    // Each shell is then repaired individually so the ZIP contains clean, separate files.
    if (shouldSplitShells) {
      const rawTriangles = parseStl(req.file.buffer).triangles;
      const { shells: rawShells, shellCount: detectedCount } = detectShells(rawTriangles);

      // Sort shells largest-first so part_1 is the main body
      rawShells.sort((a, b) => b.length - a.length);

      const partsCount = rawShells.length;
      console.log(`[splitShells] detected ${detectedCount} shell(s) from raw mesh`);

      // Apply basic repair to each shell independently
      const repairedShells = rawShells.map((shellTris, idx) => {
        let repaired = shellTris;

        const dupResult = removeDuplicatesAndDegenerate(repaired);
        repaired = dupResult.triangles;

        // Fill holes per shell (safe because we're not reconnecting shells)
        if (shouldFillHoles) {
          const holeResult = fillHoles(repaired, maxHoleSize);
          repaired = holeResult.triangles;
        }

        if (shouldFixNormals) {
          repaired = fixNormals(repaired);
        }

        if (shouldDecimate) {
          const decimResult = decimateMesh(repaired, 1 - decimateRatio);
          repaired = decimResult.triangles;
        }

        // Smooth the open boundary edges of each shell (the cut seams)
        repaired = smoothBoundaryLoops(repaired, 10);

        if (smoothingIterations > 0) {
          repaired = laplacianSmooth(repaired, smoothingIterations);
        }

        console.log(`[splitShells] shell ${idx + 1}: ${shellTris.length} → ${repaired.length} triangles`);
        return repaired;
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="parts.zip"`);
      res.setHeader("X-Quality-Report", JSON.stringify(qualityReport));
      res.setHeader("X-Parts-Count", String(partsCount));
      res.setHeader("Access-Control-Expose-Headers", exposedHeaders);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err: Error) => { throw err; });
      archive.pipe(res);

      for (let i = 0; i < repairedShells.length; i++) {
        const shellBuf = writeBinaryStl(repairedShells[i]);
        archive.append(shellBuf, { name: `part_${i + 1}.stl` });
      }

      await archive.finalize();
      return;
    }

    // ── Default: single enhanced STL ─────────────────────────────────────────
    const outputBuffer = writeBinaryStl(triangles);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="enhanced.stl"');
    res.setHeader("Content-Length", outputBuffer.length);
    res.setHeader("X-Quality-Report", JSON.stringify(qualityReport));
    res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
    res.send(outputBuffer);

  } catch (err) {
    console.error("Enhance error:", err);
    res.status(500).json({ error: "Failed to enhance STL", details: String(err) });
  }
});

export default router;
