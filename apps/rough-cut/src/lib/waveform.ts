/**
 * Client-side audio waveform extraction for the timeline.
 *
 * Primary path: stream-decode the audio track with mediabunny (the same
 * library the transcription upload uses). It demuxes any common container
 * straight from the File on disk and decodes via WebCodecs chunk by chunk, so
 * memory stays flat regardless of file size and video containers that
 * `decodeAudioData` can't parse (MOV, many MP4 variants) still get a waveform.
 *
 * Fallback path: the old whole-file Web Audio decode, kept for browsers
 * without WebCodecs audio support. It needs the entire file in memory plus a
 * full PCM copy, so it's capped by MAX_WAVEFORM_BYTES.
 *
 * Either way the result is a fixed number of min/max peak pairs, independent
 * of zoom level — the timeline samples a subset at render time.
 */
export interface Waveform {
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  duration: number;
}

const DEFAULT_BUCKETS = 4000;

/**
 * Size cap for the Web Audio fallback only — `decodeAudioData` requires the
 * whole file in memory plus a full PCM copy of the decoded audio, so very
 * large raw footage would exhaust the tab. The streaming mediabunny path has
 * no cap.
 */
export const MAX_WAVEFORM_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

export async function extractWaveform(
  file: File,
  buckets = DEFAULT_BUCKETS
): Promise<Waveform | null> {
  const streamed = await extractWaveformStreaming(file, buckets);
  if (streamed) return streamed;
  return extractWaveformWebAudio(file, buckets);
}

/**
 * Streaming path: demux + decode the audio track chunk by chunk, folding each
 * decoded frame into its time bucket as it arrives. Only ever holds one
 * decoded chunk (~20ms of audio) in memory at a time.
 */
async function extractWaveformStreaming(
  file: File,
  buckets: number
): Promise<Waveform | null> {
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

    const peaksMin = new Float32Array(buckets);
    const peaksMax = new Float32Array(buckets);
    const bucketSeconds = duration / buckets;

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
      // First channel is enough for a timeline overview waveform.
      sample.copyTo(plane, { planeIndex: 0, format: "f32-planar" });

      // Walk the chunk's frames, advancing the bucket at each time boundary
      // instead of dividing per frame — cheap even on hour-long audio.
      const frameSeconds = 1 / sample.sampleRate;
      let t = Math.max(0, sample.timestamp);
      let bucket = Math.min(buckets - 1, Math.floor(t / bucketSeconds));
      let nextBoundary = (bucket + 1) * bucketSeconds;
      for (let i = 0; i < frames; i++) {
        const value = plane[i];
        if (value < peaksMin[bucket]) peaksMin[bucket] = value;
        if (value > peaksMax[bucket]) peaksMax[bucket] = value;
        t += frameSeconds;
        if (t >= nextBoundary && bucket < buckets - 1) {
          bucket++;
          nextBoundary = (bucket + 1) * bucketSeconds;
        }
      }
      sample.close();
    }

    return { peaksMin, peaksMax, duration };
  } catch (error) {
    // Soft-fail into the Web Audio path — a waveform is an enhancement, and
    // the fallback still covers browsers without WebCodecs audio decoding.
    console.warn("Streaming waveform decode failed, trying Web Audio:", error);
    return null;
  }
}

/** Legacy whole-file Web Audio decode — fallback only. */
async function extractWaveformWebAudio(
  file: File,
  buckets: number
): Promise<Waveform | null> {
  if (file.size > MAX_WAVEFORM_BYTES) {
    return null;
  }

  let audioContext: AudioContext | null = null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (audioBuffer.numberOfChannels === 0) return null;

    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(channelData.length / buckets));
    const peaksMin = new Float32Array(buckets);
    const peaksMax = new Float32Array(buckets);

    for (let i = 0; i < buckets; i++) {
      const start = i * samplesPerBucket;
      const end = Math.min(channelData.length, start + samplesPerBucket);
      let min = 0;
      let max = 0;

      for (let j = start; j < end; j++) {
        const value = channelData[j];
        if (value < min) min = value;
        if (value > max) max = value;
      }

      peaksMin[i] = min;
      peaksMax[i] = max;
    }

    return { peaksMin, peaksMax, duration: audioBuffer.duration };
  } catch (error) {
    console.error("Failed to decode audio for waveform:", error);
    return null;
  } finally {
    audioContext?.close();
  }
}
