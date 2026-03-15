import { Triangle } from "./stl-parser.js";
import archiver from "archiver";
import { PassThrough } from "stream";

/**
 * 3MF generator — BambuStudio / OrcaSlicer / PrusaSlicer compatible
 *
 * Strategy for BambuStudio color support:
 *
 * BambuStudio uses the "Standard 3mf Import color" dialog when it finds
 * m:colorgroup with per-face pid/pindex data. That dialog asks the user
 * to map found colors to filament slots. HOWEVER, BambuStudio groups
 * perceptually similar colors into one — so if k-means gives 3 shades of
 * blue it collapses them to "1 color". The fix: use MAXIMALLY DISTINCT
 * vivid colors in the m:colorgroup (regardless of the palette), so
 * BambuStudio always sees N clearly different colors. The user's palette
 * colors are only shown in our own UI as a reference.
 *
 * Additionally each shell is a separate <object> so BambuStudio can
 * individually assign it to a filament slot. model_settings.config
 * pre-assigns each object to extruder 1, 2, 3 … N.
 */

// ── Vivid preset palette ─────────────────────────────────────────────────────
// These are maximally distinct colors BambuStudio will never collapse.
// Ordered to maximize perceptual distance between adjacent entries.
const VIVID_PALETTE = [
  "#E63946", // vivid red
  "#2A9D8F", // teal
  "#E9C46A", // amber yellow
  "#457B9D", // steel blue
  "#F4A261", // warm orange
  "#6A0572", // deep purple
  "#2DC653", // bright green
  "#F72585", // hot pink
  "#4CC9F0", // sky blue
  "#FB8500", // dark orange
  "#023E8A", // dark navy
  "#80B918", // lime green
  "#9B5DE5", // violet
  "#00B4D8", // cyan
  "#D62828", // dark red
  "#06D6A0", // mint
];

function vividColor(index: number): string {
  return VIVID_PALETTE[index % VIVID_PALETTE.length];
}

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

function buildModelXml(shells: Triangle[][], shellCount: number): string {
  // One vivid color per shell — guaranteed distinct for BambuStudio
  const colorEntries = Array.from({ length: shellCount }, (_, i) =>
    `      <m:color color="${ensureHash(vividColor(i))}"/>`,
  ).join("\n");

  let objectsXml = "";
  let itemsXml = "";
  let objectId = 2; // id=1 is the m:colorgroup

  for (let si = 0; si < shells.length; si++) {
    const shell = shells[si];
    const colorIdx = si; // shell i → vivid color i (1:1 mapping)

    // Deduplicate vertices for this shell
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
      .map(
        ([x, y, z]) =>
          `          <vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`,
      )
      .join("\n");

    // pid/pindex on EVERY triangle (per-face color per 3MF Materials spec)
    const facesXml = faces
      .map(
        ([a, b, c]) =>
          `          <triangle v1="${a}" v2="${b}" v3="${c}" pid="1" pindex="${colorIdx}"/>`,
      )
      .join("\n");

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
// Assigns each shell-object to its own extruder slot (1-based).

function buildModelSettingsConfig(shellCount: number): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<config>"];
  for (let si = 0; si < shellCount; si++) {
    const objectId = si + 2;
    const extruder = si + 1; // 1-based, each shell its own extruder
    lines.push(`  <object id="${objectId}">`);
    lines.push(`    <metadata key="extruder" value="${extruder}"/>`);
    lines.push(`    <metadata key="name" value="Shell_${si + 1}"/>`);
    lines.push(`  </object>`);
  }
  lines.push("</config>");
  return lines.join("\n");
}

// ── Shell pre-processing ─────────────────────────────────────────────────────
// Keep only significant shells. Tiny fragment shells (< 1% of the largest)
// are dropped entirely — NOT merged into another shell. Merging disconnected
// geometry causes BambuStudio to report "floating triangles" warnings.

const MAX_SHELLS = 16;
const MIN_SHELL_RATIO = 0.01; // drop shells < 1% size of largest shell

function preprocessShells(shells: Triangle[][]): Triangle[][] {
  if (shells.length === 0) return shells;

  const sorted = [...shells].sort((a, b) => b.length - a.length);
  const maxLen = sorted[0].length;
  const threshold = maxLen * MIN_SHELL_RATIO;

  const significant = sorted.filter(
    (shell, idx) => shell.length >= threshold && idx < MAX_SHELLS,
  );

  const dropped = sorted.length - significant.length;
  if (dropped > 0) {
    console.log(
      `[3mf] dropped ${dropped} fragment shell(s) (< ${(MIN_SHELL_RATIO * 100).toFixed(0)}% of main shell)`,
    );
  }

  return significant.length > 0 ? significant : [sorted[0]];
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateThreeMF(
  rawShells: Triangle[][],
  _colors: string[], // kept for API compat; vivid palette used instead
): Promise<Buffer> {
  const shells = preprocessShells(rawShells);
  const shellCount = shells.length;

  console.log(
    `[3mf] exporting ${shellCount} shell(s) (${rawShells.length} raw) with ${shellCount} vivid colors`,
  );

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
    archive.append(RELS_XML, { name: "_rels/.rels" });
    archive.append(buildModelXml(shells, shellCount), { name: "3D/3dmodel.model" });
    archive.append(buildModelSettingsConfig(shellCount), {
      name: "Metadata/model_settings.config",
    });

    archive.finalize();
  });
}
