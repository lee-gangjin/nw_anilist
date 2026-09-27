import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createIconPNG(size) {
  // Simple uncompressed or deflate PNG generator
  const width = size;
  const height = size;
  
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression method
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace method
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  
  // Image Data: gradient background (Naver Green #00DC64 to AniList Blue #02A9FF)
  // With white book/arrow icon in center
  const rawRows = [];
  const radius = size * 0.22;
  const center = size / 2;
  
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // No filter
    
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      
      // Rounded rect mask
      const dx = Math.max(Math.abs(x - center) - (center - radius), 0);
      const dy = Math.max(Math.abs(y - center) - (center - radius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > radius) {
        // Transparent outside rounded corner
        row[idx] = 0;
        row[idx + 1] = 0;
        row[idx + 2] = 0;
        row[idx + 3] = 0;
        continue;
      }
      
      // Gradient: Top-left #00DC64 (Naver) to Bottom-right #02A9FF (AniList)
      const t = (x + y) / (width + height);
      let r = Math.round(0x00 * (1 - t) + 0x02 * t);
      let g = Math.round(0xDC * (1 - t) + 0xA9 * t);
      let b = Math.round(0x64 * (1 - t) + 0xFF * t);
      let a = 255;
      
      // Inner icon symbol: "N" or sync arrows / book mark
      // Draw centered white badge / 'A' & 'N' motif
      const nx = x / size;
      const ny = y / size;
      
      // White play/read mark or "N" shape
      const inSymbol = 
        (nx > 0.28 && nx < 0.38 && ny > 0.25 && ny < 0.75) || // Left bar
        (nx > 0.62 && nx < 0.72 && ny > 0.25 && ny < 0.75) || // Right bar
        (nx >= 0.35 && nx <= 0.65 && Math.abs(ny - (0.25 + (nx - 0.35) * (0.5 / 0.3))) < 0.08); // Diagonal
        
      if (inSymbol) {
        r = 255;
        g = 255;
        b = 255;
      }
      
      row[idx] = r;
      row[idx + 1] = g;
      row[idx + 2] = b;
      row[idx + 3] = a;
    }
    rawRows.push(row);
  }
  
  const rawData = Buffer.concat(rawRows);
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  
  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = data.length;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(len, 0);
  
  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  
  return Buffer.concat([lenBuf, body, crcBuf]);
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const iconsDir = path.resolve('icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const pngBuf = createIconPNG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated icon${size}.png (${pngBuf.length} bytes)`);
});
