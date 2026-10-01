import assert from 'node:assert/strict';
import { inflateRawSync, deflateRawSync } from 'node:zlib';

const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function safePath(name) {
  assert.ok(name && !/[\\:\0]/.test(name) && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe ZIP entry path.');
  return name;
}

/** Deterministic ZIPs using only Node; no shell tools or runtime dependencies. */
export function zipEntries(entries) {
  assert.ok(entries.length > 0 && entries.length < 65536, 'Unsupported ZIP entry count.');
  const local = [], central = [], names = new Set();
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(safePath(entry.name), 'utf8');
    assert.ok(!names.has(entry.name), 'Duplicate ZIP entry.');
    names.add(entry.name);
    const bytes = Buffer.from(entry.bytes), compressed = deflateRawSync(bytes), crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x5c21, 12); // 2026-01-01; no contributor timestamps.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x314, 4);
    record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10); record.writeUInt16LE(0x5c21, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** Reads our bounded release format; rejects unsafe paths, corruption and symlinks. */
export function readZip(bytes) {
  assert.ok(bytes.length >= 22 && bytes.length <= 64 * 1024 * 1024, 'Invalid release ZIP size.');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'Missing ZIP directory.');
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12);
  let position = bytes.readUInt32LE(end + 16), total = 0;
  assert.equal(position + directorySize, end, 'Invalid ZIP directory bounds.');
  const entries = [], names = new Set();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(position), 0x02014b50);
    assert.equal(bytes.readUInt16LE(position + 8), 0x800);
    assert.equal(bytes.readUInt16LE(position + 10), 8);
    assert.equal(bytes.readUInt32LE(position + 38) >>> 16, 0o100644, 'ZIP must contain regular files.');
    const compressedSize = bytes.readUInt32LE(position + 20), size = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28), extra = bytes.readUInt16LE(position + 30), comment = bytes.readUInt16LE(position + 32);
    const name = safePath(bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8'));
    assert.ok(!names.has(name), 'Duplicate ZIP entry.'); names.add(name);
    total += size; assert.ok(total <= 100 * 1024 * 1024, 'Release exceeds extraction limit.');
    const localOffset = bytes.readUInt32LE(position + 42);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(localOffset + 6), 0x800);
    assert.equal(bytes.readUInt16LE(localOffset + 8), 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    assert.equal(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8'), name);
    const start = localOffset + 30 + localNameLength + bytes.readUInt16LE(localOffset + 28);
    assert.ok(start + compressedSize <= bytes.readUInt32LE(end + 16), 'Invalid ZIP file bounds.');
    const content = inflateRawSync(bytes.subarray(start, start + compressedSize), { maxOutputLength: Math.max(1, size) });
    assert.equal(content.length, size); assert.equal(crc32(content), bytes.readUInt32LE(position + 16));
    entries.push({ name, bytes: content });
    position += 46 + nameLength + extra + comment;
  }
  assert.equal(position, end);
  return entries;
}
