/**
 * Best-effort read of a source file's embedded start timecode — the `tmcd`
 * metadata track many cameras/encoders write (e.g. a clip whose media
 * actually starts at 01:00:00:00, not zero). Used to offset NLE interchange
 * export source timecodes so a strict NLE relink (reel + timecode, DaVinci
 * Resolve's Media Pool match) succeeds instead of only falling back to
 * filename-based linking.
 *
 * mediabunny (used elsewhere for fps detection and MP4 encode/decode) has no
 * concept of a `tmcd` track — it only sees audio/video sample tracks — so
 * this uses mp4box.js instead, which classifies any track it doesn't
 * recognize (tmcd always is) under `movie.tracks` and can hand us that
 * track's raw sample bytes without us hand-parsing stco/stsz/stsc chunk
 * offsets ourselves. mp4box.js has no dedicated tmcd box parser either, so
 * the one sample's 4-byte big-endian frame count is decoded here directly;
 * dividing it by the already-detected fps (see detect-frame-rate.ts) gives
 * the offset in seconds, without needing the tmcd descriptor's own
 * (redundant) internal timescale.
 *
 * Dynamically imports mp4box.js so it never lands in the main bundle — only
 * loaded when a source file is actually reselected. Never throws into the
 * export path: any failure or absence resolves to 0 (no offset), which is
 * exactly today's already-working behavior.
 */
import { nominalFps, type VideoFps } from "@/lib/export/timebase";

// Reject implausible reads (misparsed box, corrupt file) rather than emit a
// nonsense offset into an otherwise-correct export.
const MAX_PLAUSIBLE_OFFSET_SECONDS = 24 * 60 * 60;

export async function detectEmbeddedTimecodeOffset(file: File, fps: VideoFps): Promise<number> {
  try {
    const { createFile } = await import("mp4box");
    const arrayBuffer = await file.arrayBuffer();
    const startFrames = await new Promise<number | null>((resolve) => {
      const isoFile = createFile();
      let settled = false;
      const settle = (value: number | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      isoFile.onError = () => settle(null);
      isoFile.onReady = (movie) => {
        const tmcdTrack = movie.tracks.find((t) => t.codec === "tmcd");
        if (!tmcdTrack) {
          settle(null);
          return;
        }
        isoFile.setExtractionOptions(tmcdTrack.id, undefined, { nbSamples: 1 });
        isoFile.onSamples = (_id, _user, samples) => {
          const sample = samples[0];
          if (!sample?.data || sample.data.length < 4) {
            settle(null);
            return;
          }
          const view = new DataView(sample.data.buffer, sample.data.byteOffset, sample.data.byteLength);
          settle(view.getUint32(0, false)); // SMPTE tmcd sample: big-endian frame count
        };
        isoFile.start();
      };

      // MP4BoxBuffer is just an ArrayBuffer tagged with a `fileStart` byte
      // offset; we hand mp4box.js the whole file as one chunk starting at 0.
      const buffer = Object.assign(arrayBuffer, { fileStart: 0 }) as ArrayBuffer & {
        fileStart: number;
      };
      isoFile.appendBuffer(buffer as never, true);
      isoFile.flush();
    });

    if (startFrames === null || !Number.isFinite(startFrames) || startFrames < 0) return 0;
    const offsetSeconds = startFrames / nominalFps(fps);
    if (!Number.isFinite(offsetSeconds) || offsetSeconds > MAX_PLAUSIBLE_OFFSET_SECONDS) return 0;
    return offsetSeconds;
  } catch {
    return 0;
  }
}
