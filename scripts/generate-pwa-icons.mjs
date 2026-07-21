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
      let color = [18, 38, 31, 255];
      if (Math.hypot(px - 374, py - 138) <= 76) color = [199, 232, 109, 255];
      const stroke = 26;
      const segments = [
        [132 + safe, 358 - safe, 132 + safe, 154 + safe],
        [132 + safe, 154 + safe, 380 - safe, 358 - safe],
        [380 - safe, 358 - safe, 380 - safe, 154 + safe],
      ];
      if (
        segments.some(
          ([ax, ay, bx, by]) =>
            distanceToSegment(px, py, ax, ay, bx, by) <= stroke,
        )
      ) {
        color = [245, 242, 234, 255];
      }
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
