import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import { requireAuth } from "../middlewares/auth.js";
import { parseStl } from "../lib/stl-parser.js";
import { splitMesh } from "../lib/stl-split.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post(
  "/stl/split",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No STL file uploaded" });
        return;
      }

      const bedX = parseFloat(req.body.bedX) || 256;
      const bedY = parseFloat(req.body.bedY) || 256;
      const bedZ = parseFloat(req.body.bedZ) || 256;
      const targetX = parseFloat(req.body.targetX) || 0;
      const targetY = parseFloat(req.body.targetY) || 0;
      const targetZ = parseFloat(req.body.targetZ) || 0;

      if (bedX <= 0 || bedY <= 0 || bedZ <= 0) {
        res.status(400).json({ error: "Bed dimensions must be greater than 0" });
        return;
      }

      const mesh = parseStl(req.file.buffer);
      if (mesh.triangles.length === 0) {
        res.status(400).json({ error: "Could not parse STL file or empty mesh" });
        return;
      }

      const result = splitMesh(mesh.triangles, {
        bedX, bedY, bedZ,
        targetX: targetX > 0 ? targetX : undefined,
        targetY: targetY > 0 ? targetY : undefined,
        targetZ: targetZ > 0 ? targetZ : undefined,
      });

      if (result.pieces.length === 0) {
        res.status(400).json({ error: "Model fits on one plate — no splitting needed" });
        return;
      }

      const baseName = (req.file.originalname ?? "model").replace(/\.stl$/i, "");

      // Set headers before streaming begins
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}_split.zip"`);
      res.setHeader("X-Piece-Count", String(result.totalPieces));
      res.setHeader("X-Grid-X", String(result.gridX));
      res.setHeader("X-Grid-Y", String(result.gridY));
      res.setHeader("X-Grid-Z", String(result.gridZ));
      res.setHeader("X-Scaled-X", result.scaledSizeX.toFixed(1));
      res.setHeader("X-Scaled-Y", result.scaledSizeY.toFixed(1));
      res.setHeader("X-Scaled-Z", result.scaledSizeZ.toFixed(1));

      const archive = archiver("zip", { zlib: { level: 1 } }); // level 1 = fast, low memory

      // Stream directly to response — no buffering
      archive.pipe(res);

      const readme = [
        `Model: ${baseName}`,
        `Pieces: ${result.totalPieces}`,
        `Grid: ${result.gridX} × ${result.gridY} × ${result.gridZ}`,
        `Scaled size: ${result.scaledSizeX.toFixed(1)} × ${result.scaledSizeY.toFixed(1)} × ${result.scaledSizeZ.toFixed(1)} mm`,
        `Bed size used: ${bedX} × ${bedY} × ${bedZ} mm`,
        ``,
        `Files are named: ${baseName}_X<col>_Y<row>_Z<layer>.stl`,
        `Assemble them in order (X, Y, Z) to reconstruct the full model.`,
      ].join("\n");

      archive.append(readme, { name: "README.txt" });

      for (const piece of result.pieces) {
        archive.append(piece.stlBuffer as Buffer, {
          name: `${baseName}_${piece.label}.stl`,
        });
      }

      await new Promise<void>((resolve, reject) => {
        archive.on("end",   resolve);
        archive.on("error", reject);
        res.on("error",     reject);
        archive.finalize();
      });

      console.log(`[split] ZIP sent: ${result.pieces.length} pieces`);
    } catch (err) {
      console.error("[split] error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to split model" });
      }
    }
  },
);

export default router;
