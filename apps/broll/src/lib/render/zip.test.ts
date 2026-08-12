import { describe, expect, it } from "vitest";
import { buildZip, crc32, type ZipEntry } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * A minimal reader, for the tests only.
 *
 * Store only entries are a byte slice, so the archive can be read back with no
 * library at all. That is what makes this a real round trip rather than a
 * restatement of how the writer works: if an offset or a length is wrong, the
 * read fails here.
 */
function readZip(archive: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();

  // Find the end of central directory record, which is the last 22 bytes when
  // there is no comment.
  const eocd = archive.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(cursor + 28, true);
    const size = view.getUint32(cursor + 24, true);
    const storedCrc = view.getUint32(cursor + 16, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    // Walk into the local header and slice the payload out.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + extraLength;
    const data = archive.subarray(start, start + size);

    // The reader checks the CRC, exactly as a real unzip does.
    expect(crc32(data)).toBe(storedCrc);

    out.push({ name, data });
    cursor += 46 + nameLength;
  }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    // The canonical CRC-32 test vector.
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for empty input and differs for a one bit change", () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(bytes("a"))).not.toBe(crc32(bytes("b")));
  });
});

describe("buildZip", () => {
  const entries: ZipEntry[] = [
    { name: "scene_01__00-00.mp4", data: bytes("first clip bytes") },
    { name: "scene_04__02-35.mp4", data: bytes("second clip, a bit longer") },
  ];

  it("round trips every entry, name and bytes intact", () => {
    const read = readZip(buildZip(entries));
    expect(read).toHaveLength(2);
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i += 1) {
      expect(new TextDecoder().decode(read[i].data)).toBe(
        new TextDecoder().decode(entries[i].data)
      );
    }
  });

  it("stores rather than compresses, so the payload is present verbatim", () => {
    // Method 0 in both headers. Anything else and the byte slice read above
    // would be returning compressed data that happens to be the right length.
    const archive = buildZip(entries);
    const view = new DataView(archive.buffer);
    expect(view.getUint16(8, true)).toBe(0);
  });

  it("writes an empty archive for no entries", () => {
    const archive = buildZip([]);
    expect(archive).toHaveLength(22);
    expect(readZip(archive)).toHaveLength(0);
  });

  it("handles a single entry", () => {
    const read = readZip(buildZip([entries[0]]));
    expect(read).toHaveLength(1);
    expect(read[0].name).toBe(entries[0].name);
  });

  it("handles binary payloads, not just text", () => {
    const binary = new Uint8Array(512);
    for (let i = 0; i < binary.length; i += 1) binary[i] = (i * 7) % 256;
    const read = readZip(buildZip([{ name: "clip.mp4", data: binary }]));
    expect(Array.from(read[0].data)).toEqual(Array.from(binary));
  });

  it("is byte identical when built twice, because no clock is read", () => {
    // A timestamp would be the only thing making two identical exports differ.
    expect(Array.from(buildZip(entries))).toEqual(Array.from(buildZip(entries)));
  });

  it("keeps non ascii names readable", () => {
    const read = readZip(buildZip([{ name: "scène_01.mp4", data: bytes("x") }]));
    expect(read[0].name).toBe("scène_01.mp4");
  });

  it("refuses an archive too large for the format rather than truncating", () => {
    // Every size field is 32 bit. A silently truncated length is a file that
    // looks fine until someone opens it.
    const huge = { name: "big.mp4", data: { length: 0x1_0000_0000 } as unknown as Uint8Array };
    expect(() => buildZip([huge])).toThrow(/too large/i);
  });
});
