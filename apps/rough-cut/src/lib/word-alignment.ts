/**
 * Client-side word boundary timestamp refinement (spec
 * 0003-word-boundary-timestamp-refinement).
 *
 * Deepgram's word timestamps are a good estimate, not an exact measurement.
 * This module tightens each word's `start`/`end` against the real decoded
 * audio: a fine-grained energy envelope of the reselected source file, then a
 * local search near each word's reported timestamp for the nearest real
 * speech boundary in that envelope. No vendor call, no network — the whole
 * pass runs on audio already local to the browser.
 *
 * Mirrors `waveform.ts`'s streaming mediabunny decode shape (dynamic import,
 * one decoded chunk in memory at a time, soft-fail to null) so both share the
 * same non-blocking behavior; unlike that module there is no fallback decode
 * path, since a failed decode here should simply skip refinement, not degrade
 * to a slower alternative.
 */
import type { EDL, TranscriptWord } from "./edl";

/** How far, in seconds, each side of Deepgram's reported timestamp to search. */
export const SEARCH_WINDOW_SECONDS = 0.15;

/** Energy envelope resolution. Fine enough to localize a boundary to a few ms. */
const ENVELOPE_BUCKET_SECONDS = 0.005;

/** A crossing must hold for this long, continuously, to count as confident. */
const MIN_HOLD_SECONDS = 0.015;

/** Threshold is this fraction of the search window's own min-to-max range. */
const THRESHOLD_RATIO = 0.3;

/** Words are searched in batches, yielding to the main thread between them. */
const WORD_BATCH_SIZE = 500;

export interface EnergyEnvelope {
  /** Per-bucket RMS amplitude of the first audio channel. */
  rms: Float32Array;
  bucketSeconds: number;
  duration: number;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One streaming pass over the reselected source file's audio track, folding
 * it into a fixed 5ms-resolution RMS energy envelope. Only ever holds one
 * decoded chunk in memory at a time, same as `extractWaveformStreaming`.
 */
export async function computeEnergyEnvelope(
  file: File
): Promise<EnergyEnvelope | null> {
  try {
    // Dynamic import to keep mediabunny out of the initial studio bundle.
    const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } = await import(
      "mediabunny"
    );

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!(await track.canDecode())) return null;

    const duration = await input.computeDuration();
    if (!(duration > 0)) return null;

    const buckets = Math.max(1, Math.ceil(duration / ENVELOPE_BUCKET_SECONDS));
    const sumSquares = new Float64Array(buckets);
    const counts = new Uint32Array(buckets);

    const sink = new AudioSampleSink(track);
    let plane: Float32Array | null = null;

    for await (const sample of sink.samples()) {
      const frames = sample.numberOfFrames;
      if (frames === 0) {
        sample.close();
        continue;
      }
      // Reuse one scratch buffer across chunks; grow only when needed.
      if (!plane || plane.length < frames) plane = new Float32Array(frames);
      // First channel is enough — this is an amplitude envelope, not audio.
      sample.copyTo(plane, { planeIndex: 0, format: "f32-planar" });

      // Walk the chunk's frames, advancing the bucket at each time boundary
      // instead of dividing per frame — cheap even on hour-long audio.
      const frameSeconds = 1 / sample.sampleRate;
      let t = Math.max(0, sample.timestamp);
      let bucket = Math.min(buckets - 1, Math.floor(t / ENVELOPE_BUCKET_SECONDS));
      let nextBoundary = (bucket + 1) * ENVELOPE_BUCKET_SECONDS;
      for (let i = 0; i < frames; i++) {
        const value = plane[i];
        sumSquares[bucket] += value * value;
        counts[bucket] += 1;
        t += frameSeconds;
        if (t >= nextBoundary && bucket < buckets - 1) {
          bucket++;
          nextBoundary = (bucket + 1) * ENVELOPE_BUCKET_SECONDS;
        }
      }
      sample.close();
    }

    const rms = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      rms[i] = counts[i] > 0 ? Math.sqrt(sumSquares[i] / counts[i]) : 0;
    }

    return { rms, bucketSeconds: ENVELOPE_BUCKET_SECONDS, duration };
  } catch (error) {
    // A refinement pass is an enhancement, never a requirement — soft-fail so
    // the caller simply skips refinement (AC-7) rather than surfacing an error.
    console.warn("Word boundary energy envelope decode failed:", error);
    return null;
  }
}

/**
 * Searches the window around `reportedTime` for the nearest real speech
 * boundary of the given kind, and returns its time in seconds, or null if no
 * crossing in the window holds confidently (AC-2: no crossing means no
 * refinement, never a guess).
 *
 * "onset" looks for the envelope entering and then holding at speech level
 * (a word's true start); "offset" looks for it leaving and holding below
 * speech level (a word's true end). The threshold is relative to this
 * window's own local amplitude range, never a fixed global value, since
 * recording loudness varies project to project.
 */
function findBoundaryCrossing(
  envelope: EnergyEnvelope,
  reportedTime: number,
  edge: "onset" | "offset"
): number | null {
  const { rms, bucketSeconds } = envelope;
  const windowBins = Math.round(SEARCH_WINDOW_SECONDS / bucketSeconds);
  const holdBins = Math.max(1, Math.round(MIN_HOLD_SECONDS / bucketSeconds));
  const centerBin = Math.round(reportedTime / bucketSeconds);
  const lo = Math.max(0, centerBin - windowBins);
  const hi = Math.min(rms.length - 1, centerBin + windowBins);
  if (hi - lo < holdBins) return null; // window too small (near audio edge)

  let min = Infinity;
  let max = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const v = rms[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return null; // flat window, no usable signal to snap to
  const threshold = min + THRESHOLD_RATIO * (max - min);

  const wantsAbove = edge === "onset";
  let best: number | null = null;
  for (let i = lo; i <= hi - holdBins + 1; i++) {
    // Only the transition point counts — a bucket whose predecessor was
    // already on the wanted side is mid-plateau, not a boundary.
    const predecessorAlreadyThere = i > lo && (rms[i - 1] >= threshold) === wantsAbove;
    if (predecessorAlreadyThere) continue;

    let holds = true;
    for (let k = 0; k < holdBins; k++) {
      const above = rms[i + k] >= threshold;
      if (above !== wantsAbove) {
        holds = false;
        break;
      }
    }
    if (!holds) continue;
    // Nearest transition to Deepgram's own estimate wins — its estimate can
    // be early or late, so bias toward proximity, not scan direction.
    if (best === null || Math.abs(i - centerBin) < Math.abs(best - centerBin)) {
      best = i;
    }
  }
  return best === null ? null : best * bucketSeconds;
}

/**
 * Refines every word's `start`/`end` against the given energy envelope.
 * A word only changes if BOTH its start and end confidently refine to a
 * valid (start < end) result; otherwise it is returned completely untouched
 * (AC-2's "never worse" guarantee) with no `aligned` flag set.
 *
 * Pure and synchronous but for the batch yield — call `computeEnergyEnvelope`
 * first and pass its result in, so this stays unit-testable without decoding
 * real audio.
 */
export async function refineWords(
  envelope: EnergyEnvelope,
  words: TranscriptWord[]
): Promise<TranscriptWord[]> {
  const refined: TranscriptWord[] = new Array(words.length);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const newStart = findBoundaryCrossing(envelope, word.start, "onset");
    const newEnd = findBoundaryCrossing(envelope, word.end, "offset");

    refined[i] =
      newStart !== null && newEnd !== null && newStart < newEnd
        ? { ...word, start: newStart, end: newEnd, aligned: true }
        : { ...word };

    if ((i + 1) % WORD_BATCH_SIZE === 0) {
      await yieldToMainThread();
    }
  }

  return refined;
}

/**
 * Mid-pass edit guard: at write time (after the whole transcript has been
 * searched), re-check the CURRENT EDL — not the one from when the pass
 * started — and revert any word whose span is touched by a manual EDL
 * segment (`reason: "manual"`) back to its pre-refinement timestamp. A cut,
 * trim, or restore the user made while refinement was still running already
 * established that word's boundary correctly; overwriting it here would
 * reintroduce the exact drift bug this pass exists to close. Every other
 * word still refines normally.
 */
export function applyManualEditGuard(
  refined: TranscriptWord[],
  original: TranscriptWord[],
  currentEdl: EDL | null
): TranscriptWord[] {
  const manualSegments = currentEdl?.segments.filter((s) => s.reason === "manual") ?? [];
  if (manualSegments.length === 0) return refined;

  return refined.map((word, i) => {
    const touchedByManualEdit = manualSegments.some(
      (segment) => word.start < segment.end && word.end > segment.start
    );
    return touchedByManualEdit ? original[i] : word;
  });
}

/**
 * End-to-end pass: decode the reselected source file into an energy
 * envelope, then refine every word against it. Returns null if the audio
 * can't be decoded (AC-7) — the caller should leave the project untouched and
 * let the pass retry on the next reselect.
 */
export async function refineTranscriptWords(
  file: File,
  words: TranscriptWord[]
): Promise<TranscriptWord[] | null> {
  const envelope = await computeEnergyEnvelope(file);
  if (!envelope) return null;
  return refineWords(envelope, words);
}
