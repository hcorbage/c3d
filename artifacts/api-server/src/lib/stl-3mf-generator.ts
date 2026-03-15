import { Triangle } from "./stl-parser.js";
import archiver from "archiver";
import { PassThrough } from "stream";

// 3MF content types — must include the materials extension
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

function ensureHash(color: string): string {
  const c = color.startsWith("#") ? color : `#${color}`;
  // Ensure uppercase and 6-digit hex
  return c.toUpperCase();
}

/**
 * Build the 3dmodel.model XML.
 *
 * Uses the official 3MF Materials & Properties extension (xmlns:m) for
 * per-object color assignment, which is supported by BambuStudio,
 * PrusaSlicer, Bambu Handy, and Orca Slicer.
 *
 * Each shell → one <object> with its own color via pid/pindex.
 * All objects are placed at world origin (no transform needed).
 */
function buildModelXml(shells: Triangle[][], colors: string[]): string {
  const safeColors = colors.length > 0 ? colors : ["#CCCCCC"];

  // Color group using the Materials & Properties extension
  const colorEntries = safeColors
    .map((c) => `      <m:color color="${ensureHash(c)}"/>`)
    .join("\n");

  let objectsXml = "";
  let itemsXml = "";
  let objectId = 2; // id=1 is reserved for the colorgroup

  for (let si = 0; si < shells.length; si++) {
    const shell = shells[si];
    const colorIdx = si < safeColors.length ? si : si % safeColors.length;

    // Deduplicate vertices for compact output
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
      .map(([x, y, z]) => `          <vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`)
      .join("\n");

    const facesXml = faces
      .map(([a, b, c]) => `          <triangle v1="${a}" v2="${b}" v3="${c}"/>`)
      .join("\n");

    // pid="1" references the m:colorgroup with id=1; pindex selects the color entry
    objectsXml += `    <object id="${objectId}" name="Shell_${si + 1}" pid="1" pindex="${colorIdx}" type="model">
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
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <m:colorgroup id="1">
${colorEntries}
    </m:colorgroup>
${objectsXml}  </resources>
  <build>
${itemsXml}  </build>
</model>`;
}

/**
 * Build a minimal Bambu/PrusaSlicer-style model_settings.config so that
 * BambuStudio automatically maps each object to the correct filament extruder.
 *
 * Without this config the geometry still shows the right colour in PrusaSlicer/
 * OrcaSlicer (via m:colorgroup), but BambuStudio ignores m:colorgroup on import
 * and relies on extruder_colour / filament_colour in metadata instead.
 */
function buildModelSettingsConfig(shellCount: number, colors: string[]): string {
  const safeColors = colors.length > 0 ? colors : ["#CCCCCC"];
  const objectLines = Array.from({ length: shellCount }, (_, i) => {
    const extruder = (i % safeColors.length) + 1; // 1-based extruder number
    return `[object:Shell_${i + 1}]
extruder = ${extruder}`;
  }).join("\n\n");

  return objectLines;
}

export async function generateThreeMF(
  shells: Triangle[][],
  colors: string[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const pass = new PassThrough();

    pass.on("data", (chunk: Buffer) => chunks.push(chunk));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);
    archive.on("error", reject);

    archive.pipe(pass);
    archive.append(CONTENT_TYPES_XML,                      { name: "[Content_Types].xml" });
    archive.append(RELS_XML,                               { name: "_rels/.rels" });
    archive.append(buildModelXml(shells, colors),          { name: "3D/3dmodel.model" });
    archive.append(buildModelSettingsConfig(shells.length, colors), { name: "Metadata/model_settings.config" });

    archive.finalize();
  });
}
