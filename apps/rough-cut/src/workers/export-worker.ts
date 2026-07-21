import {
  ALL_FORMATS,
  AudioSample,
  BlobSource,
  canEncodeVideo,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type ConversionVideoOptions,
  type StreamTargetChunk,
  type VideoSample,
} from "mediabunny";
import { createGainEnvelope, createTimeRemapper, getKeepRanges, totalKeptSeconds } from "@/lib/export/plan";
import type { ExportErrorCode, ExportRequestMessage, ExportResponseMessage } from "@/lib/export/types";
import type { EDL } from "@/lib/edl";

// The shared tsconfig uses the "dom" lib (needed by the rest of the app),
// which doesn't declare DedicatedWorkerGlobalScope — that only exists under
// "webworker", and the two libs conflict if both are included. Narrow local
// typing for just the worker-global surface this file actually uses.
declare const self: {
  postMessage(message: ExportResponseMessage): void;
  onmessage: ((event: MessageEvent<ExportRequestMessage>) => unknown) | null;
};

function post(message: ExportResponseMessage) {
  self.postMessage(message);
}

let activeConversion: Conversion | null = null;
// Set when a cancel arrives; covers the window before Conversion.init resolves
// (activeConversion is still null then, so cancel() has nothing to act on). The
// pre-execute check in runExport bails on it.
let cancelRequested = false;

self.onmessage = async (event: MessageEvent<ExportRequestMessage>) => {
  const message = event.data;

  if (message.type === "cancel") {
    cancelRequested = true;
    await activeConversion?.cancel();
    return;
  }

  if (message.type !== "start") return;

  cancelRequested = false;

  // The worker owns the write lifecycle: on success it commits the file with
  // close(); on any failure it abort()s, which discards the temporary swap
  // file the File System Access API writes to — leaving the original file
  // (if any) untouched. runExport never closes this itself.
  let writable: FileSystemWritableFileStream | null = null;
  try {
    writable = await message.handle.createWritable();
    await runExport(message.file, message.edl, writable, message.maxHeight);
    await writable.close();
    post({ type: "done" });
  } catch (error) {
    await writable?.abort().catch(() => {});
    post({ type: "error", code: classifyError(error), message: describeError(error) });
  } finally {
    activeConversion = null;
  }
};

async function runExport(
  file: File,
  edl: EDL,
  writable: FileSystemWritableFileStream,
  maxHeight?: number
) {
  const keepRanges = getKeepRanges(edl);
  const totalSeconds = totalKeptSeconds(keepRanges);
  if (keepRanges.length === 0 || totalSeconds <= 0) {
    throw new ExportError("empty-timeline", "There's nothing kept in the timeline to export.");
  }

  const remap = createTimeRemapper(keepRanges);
  const gainAt = createGainEnvelope(keepRanges);

  // Frames/samples outside every kept range are decoded (Conversion walks the
  // source sequentially) but never forwarded to the encoder — this drops the
  // encode cost for cut spans while accepting the decode cost for the whole
  // source. A follow-up could skip decode entirely via lower-level seeking if
  // this proves too slow on long, heavily-cut sources.
  const remapVideoProcess = (sample: VideoSample): VideoSample | null => {
    const t = remap(sample.timestamp);
    if (t === null) return null;
    sample.setTimestamp(t);
    return sample;
  };

  // Same timestamp remap as video, plus a short fade to silence at every cut
  // edge (see AUDIO_FADE_SECONDS / createGainEnvelope): a manual, silence, or
  // retake cut lands at a transcript word's timestamp, which is the ASR's
  // best guess at the boundary, not the true acoustic edge — the fade masks
  // the sliver of the "deleted" word's onset/tail that guess leaves behind.
  const remapAudioProcess = (sample: AudioSample): AudioSample | null => {
    const t = remap(sample.timestamp);
    if (t === null) return null;
    const faded = applyAudioFade(sample, gainAt);
    faded.setTimestamp(t);
    return faded;
  };

  // Wrap the FileSystemWritableFileStream in a plain WritableStream that only
  // forwards writes. StreamTarget locks and closes whatever stream it's given
  // when the conversion finalizes; by handing it this wrapper (not the file
  // stream directly) the file stream stays unlocked and its close()/abort()
  // stay under the worker's control, so the message handler alone decides
  // whether to commit or discard. Chunk shape ({type,data,position}) is
  // exactly what FileSystemWritableFileStream.write() accepts.
  const sink = new WritableStream<StreamTargetChunk>({
    write: (chunk) => writable.write(chunk),
  });

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(sink) });

  // Resolve output video sizing and verify the device can actually encode it,
  // before committing to the (expensive) conversion. Skipped for audio-only
  // sources, which have no primary video track.
  const videoOptions: ConversionVideoOptions = { process: remapVideoProcess };
  const videoTrack = await input.getPrimaryVideoTrack();
  if (videoTrack) {
    const srcW = videoTrack.displayWidth;
    const srcH = videoTrack.displayHeight;
    let outW = srcW;
    let outH = srcH;
    // Downscale (never upscale) to the requested height cap, on even dimensions.
    if (maxHeight && srcH > maxHeight) {
      outH = maxHeight - (maxHeight % 2);
      outW = Math.round(srcW * (outH / srcH));
      outW -= outW % 2;
      // Only the height is set; mediabunny derives width to preserve aspect.
      videoOptions.height = outH;
    }
    // The MP4 output encodes to H.264/AVC; a 4K encode can exceed what a given
    // device's encoder supports. Fail fast with an actionable message rather
    // than deep inside execute().
    if (!(await canEncodeVideo("avc", { width: outW, height: outH }))) {
      throw new ExportError(
        "unsupported-resolution",
        `Your device can't export video at ${outW}×${outH}. Try a lower export resolution.`
      );
    }
  }

  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input,
      output,
      video: videoOptions,
      audio: { process: remapAudioProcess },
    });
  } catch (error) {
    throw new ExportError("unsupported-codec", describeError(error));
  }

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((d) => d.reason).join(", ");
    throw new ExportError(
      "unsupported-codec",
      reasons
        ? `This video's format isn't supported for export (${reasons}).`
        : "This video's format isn't supported for export."
    );
  }

  activeConversion = conversion;

  // A cancel that landed while Conversion.init was still awaiting couldn't act
  // on activeConversion (it was null). Honour it now, before we start encoding.
  // No await sits between this check and execute(), so no cancel can slip past.
  if (cancelRequested) {
    throw new ExportError("cancelled", "Export cancelled.");
  }

  // onProgress fires per output packet — far too often to forward every call
  // (flooding the main thread's toast store trips React's update-depth guard).
  // Post at most once per whole percent.
  let lastPct = -1;
  conversion.onProgress = (progress) => {
    const pct = Math.floor(progress * 100);
    if (pct === lastPct) return;
    lastPct = pct;
    post({ type: "progress", processedSeconds: progress * totalSeconds, totalSeconds });
  };

  await conversion.execute();
}

/**
 * Scale an audio sample's amplitude by `gainAt` evaluated at each frame's own
 * source-timeline timestamp (not the sample's single header timestamp — a
 * ~20ms decoded chunk can itself straddle a cut edge, and the fade needs to
 * land on the real per-frame position). Returns the original sample
 * untouched when every frame in it is at full volume, which is the common
 * case away from any cut.
 */
function applyAudioFade(sample: AudioSample, gainAt: (t: number) => number): AudioSample {
  const { numberOfFrames, numberOfChannels, sampleRate, timestamp } = sample;

  // A range's gain profile is flat 1 in its interior and only ever ramps
  // down approaching an edge — it cannot dip below 1 and climb back to 1
  // within a single sample's short span, so both endpoints reading 1 proves
  // the whole sample does.
  const startGain = gainAt(timestamp);
  const endGain = gainAt(timestamp + (numberOfFrames - 1) / sampleRate);
  if (startGain === 1 && endGain === 1) return sample;

  const data = new Float32Array(numberOfFrames * numberOfChannels);
  sample.copyTo(data, { planeIndex: 0, format: "f32" });

  for (let frame = 0; frame < numberOfFrames; frame++) {
    const g = gainAt(timestamp + frame / sampleRate);
    if (g === 1) continue;
    const base = frame * numberOfChannels;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      data[base + ch] *= g;
    }
  }

  sample.close();
  return new AudioSample({ data, format: "f32", numberOfChannels, sampleRate, timestamp });
}

class ExportError extends Error {
  constructor(
    public code: ExportErrorCode,
    message: string
  ) {
    super(message);
  }
}

function classifyError(error: unknown): ExportErrorCode {
  if (error instanceof ExportError) return error.code;
  if (error instanceof ConversionCanceledError) return "cancelled";
  return "unknown";
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
