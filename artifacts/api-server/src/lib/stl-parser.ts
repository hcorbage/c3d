export interface Triangle {
  normal: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
}

export interface StlMesh {
  triangles: Triangle[];
  isBinary: boolean;
}

function isAsciiStl(buffer: Buffer): boolean {
  const header = buffer.slice(0, 256).toString("ascii", 0, Math.min(256, buffer.length));
  return header.trimStart().startsWith("solid");
}

function parseAsciiStl(data: string): Triangle[] {
  const triangles: Triangle[] = [];
  const lines = data.split(/\r?\n/).map((l) => l.trim());
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("facet normal")) {
      const normalParts = lines[i].split(/\s+/);
      const normal: [number, number, number] = [
        parseFloat(normalParts[2]),
        parseFloat(normalParts[3]),
        parseFloat(normalParts[4]),
      ];
      i += 2; // skip "outer loop"
      const verts: [number, number, number][] = [];
      for (let v = 0; v < 3; v++) {
        if (i < lines.length && lines[i].startsWith("vertex")) {
          const parts = lines[i].split(/\s+/);
          verts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        }
        i++;
      }
      if (verts.length === 3) {
        triangles.push({ normal, v1: verts[0], v2: verts[1], v3: verts[2] });
      }
      i += 2; // skip "endloop" and "endfacet"
    } else {
      i++;
    }
  }
  return triangles;
}

function parseBinaryStl(buffer: Buffer): Triangle[] {
  const triangleCount = buffer.readUInt32LE(80);
  const triangles: Triangle[] = [];
  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    if (offset + 50 > buffer.length) break;
    const normal: [number, number, number] = [
      buffer.readFloatLE(offset),
      buffer.readFloatLE(offset + 4),
      buffer.readFloatLE(offset + 8),
    ];
    const v1: [number, number, number] = [
      buffer.readFloatLE(offset + 12),
      buffer.readFloatLE(offset + 16),
      buffer.readFloatLE(offset + 20),
    ];
    const v2: [number, number, number] = [
      buffer.readFloatLE(offset + 24),
      buffer.readFloatLE(offset + 28),
      buffer.readFloatLE(offset + 32),
    ];
    const v3: [number, number, number] = [
      buffer.readFloatLE(offset + 36),
      buffer.readFloatLE(offset + 40),
      buffer.readFloatLE(offset + 44),
    ];
    triangles.push({ normal, v1, v2, v3 });
    offset += 50;
  }
  return triangles;
}

export function parseStl(buffer: Buffer): StlMesh {
  const ascii = isAsciiStl(buffer);
  if (ascii) {
    return { triangles: parseAsciiStl(buffer.toString("utf-8")), isBinary: false };
  }
  return { triangles: parseBinaryStl(buffer), isBinary: true };
}

export function writeBinaryStl(triangles: Triangle[]): Buffer {
  const buf = Buffer.allocUnsafe(84 + triangles.length * 50);
  buf.fill(0, 0, 80);
  buf.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const tri of triangles) {
    buf.writeFloatLE(tri.normal[0], offset);
    buf.writeFloatLE(tri.normal[1], offset + 4);
    buf.writeFloatLE(tri.normal[2], offset + 8);
    buf.writeFloatLE(tri.v1[0], offset + 12);
    buf.writeFloatLE(tri.v1[1], offset + 16);
    buf.writeFloatLE(tri.v1[2], offset + 20);
    buf.writeFloatLE(tri.v2[0], offset + 24);
    buf.writeFloatLE(tri.v2[1], offset + 28);
    buf.writeFloatLE(tri.v2[2], offset + 32);
    buf.writeFloatLE(tri.v3[0], offset + 36);
    buf.writeFloatLE(tri.v3[1], offset + 40);
    buf.writeFloatLE(tri.v3[2], offset + 44);
    buf.writeUInt16LE(0, offset + 48);
    offset += 50;
  }
  return buf;
}
