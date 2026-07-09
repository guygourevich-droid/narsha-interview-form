// Generate two simple test PNG images using raw PNG encoding
const fs = require('fs');
const path = require('path');

// Minimal 100x100 red PNG and 120x80 blue PNG
// Using a tiny pure-JS PNG encoder (zlib via Node)
const zlib = require('zlib');

function makePNG(width, height, fillRGB) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw image data with filter byte per row
  const rowSize = width * 3;
  const raw = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter: none
    for (let x = 0; x < rowSize; x += 3) {
      raw[y * (rowSize + 1) + 1 + x] = fillRGB[0];
      raw[y * (rowSize + 1) + 1 + x + 1] = fillRGB[1];
      raw[y * (rowSize + 1) + 1 + x + 2] = fillRGB[2];
    }
  }
  const compressed = zlib.deflateSync(raw);

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const dir = path.join(__dirname, 'test-assets');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

fs.writeFileSync(path.join(dir, 'test-id.png'), makePNG(200, 200, [220, 50, 50]));
fs.writeFileSync(path.join(dir, 'test-cert.png'), makePNG(300, 200, [50, 80, 200]));

console.log('Created test images in', dir);