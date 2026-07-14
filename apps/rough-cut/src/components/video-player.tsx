"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { EDL } from "@/lib/edl";
import { nextPlaybackTime } from "@/lib/edl";

export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setPlaybackRate: (rate: number) => void;
  setMuted: (muted: boolean) => void;
  requestFullscreen: () => void;
}

export interface VideoMeta {
  width: number;
  height: number;
}

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
        if (videoRef.current) videoRef.current.currentTime = seconds;
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
        const skipTo = nextPlaybackTime(edlRef.current, video.currentTime);
        if (skipTo !== null) {
          // Add 0.01s (10ms) to ensure we land strictly inside the keep segment.
          // Browser media engines can round a precise float down slightly, causing
          // the next frame to still evaluate as inside the cut segment, creating
          // an infinite seek loop where the video appears to "stop on its own".
          video.currentTime = skipTo + 0.01;
        }
        if (video.currentTime !== lastReported) {
          lastReported = video.currentTime;
          onTimeUpdate?.(video.currentTime);
        }
      }

      function tick() {
        frame = requestAnimationFrame(tick);
        syncTime();
      }

      const handlePlay = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
        onPlayingChange?.(true);
      };
      const handlePause = () => {
        cancelAnimationFrame(frame);
        onPlayingChange?.(false);
      };
      const handleMeta = () =>
        onLoadedMetadata?.({ width: video.videoWidth, height: video.videoHeight });

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
