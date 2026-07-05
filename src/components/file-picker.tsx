"use client";

import { useRef, useState, useCallback } from "react";

interface FilePickerProps {
  /** Called when the user selects a valid video file. */
  onFileSelected: (file: File, metadata: VideoMetadata) => void;
  /** Whether the picker is in a loading state (e.g. creating project). */
  isLoading?: boolean;
}

export interface VideoMetadata {
  fileName: string;
  fileSize: number;
  durationMs: number;
}

/**
 * Browser-native file picker for video files.
 *
 * Uses a hidden <input type="file"> and a <video> element to extract
 * metadata (name, size, duration) without uploading anything.
 * The file reference stays in memory — never leaves the user's machine.
 */
export default function FilePicker({
  onFileSelected,
  isLoading = false,
}: FilePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  /** Process a selected file — extract metadata via a hidden video element. */
  const processFile = useCallback(
    (file: File) => {
      setError("");

      // Basic validation
      if (!file.type.startsWith("video/")) {
        setError("Please select a video file.");
        return;
      }

      // Warn for very large files (20 GB+)
      const fileSizeGB = file.size / (1024 * 1024 * 1024);
      if (fileSizeGB > 20) {
        setError(
          `This file is ${fileSizeGB.toFixed(1)} GB. Files over 20 GB may cause browser memory issues during export.`
        );
        // Don't return — let them proceed with a warning
      }

      // Extract duration using a hidden video element
      const video = document.createElement("video");
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        const durationMs = Math.round(video.duration * 1000);
        URL.revokeObjectURL(video.src);

        onFileSelected(file, {
          fileName: file.name,
          fileSize: file.size,
          durationMs,
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        setError(
          "Could not read this video file. Try a different format (MP4, MOV, WebM)."
        );
      };

      video.src = URL.createObjectURL(file);
    },
    [onFileSelected]
  );

  /** Handle file input change. */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  /** Handle drag & drop. */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
        id="video-file-input"
      />

      <button
        id="file-picker-button"
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        disabled={isLoading}
        className={`group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border transition-all duration-300 px-8 py-16 ${
          isDragging
            ? "border-blue-500 bg-blue-500/10 shadow-2xl shadow-blue-500/10"
            : "border-white/10 bg-white/[0.01] hover:border-blue-500/30 hover:bg-blue-500/[0.02] hover:shadow-2xl hover:shadow-blue-500/5"
        } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 transition-all duration-300 group-hover:scale-110 group-hover:bg-blue-500/20 group-hover:border-blue-500/30 group-active:scale-95">
          <svg
            className="h-6 w-6 text-blue-400 transition-transform duration-300 group-hover:-translate-y-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <span className="text-base font-semibold text-white tracking-tight">
          {isLoading ? "Creating project..." : "Select a video file"}
        </span>
        <span className="mt-1 text-sm text-zinc-400">
          or drag and drop here — MP4, MOV, WebM
        </span>
        <span className="mt-3 text-xs text-zinc-600">
          MP4, MOV, or WebM up to a few hours long
        </span>
      </button>

      {error && (
        <div
          id="file-picker-error"
          className="mt-4 flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3.5 text-sm text-red-400 backdrop-blur-md"
        >
          <svg className="h-4 w-4 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
