/**
 * Client-side audio waveform extraction for the timeline.
 *
 * Decodes the full audio track via the Web Audio API and reduces it to a
 * fixed number of min/max peak pairs, independent of zoom level — the
 * timeline component samples a subset of these peaks at render time based
 * on the visible time range.
 */
export interface Waveform {
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  duration: number;
}

const DEFAULT_BUCKETS = 4000;

/**
 * Above this size we skip decoding entirely. `decodeAudioData` requires the
 * whole file in memory plus a full PCM copy of the decoded audio, so very
 * large raw footage would exhaust the tab. Better to show "unavailable" than
 * hang/crash. (A streaming/ffmpeg-extracted waveform is the real fix later.)
 */
export const MAX_WAVEFORM_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

export async function extractWaveform(
  file: File,
  buckets = DEFAULT_BUCKETS
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
