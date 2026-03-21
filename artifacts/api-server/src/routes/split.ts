import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import { PassThrough } from "stream";
import { requireAuth } from "../middlewares/auth.js";
import { parseStl } from "../lib/stl-parser.js";
import { splitMesh } from "../lib/stl-split.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * POST /stl/split
 * Body (multipart):
 *   file      — STL file
 *   bedX/Y/Z  — print bed dimensions in mm
 *   targetX   — (optional) desired final object width in mm
 *   targetY   — (optional) desired final object depth in mm
 *   targetZ   — (optional) desired final object height in mm
 *
 * Returns a ZIP containing one STL per piece.
 */
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

      // Pack all STL pieces into a ZIP
      const baseName = (req.file.originalname ?? "model").replace(/\.stl$/i, "");

      const archive = archiver("zip", { zlib: { level: 6 } });
      const chunks: Buffer[] = [];
      const pass = new PassThrough();

      pass.on("data", (chunk: Buffer) => chunks.push(chunk));

      await new Promise<void>((resolve, reject) => {
        pass.on("end", resolve);
        pass.on("error", reject);
        archive.on("error", reject);

        archive.pipe(pass);

        // README inside the ZIP
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
          archive.append(piece.stlBuffer, {
            name: `${baseName}_${piece.label}.stl`,
          });
        }

        archive.finalize();
      });

      const zipBuffer = Buffer.concat(chunks);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}_split.zip"`);
      res.setHeader("X-Piece-Count", String(result.totalPieces));
      res.setHeader("X-Grid-X", String(result.gridX));
      res.setHeader("X-Grid-Y", String(result.gridY));
      res.setHeader("X-Grid-Z", String(result.gridZ));
      res.setHeader("X-Scaled-X", result.scaledSizeX.toFixed(1));
      res.setHeader("X-Scaled-Y", result.scaledSizeY.toFixed(1));
      res.setHeader("X-Scaled-Z", result.scaledSizeZ.toFixed(1));
      res.send(zipBuffer);
    } catch (err) {
      console.error("[split] error:", err);
      res.status(500).json({ error: "Failed to split model" });
    }
  },
);

export default router;
