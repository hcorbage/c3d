import { Triangle } from "./stl-parser.js";
import archiver from "archiver";
import { PassThrough } from "stream";

/**
 * 3MF generator — BambuStudio / OrcaSlicer / PrusaSlicer compatible
 *
 * Key insight: BambuStudio reads "color data" from the 3MF Materials &
 * Properties extension (xmlns:m). Per the spec, pid/pindex MUST be on
 * each <triangle> element (per-face), not on <object>. Putting it on
 * <object> is treated as a "default" that most slicers silently ignore.
 *
 * Additionally, we include a model_settings.config so BambuStudio
 * pre-assigns each shell to the correct filament extruder slot.
 */

function ensureHash(color: string): string {
  return (color.startsWith("#") ? color : `#${color}`).toUpperCase();
}

// ── Static package files ────────────────────────────────────────────────────

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// ── Model XML builder ────────────────────────────────────────────────────────

function buildModelXml(shells: Triangle[][], colors: string[]): string {
  const safeColors = colors.length > 0 ? colors : ["#CCCCCC"];

  // m:colorgroup — one entry per color
  const colorEntries = safeColors
    .map((c) => `      <m:color color="${ensureHash(c)}"/>`)
    .join("\n");

  let objectsXml = "";
  let itemsXml = "";
  let objectId = 2; // id=1 is reserved for the m:colorgroup

  for (let si = 0; si < shells.length; si++) {
    const shell = shells[si];
    // Cycle through colors if more shells than colors
    const colorIdx = si % safeColors.length;

    // Deduplicate vertices
    const vertMap = new Map<string, number>();
    const verts: [number, number, number][] = [];
    const faces: [number, number, number][] = [];

    for (const tri of shell) {
      const pts: [number, number, number][] = [
        [tri.v1[0], tri.v1[1], tri.v1[2]],
        [tri.v2[0], tri.v2[1], tri.v2[2]],
        [tri.v3[0], tri.v3[1], tri.v3[2]],
      ];
      const vis: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const [x, y, z] = pts[k];
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
        if (!vertMap.has(key)) {
          vertMap.set(key, verts.length);
          verts.push([x, y, z]);
        }
        vis[k] = vertMap.get(key)!;
      }
      faces.push(vis);
    }

    const vertsXml = verts
      .map(([x, y, z]) =>
        `          <vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`
      )
      .join("\n");

    // pid/pindex on EACH triangle (per-face color) — this is the correct 3MF spec usage
    // pid="1" → the m:colorgroup with id="1"
    // pindex="N" → index N inside that colorgroup
    const facesXml = faces
      .map(([a, b, c]) =>
        `          <triangle v1="${a}" v2="${b}" v3="${c}" pid="1" pindex="${colorIdx}"/>`
      )
      .join("\n");

    // Object itself has NO pid/pindex — color is entirely per-face
    objectsXml += `    <object id="${objectId}" name="Shell_${si + 1}" type="model">
      <mesh>
        <vertices>
${vertsXml}
        </vertices>
        <triangles>
${facesXml}
        </triangles>
      </mesh>
    </object>\n`;

    itemsXml += `    <item objectid="${objectId}"/>\n`;
    objectId++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
    <m:colorgroup id="1">
${colorEntries}
    </m:colorgroup>
${objectsXml}  </resources>
  <build>
${itemsXml}  </build>
</model>`;
}

// ── BambuStudio model_settings.config ────────────────────────────────────────
// XML format: maps each object (by 3MF id) to a filament extruder slot.
// This gives BambuStudio the extruder assignment so filament colors apply.

function buildModelSettingsConfig(shellCount: number, colorCount: number): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<config>"];
  for (let si = 0; si < shellCount; si++) {
    const objectId = si + 2; // matches ids in 3dmodel.model (starts at 2)
    const extruder = (si % colorCount) + 1; // 1-based
    lines.push(`  <object id="${objectId}">`);
    lines.push(`    <metadata key="extruder" value="${extruder}"/>`);
    lines.push(`    <metadata key="name" value="Shell_${si + 1}"/>`);
    lines.push(`  </object>`);
  }
  lines.push("</config>");
  return lines.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateThreeMF(
  shells: Triangle[][],
  colors: string[],
): Promise<Buffer> {
  const safeColors = colors.length > 0 ? colors : ["#CCCCCC"];

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const pass = new PassThrough();

    pass.on("data", (chunk: Buffer) => chunks.push(chunk));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);
    archive.on("error", reject);

    archive.pipe(pass);
    archive.append(CONTENT_TYPES_XML, { name: "[Content_Types].xml" });
    archive.append(RELS_XML,          { name: "_rels/.rels" });
    archive.append(buildModelXml(shells, safeColors), { name: "3D/3dmodel.model" });
    archive.append(
      buildModelSettingsConfig(shells.length, safeColors.length),
      { name: "Metadata/model_settings.config" },
    );

    archive.finalize();
  });
}
