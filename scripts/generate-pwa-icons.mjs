import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(projectDir, "apps/web/static/icons");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function png(size, maskable = false) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 512;
  const safe = maskable ? 54 : 0;
  for (let y = 0; y < size; y += 1) {
    const offset = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const px = x / scale;
      const py = y / scale;
      let color = [5, 150, 105, 255];
      if (Math.hypot(px - 256, py - 196) <= 58 - safe * 0.15)
        color = [219, 234, 254, 255];
      const bowls = [
        { cy: 244, rx: 150 - safe, ry: 100 - safe * 0.4 },
        { cy: 286, rx: 124 - safe * 0.7, ry: 78 - safe * 0.3 },
        { cy: 330, rx: 92 - safe * 0.5, ry: 54 - safe * 0.2 },
      ];
      if (
        bowls.some(({ cy, rx, ry }) => {
          const normalized = Math.sqrt(
            ((px - 256) / rx) ** 2 + ((py - cy) / ry) ** 2,
          );
          return py >= cy && normalized > 0.88 && normalized < 1.12;
        })
      )
        color = [248, 250, 252, 255];
      if (
        distanceToSegment(
          px,
          py,
          170 + safe,
          176 + safe,
          298 - safe,
          88 + safe,
        ) <= 12
      )
        color = [37, 99, 235, 255];
      const pixel = offset + 1 + x * 4;
      rows.set(color, pixel);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDir, "icon-192.png"), png(192)),
  writeFile(resolve(outputDir, "icon-512.png"), png(512)),
  writeFile(resolve(outputDir, "maskable-512.png"), png(512, true)),
]);
console.log(`Iconos PWA generados en ${outputDir}`);
