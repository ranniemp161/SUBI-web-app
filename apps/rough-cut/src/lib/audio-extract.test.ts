// End-to-end tests for client-side audio extraction, run against real media
// files generated with ffmpeg (skipped when ffmpeg isn't installed). The
// lossless remux path is pure JS, so it runs in Node without WebCodecs.
//
// The MP4/AAC case is the regression that matters most: AAC tracks start at a
// slightly negative timestamp (encoder priming), which — without the explicit
// trim in audio-extract.ts — silently disqualifies mediabunny's lossless copy
// path and breaks extraction entirely in environments that can't decode AAC.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAudioForTranscription } from "./audio-extract";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { shell: false }).status === 0;

describe.skipIf(!hasFfmpeg)("extractAudioForTranscription (real files)", () => {
  let dir: string;

  const ffmpeg = (args: string[]) => {
    const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], {
      cwd: dir,
      shell: false,
    });
    expect(result.status).toBe(0);
  };

  const loadAsFile = (name: string, type: string) =>
    new File([readFileSync(join(dir, name))], name, { type });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "audio-extract-test-"));
    const video = ["-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=15"];
    const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=5"];
    ffmpeg([...video, ...tone, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "96k", "with-audio.mp4"]);
    ffmpeg([...video, "-c:v", "libx264", "-preset", "ultrafast", "-an", "no-audio.mp4"]);
    ffmpeg([...video, ...tone, "-c:v", "libvpx", "-c:a", "libopus", "-b:a", "64k", "with-audio.webm"]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("losslessly remuxes the AAC track out of an MP4, dropping the video", async () => {
    const file = loadAsFile("with-audio.mp4", "video/mp4");
    const progress: number[] = [];
    const result = await extractAudioForTranscription(file, (f) => progress.push(f));

    expect(result.kind).toBe("audio");
    if (result.kind !== "audio") return;
    expect(result.mimeType).toBe("audio/mp4");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.size).toBeLessThan(file.size);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("extracts the Opus track from a WebM into an audio-only WebM", async () => {
    const file = loadAsFile("with-audio.webm", "video/webm");
    const result = await extractAudioForTranscription(file);

    expect(result.kind).toBe("audio");
    if (result.kind !== "audio") return;
    expect(result.mimeType).toBe("audio/webm");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.size).toBeLessThan(file.size);
  });

  it("reports no-audio for a video without an audio track", async () => {
    const result = await extractAudioForTranscription(
      loadAsFile("no-audio.mp4", "video/mp4")
    );
    expect(result.kind).toBe("no-audio");
  });

  it("reports unsupported for a non-media file instead of throwing", async () => {
    const junk = new File([new Uint8Array(1024).fill(42)], "junk.mp4", {
      type: "video/mp4",
    });
    expect((await extractAudioForTranscription(junk)).kind).toBe("unsupported");
  });
});
