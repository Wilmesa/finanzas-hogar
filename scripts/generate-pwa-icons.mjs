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

function png(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 512;
  for (let y = 0; y < size; y += 1) {
    const offset = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const px = x / scale;
      const py = y / scale;
      const radius = Math.hypot(px - 256, py - 256);
      const angle = Math.atan2(py - 256, px - 256);
      let color = [18, 60, 105, 255];
      if (radius >= 105 && radius <= 165) color = [247, 248, 250, 255];
      if (radius >= 105 && radius <= 165 && angle >= -1.25 && angle <= -0.42)
        color = [242, 195, 91, 255];
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
  writeFile(resolve(outputDir, "maskable-512.png"), png(512)),
]);
console.log(`Iconos PWA generados en ${outputDir}`);
