import { Triangle } from "./stl-parser.js";
import archiver from "archiver";
import { PassThrough } from "stream";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

function ensureHash(color: string): string {
  return color.startsWith("#") ? color : `#${color}`;
}

function buildModelXml(shells: Triangle[][], colors: string[]): string {
  const safeColors = colors.length > 0 ? colors : ["#CCCCCC"];

  const materialsXml = safeColors
    .map((c, i) => `      <base name="Color ${i + 1}" displaycolor="${ensureHash(c)}"/>`)
    .join("\n");

  let objectsXml = "";
  let itemsXml = "";
  let objectId = 2;

  for (let si = 0; si < shells.length; si++) {
    const shell = shells[si];
    const colorIdx = si < safeColors.length ? si : si % safeColors.length;

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
        const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
        if (!vertMap.has(key)) {
          vertMap.set(key, verts.length);
          verts.push([x, y, z]);
        }
        vis[k] = vertMap.get(key)!;
      }
      faces.push(vis);
    }

    const vertsXml = verts
      .map(([x, y, z]) => `          <vertex x="${x.toFixed(5)}" y="${y.toFixed(5)}" z="${z.toFixed(5)}"/>`)
      .join("\n");

    const facesXml = faces
      .map(([a, b, c]) => `          <triangle v1="${a}" v2="${b}" v3="${c}"/>`)
      .join("\n");

    objectsXml += `    <object id="${objectId}" pid="1" pindex="${colorIdx}" type="model">
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
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="1">
${materialsXml}
    </basematerials>
${objectsXml}  </resources>
  <build>
${itemsXml}  </build>
</model>`;
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
    archive.append(CONTENT_TYPES_XML, { name: "[Content_Types].xml" });
    archive.append(RELS_XML, { name: "_rels/.rels" });
    archive.append(buildModelXml(shells, colors), { name: "3D/3dmodel.model" });

    archive.finalize();
  });
}
