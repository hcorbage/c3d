import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { parseStl, writeBinaryStl } from "../lib/stl-parser.js";
import { computeStats } from "../lib/stl-stats.js";
import { removeDuplicatesAndDegenerate, fixNormals, laplacianSmooth } from "../lib/stl-enhance.js";
import { fillHoles } from "../lib/stl-fill-holes.js";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

router.post("/stl/stats", upload.single("file"), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const mesh = parseStl(req.file.buffer);
    const stats = computeStats(mesh.triangles);
    res.json(stats);
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to parse STL", details: String(err) });
  }
});

router.post("/stl/enhance", upload.single("file"), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const mesh = parseStl(req.file.buffer);
    let triangles = mesh.triangles;

    const shouldRemoveDuplicates = req.body.removeDuplicates !== "false";
    const shouldFixNormals = req.body.fixNormals !== "false";
    const shouldFillHoles = req.body.fillHoles !== "false";
    const maxHoleSize = Math.min(5000, Math.max(3, parseInt(req.body.maxHoleSize ?? "500", 10) || 500));
    const smoothingIterations = Math.min(
      20,
      Math.max(0, parseInt(req.body.smoothingIterations ?? "3", 10) || 0)
    );

    if (shouldRemoveDuplicates) {
      const result = removeDuplicatesAndDegenerate(triangles);
      triangles = result.triangles;
    }

    if (shouldFillHoles) {
      const result = fillHoles(triangles, maxHoleSize);
      triangles = result.triangles;
      console.log(`Filled ${result.holesFilled} holes, added ${result.trianglesAdded} triangles`);
    }

    if (shouldFixNormals) {
      triangles = fixNormals(triangles);
    }

    if (smoothingIterations > 0) {
      triangles = laplacianSmooth(triangles, smoothingIterations);
    }

    const outputBuffer = writeBinaryStl(triangles);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="enhanced.stl"');
    res.setHeader("Content-Length", outputBuffer.length);
    res.send(outputBuffer);
  } catch (err) {
    console.error("Enhance error:", err);
    res.status(500).json({ error: "Failed to enhance STL", details: String(err) });
  }
});

export default router;
