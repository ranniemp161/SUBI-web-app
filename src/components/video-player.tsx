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

    useImperativeHandle(ref, () => ({
      seek(seconds: number) {
        if (videoRef.current) videoRef.current.currentTime = seconds;
      },
      play() {
        videoRef.current?.play();
      },
      pause() {
        videoRef.current?.pause();
      },
      togglePlay() {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) video.play();
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

      function handleTimeUpdate() {
        if (!video) return;
        const skipTo = nextPlaybackTime(edlRef.current, video.currentTime);
        if (skipTo !== null) {
          video.currentTime = skipTo;
        }
        onTimeUpdate?.(video.currentTime);
      }

      const handlePlay = () => onPlayingChange?.(true);
      const handlePause = () => onPlayingChange?.(false);
      const handleMeta = () =>
        onLoadedMetadata?.({ width: video.videoWidth, height: video.videoHeight });

      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("loadedmetadata", handleMeta);
      return () => {
        video.removeEventListener("timeupdate", handleTimeUpdate);
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
          if (video.paused) video.play();
          else video.pause();
        }}
        className={className ?? "h-full w-full cursor-pointer bg-black object-contain"}
      />
    );
  }
);

export default VideoPlayer;
