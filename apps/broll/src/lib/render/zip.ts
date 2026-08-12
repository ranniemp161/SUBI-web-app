/**
 * A minimal ZIP writer, store only (no compression).
 *
 * Written rather than taken as a dependency because the job is narrow and the
 * compression half is worthless here: the payload is MP4, which is already
 * compressed, so deflate would spend CPU to save roughly nothing. What is left
 * is a well specified container of headers and offsets, small enough to own and
 * test.
 *
 * Store only also means extraction is a byte slice, which is why the tests can
 * read the archive back without any library and prove a real round trip.
 *
 * **Not zip64.** Sizes and offsets are 32 bit, so an archive is capped near 4GB
 * and `buildZip` throws rather than silently writing a corrupt file. A batch of
 * clips is megabytes, so the cap is far away, but a truncated field would be a
 * file that looks fine until someone opens it.
 */

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
/** The version that understands store only entries. */
const VERSION_NEEDED = 20;
/** 32 bit ceiling for every size and offset field in a non zip64 archive. */
const MAX_ZIP_BYTES = 0xffffffff;

export interface ZipEntry {
  /** The name inside the archive, including any folder path. */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** CRC-32 as ZIP defines it. Every entry carries one and readers check it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * DOS date and time, which is what ZIP stores.
 *
 * Fixed at a constant rather than read from the clock, so building the same
 * clips twice produces byte identical archives. A timestamp here would be the
 * only thing making two otherwise identical exports differ.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1 January 1980, the earliest DOS date.

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const sized = entries.map((entry) => ({
    ...entry,
    nameBytes: encoder.encode(entry.name),
  }));

  const localSize = sized.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = sized.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
  const total = localSize + centralSize + 22;

  // Checked **before** any CRC is computed. Hashing first would walk every byte
  // of an archive we are about to refuse, which on an oversized input means
  // grinding through gigabytes to reach a thrown error.
  if (total > MAX_ZIP_BYTES || sized.some((e) => e.data.length > MAX_ZIP_BYTES)) {
    throw new Error("This export is too large for a zip file. Render the scenes in smaller groups.");
  }

  const named = sized.map((entry) => ({ ...entry, crc: crc32(entry.data) }));

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;

  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, offset);
    offset += value.length;
  };

  const localOffsets: number[] = [];

  for (const entry of named) {
    localOffsets.push(offset);
    u32(LOCAL_HEADER_SIG);
    u16(VERSION_NEEDED);
    u16(0); // flags
    u16(0); // method: store
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length); // compressed
    u32(entry.data.length); // uncompressed
    u16(entry.nameBytes.length);
    u16(0); // extra length
    bytes(entry.nameBytes);
    bytes(entry.data);
  }

  const centralStart = offset;

  named.forEach((entry, index) => {
    u32(CENTRAL_HEADER_SIG);
    u16(VERSION_NEEDED); // version made by
    u16(VERSION_NEEDED);
    u16(0); // flags
    u16(0); // method: store
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.nameBytes.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(localOffsets[index]);
    bytes(entry.nameBytes);
  });

  u32(END_OF_CENTRAL_SIG);
  u16(0); // this disk
  u16(0); // disk with central directory
  u16(named.length);
  u16(named.length);
  u32(offset - centralStart);
  u32(centralStart);
  u16(0); // comment length

  return out;
}
