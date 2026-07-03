/**
 * Client-side audio extraction for transcription uploads.
 *
 * Deepgram only needs the audio track, but the naive path ships the whole
 * video through our server proxy — a multi-GB upload that saturates the
 * uplink, starves the Node process (stalling unrelated DB queries), and is
 * the prime suspect for long files failing with "corrupt audio". Extracting
 * the audio in the browser first shrinks the upload by ~50-100x (a 23-minute
 * video's AAC track is ~25 MB), which sidesteps all of that without changing
 * the server or storage architecture.
 *
 * Extraction is a lossless remux when possible (no decode/re-encode — the
 * encoded audio samples are copied into an audio-only container), falling
 * back to a WebCodecs transcode only when the source codec doesn't fit the
 * output container. All of it streams from the File on disk; the video track
 * is never read into memory.
 */

export type AudioExtractionResult =
  /** Audio extracted — upload this instead of the full video. */
  | { kind: "audio"; blob: Blob; mimeType: string }
  /** The video has no audio track at all — transcription would be pointless. */
  | { kind: "no-audio" }
  /** Couldn't extract (unsupported container/codec, browser limitation, …). */
  | { kind: "unsupported" };

/**
 * Extract the audio track from a video file into a small audio-only blob.
 *
 * Returns `unsupported` (rather than throwing) on any failure, so callers can
 * fall back to uploading the original file — extraction is an optimization,
 * never a new way to fail.
 */
export async function extractAudioForTranscription(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<AudioExtractionResult> {
  try {
    // Dynamic import so mediabunny stays out of the dashboard's initial
    // bundle — it's only needed once a transcription actually starts.
    const {
      Input,
      Output,
      Conversion,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      ALL_FORMATS,
    } = await import("mediabunny");

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return { kind: "no-audio" };

    // AAC tracks routinely start at a slightly negative timestamp (encoder
    // priming, ~23-45ms). Mediabunny's default conversion start clamps to 0,
    // which makes it think the audio "needs trimming" and silently disquali-
    // fies the lossless copy path — forcing a pointless full transcode (or
    // outright failure where WebCodecs can't decode the codec). Passing the
    // track's real start as an explicit trim start re-enables the copy. The
    // resulting timestamp shift equals the priming offset — inaudible and far
    // below caption precision — so only apply it for such small offsets, not
    // for genuinely delayed audio tracks.
    const firstTimestamp = await audioTrack.getFirstTimestamp();
    const trim =
      firstTimestamp < 0 && firstTimestamp > -0.5
        ? { start: firstTimestamp }
        : undefined;

    // Pick the conventional container for the source codec so the lossless
    // copy lands somewhere Deepgram definitely decodes: AAC/MP3/etc. → .m4a,
    // Opus/Vorbis (WebM sources) → audio-only WebM. Whichever is first fails
    // (e.g. exotic codec), the other is tried before giving up.
    const mp4Attempt = { format: new Mp4OutputFormat(), mimeType: "audio/mp4" };
    const webmAttempt = { format: new WebMOutputFormat(), mimeType: "audio/webm" };
    const attempts =
      audioTrack.codec === "opus" || audioTrack.codec === "vorbis"
        ? [webmAttempt, mp4Attempt]
        : [mp4Attempt, webmAttempt];

    for (const { format, mimeType } of attempts) {
      const target = new BufferTarget();
      const conversion = await Conversion.init({
        input,
        output: new Output({ format, target }),
        video: { discard: true },
        trim,
        showWarnings: false,
      });

      if (!conversion.isValid) continue;

      if (onProgress) {
        conversion.onProgress = (fraction) => onProgress(fraction);
      }

      await conversion.execute();
      if (!target.buffer) continue;

      return { kind: "audio", blob: new Blob([target.buffer], { type: mimeType }), mimeType };
    }

    return { kind: "unsupported" };
  } catch (error) {
    console.warn("Audio extraction failed — falling back to full-file upload:", error);
    return { kind: "unsupported" };
  }
}
