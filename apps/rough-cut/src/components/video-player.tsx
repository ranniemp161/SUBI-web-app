"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { EDL } from "@/lib/edl";
import { nextPlaybackTime, stopPlaybackTime } from "@/lib/edl";
import { frameToSeconds, secondsToFrame, type VideoFps } from "@/lib/frame-math";

export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Step exactly one source frame back (-1) or forward (+1) at `fps` (spec
   *  0004). Pauses first, seeks to the exact frame boundary, and — where the
   *  browser supports it — confirms the frame actually presented before
   *  reporting. Steps through the real source video, ignoring cuts. */
  stepFrame: (direction: 1 | -1, fps: VideoFps) => void;
  setPlaybackRate: (rate: number) => void;
  setMuted: (muted: boolean) => void;
  requestFullscreen: () => void;
}

export interface VideoMeta {
  width: number;
  height: number;
  /** Decoded duration of the actual media file, in seconds. */
  duration: number;
}

// How far the media engine's currentTime readback may drift from a requested
// seek before we stop treating them as the same instant. Chromium quantizes to
// microseconds (sub-millisecond drift); other engines round to a millisecond
// or two. 20ms stays well below word length (~100ms+), so snapping within it
// can never move the highlight to a different word than the one clicked.
const SEEK_QUANTIZATION_EPS = 0.02;

interface VideoPlayerProps {
  src: string;
  edl: EDL;
  onTimeUpdate?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onLoadedMetadata?: (meta: VideoMeta) => void;
  className?: string;
}

/**
 * Video preview player that automatically skips over "cut" EDL segments
 * during playback, so the user hears the rough cut in real time without
 * rendering. Seeking manually (e.g. clicking a transcript word) is not
 * skip-adjusted — only continuous playback is.
 */
const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    { src, edl, onTimeUpdate, onPlayingChange, onLoadedMetadata, className },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    // Kept in a ref (not state) so the timeupdate handler always reads the
    // latest EDL without needing to re-attach the event listener on every edit.
    const edlRef = useRef(edl);
    edlRef.current = edl;
    // The media engine quantizes currentTime (Chromium: microseconds), so a
    // seek to a repeating-decimal word boundary like 34.96666666666667 reads
    // back a hair BELOW the requested time. Exact comparisons downstream
    // (active-word highlight, findSegmentAt) then resolve to the previous
    // word/segment. Remember the requested time and report it verbatim while
    // the readback sits within the quantization error.
    const pendingSeekRef = useRef<number | null>(null);
    // True while a frame step's paused seek is settling. It tells the rAF/
    // timeupdate sync to report the stepped position as-is and NOT apply the
    // playback cut-skip, so a step lands on the real source frame even inside a
    // cut (spec 0004, AC-13). Cleared when playback resumes, restoring the
    // normal skip behavior (AC-16).
    const steppingRef = useRef(false);

    // video.play() returns a promise that rejects with AbortError if a pause()
    // or seek interrupts it before it resolves. The editor interleaves
    // play/pause/seek constantly, so swallow that benign rejection here.
    const safePlay = (video: HTMLVideoElement) => {
      const result = video.play();
      if (result !== undefined) {
        result.catch((error: DOMException) => {
          if (error.name !== "AbortError") console.error("Video play failed:", error);
        });
      }
    };

    useImperativeHandle(ref, () => ({
      seek(seconds: number) {
        const video = videoRef.current;
        if (!video) return;
        pendingSeekRef.current = seconds;
        video.currentTime = seconds;
      },
      play() {
        if (videoRef.current) safePlay(videoRef.current);
      },
      pause() {
        videoRef.current?.pause();
      },
      togglePlay() {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) safePlay(video);
        else video.pause();
      },
      stepFrame(direction: 1 | -1, fps: VideoFps) {
        const video = videoRef.current;
        if (!video) return;
        // Stepping is a paused precision action.
        if (!video.paused) video.pause();
        steppingRef.current = true;
        // Land on the exact neighbouring frame boundary, computed through the
        // app-wide frame math so it matches export and the rest of the app.
        const currentFrame = secondsToFrame(video.currentTime, fps);
        const targetFrame = Math.max(0, currentFrame + direction);
        const targetTime = frameToSeconds(targetFrame, fps);
        pendingSeekRef.current = targetTime;
        video.currentTime = targetTime;

        // Not in every browser (feature-detected); confirm the frame actually
        // presented before reporting (AC-12), else fall back below (AC-15).
        const rvfc = video.requestVideoFrameCallback as
          | HTMLVideoElement["requestVideoFrameCallback"]
          | undefined;
        if (typeof rvfc === "function") {
          rvfc.call(video, (_now, metadata) => {
            const shown = metadata.mediaTime;
            const time =
              Math.abs(shown - targetTime) <= SEEK_QUANTIZATION_EPS ? targetTime : shown;
            pendingSeekRef.current = time;
            onTimeUpdate?.(time);
          });
        } else {
          // No requestVideoFrameCallback: report the requested frame time now;
          // the seeked/timeupdate sync also reports it via the pending snap.
          // Frame-exact confirmation is unavailable, the step still works (AC-15).
          onTimeUpdate?.(targetTime);
        }
      },
      setPlaybackRate(rate: number) {
        if (videoRef.current) videoRef.current.playbackRate = rate;
      },
      setMuted(muted: boolean) {
        if (videoRef.current) videoRef.current.muted = muted;
      },
      requestFullscreen() {
        videoRef.current?.requestFullscreen?.();
      },
    }));

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      // While playing, drive time updates from a requestAnimationFrame loop
      // instead of the ~4 Hz `timeupdate` event: the playhead and active-word
      // highlight glide at display refresh rate, and a cut segment is skipped
      // within a frame instead of playing up to a quarter second of deleted
      // content first. The `timeupdate` listener stays for paused seeks.
      let frame = 0;
      let lastReported = -1;

      function syncTime() {
        if (!video) return;
        // Snap the readback to the last requested seek while it's within the
        // engine's quantization error, so downstream exact comparisons (the
        // active-word highlight, findSegmentAt) see the precise time the user
        // asked for. Once playback moves on (or a new seek lands elsewhere),
        // the pending value is dropped and the real clock takes over.
        const pending = pendingSeekRef.current;
        let time = video.currentTime;
        if (pending !== null) {
          if (Math.abs(time - pending) <= SEEK_QUANTIZATION_EPS) time = pending;
          else if (!video.seeking) pendingSeekRef.current = null;
        }
        // A frame step reports its exact landing position and never skips a cut
        // (spec 0004, AC-13): report the (pending-snapped) time and bail before
        // the playback stop/skip logic below.
        if (steppingRef.current) {
          if (time !== lastReported) {
            lastReported = time;
            onTimeUpdate?.(time);
          }
          return;
        }
        // A cut with no kept content after it has nowhere to skip to — stop
        // playback at the end of the last kept clip instead of letting the
        // deleted tail (or media past the timeline's end) play through. Only
        // continuous playback stops; a paused manual seek into the tail stands.
        const stopAt = !video.paused ? stopPlaybackTime(edlRef.current, time) : null;
        if (stopAt !== null) {
          video.pause();
          video.currentTime = stopAt;
          time = stopAt;
        }
        const skipTo = stopAt === null ? nextPlaybackTime(edlRef.current, time) : null;
        if (skipTo !== null) {
          // Add 0.01s (10ms) to ensure we land strictly inside the keep segment.
          // Browser media engines can round a precise float down slightly, causing
          // the next frame to still evaluate as inside the cut segment, creating
          // an infinite seek loop where the video appears to "stop on its own".
          video.currentTime = skipTo + 0.01;
          time = skipTo + 0.01;
        }
        if (time !== lastReported) {
          lastReported = time;
          onTimeUpdate?.(time);
        }
      }

      function tick() {
        frame = requestAnimationFrame(tick);
        syncTime();
      }

      const handlePlay = () => {
        // Resuming playback ends any frame-stepping state, so the normal cut-
        // skip behavior takes over again (spec 0004, AC-16).
        steppingRef.current = false;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
        onPlayingChange?.(true);
      };
      const handlePause = () => {
        cancelAnimationFrame(frame);
        onPlayingChange?.(false);
      };
      const handleMeta = () =>
        onLoadedMetadata?.({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        });

      video.addEventListener("timeupdate", syncTime);
      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("loadedmetadata", handleMeta);
      if (!video.paused) handlePlay();
      return () => {
        cancelAnimationFrame(frame);
        video.removeEventListener("timeupdate", syncTime);
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("loadedmetadata", handleMeta);
      };
    }, [onTimeUpdate, onPlayingChange, onLoadedMetadata]);

    return (
      <video
        ref={videoRef}
        src={src}
        onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) safePlay(video);
          else video.pause();
        }}
        className={className ?? "h-full w-full cursor-pointer bg-black object-contain"}
      />
    );
  }
);

export default VideoPlayer;
