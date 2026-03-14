import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/auth.js";
import { parseStl } from "../lib/stl-parser.js";
import { detectShells } from "../lib/stl-shells.js";
import { generateThreeMF } from "../lib/stl-3mf-generator.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * POST /api/stl/colorize
 * Accepts an STL file and a JSON array of hex colors.
 * Detects shells, assigns one color per shell (largest shell → first color),
 * and returns a .3mf file ready for BambuLab / PrusaSlicer.
 */
router.post(
  "/stl/colorize",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No STL file uploaded" });
        return;
      }

      let colors: string[] = [];
      try {
        colors = JSON.parse(req.body.colors ?? "[]");
        if (!Array.isArray(colors)) colors = [];
      } catch {
        colors = [];
      }

      if (colors.length === 0) {
        res.status(400).json({ error: "At least one color is required" });
        return;
      }

      // Parse STL
      const mesh = parseStl(req.file.buffer);
      const triangles = mesh.triangles;
      if (triangles.length === 0) {
        res.status(400).json({ error: "Could not parse STL file or empty mesh" });
        return;
      }

      // Detect shells — sort largest → smallest so the dominant part gets the
      // first (most prominent) color from the reference image
      const { shells } = detectShells(triangles);
      const sortedShells = [...shells].sort((a, b) => b.length - a.length);

      console.log(
        `[colorize] ${sortedShells.length} shell(s) detected; ${colors.length} color(s) provided`,
      );

      // Generate 3MF
      const threeMFBuffer = await generateThreeMF(sortedShells, colors);

      const filename = (req.file.originalname ?? "model").replace(/\.stl$/i, "") + "_colored.3mf";

      res.setHeader("Content-Type", "application/vnd.ms-package.3dmanufacturing-3dmodel+zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Shell-Count", String(sortedShells.length));
      res.setHeader("X-Color-Count", String(colors.length));
      res.send(threeMFBuffer);
    } catch (err) {
      console.error("[colorize] error:", err);
      res.status(500).json({ error: "Failed to generate 3MF" });
    }
  },
);

export default router;
