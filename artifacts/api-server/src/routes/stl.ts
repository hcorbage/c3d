import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { parseStl, writeBinaryStl } from "../lib/stl-parser.js";
import { computeStats } from "../lib/stl-stats.js";
import { removeDuplicatesAndDegenerate, fixNormals, laplacianSmooth } from "../lib/stl-enhance.js";
import { fillHoles } from "../lib/stl-fill-holes.js";
import { detectShells, mergeShells } from "../lib/stl-shells.js";
import { decimateMesh } from "../lib/stl-decimate.js";
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

    const isAdmin = req.user!.isAdmin;
    if (!isAdmin) {
      const [userRow] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      if (!userRow || userRow.credits < 1) {
        res.status(402).json({ error: "Insufficient credits", code: "NO_CREDITS" });
        return;
      }
    }

    const mesh = parseStl(req.file.buffer);
    let triangles = mesh.triangles;

    // Parse options
    const shouldRemoveDuplicates = req.body.removeDuplicates !== "false";
    const shouldFixNormals = req.body.fixNormals !== "false";
    const shouldFillHoles = req.body.fillHoles !== "false";
    const shouldMergeShells = req.body.mergeShells === "true";
    const shouldDecimate = req.body.decimate === "true";
    const decimateRatio = Math.min(0.95, Math.max(0.05, parseFloat(req.body.decimateRatio ?? "0.5") || 0.5));
    const maxHoleSize = Math.min(5000, Math.max(3, parseInt(req.body.maxHoleSize ?? "500", 10) || 500));
    const smoothingIterations = Math.min(20, Math.max(0, parseInt(req.body.smoothingIterations ?? "3", 10) || 0));

    // Compute BEFORE stats
    const beforeStats = computeStats(triangles);

    // Track what was fixed
    const fixes = {
      holesFilled: 0,
      normalsFixed: 0,
      duplicatesRemoved: 0,
      degeneratesRemoved: 0,
      trianglesReduced: 0,
      shellsMerged: 0,
    };

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
      fixes.normalsFixed = before; // all normals recalculated
    }

    if (shouldDecimate) {
      const result = decimateMesh(triangles, 1 - decimateRatio);
      fixes.trianglesReduced = result.trianglesRemoved;
      triangles = result.triangles;
    }

    if (smoothingIterations > 0) {
      triangles = laplacianSmooth(triangles, smoothingIterations);
    }

    // Compute AFTER stats
    const afterStats = computeStats(triangles);

    const outputBuffer = writeBinaryStl(triangles);

    // Deduct 1 credit (non-admin only)
    if (!isAdmin) {
      await db.update(usersTable).set({ credits: sql`${usersTable.credits} - 1` }).where(eq(usersTable.id, req.user!.id));
      await db.insert(creditTransactionsTable).values({
        userId: req.user!.id,
        amount: -1,
        type: "use",
        description: "STL enhancement",
      });
    }

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

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="enhanced.stl"');
    res.setHeader("Content-Length", outputBuffer.length);
    res.setHeader("X-Quality-Report", JSON.stringify(qualityReport));
    res.setHeader("Access-Control-Expose-Headers", "X-Quality-Report");
    res.send(outputBuffer);
  } catch (err) {
    console.error("Enhance error:", err);
    res.status(500).json({ error: "Failed to enhance STL", details: String(err) });
  }
});

export default router;
