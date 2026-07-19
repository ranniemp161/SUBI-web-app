/**
 * Best-effort detection of a source file's real video frame rate, used to
 * emit frame-accurate timecode in the NLE interchange exports. Reads only the
 * container headers plus the first few hundred packets via mediabunny — no
 * decode, no full-file scan. Returns null (caller falls back to DEFAULT_FPS)
 * rather than throwing: a failed detection should never block an export.
 */
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { snapToStandardFps, type VideoFps } from "@/lib/export/timebase";

const PACKET_SAMPLE_COUNT = 500;

export async function detectVideoFps(file: File): Promise<VideoFps | null> {
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const stats = await track.computePacketStats(PACKET_SAMPLE_COUNT);
    if (!Number.isFinite(stats.averagePacketRate) || stats.averagePacketRate <= 0) return null;
    return snapToStandardFps(stats.averagePacketRate);
  } catch {
    return null;
  }
}
