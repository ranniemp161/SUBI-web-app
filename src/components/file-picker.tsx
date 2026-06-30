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
        className={`group flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 transition-all ${
          isDragging
            ? "border-blue-500 bg-blue-500/5"
            : "border-foreground/10 hover:border-foreground/20 hover:bg-foreground/[0.02]"
        } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 transition-colors group-hover:bg-blue-500/20">
          <svg
            className="h-6 w-6 text-blue-400"
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

        <span className="text-base font-medium text-foreground">
          {isLoading ? "Creating project..." : "Select a video file"}
        </span>
        <span className="mt-1 text-sm text-foreground/40">
          or drag and drop here — MP4, MOV, WebM
        </span>
        <span className="mt-3 text-xs text-foreground/25">
          MP4, MOV, or WebM up to a few hours long
        </span>
      </button>

      {error && (
        <div
          id="file-picker-error"
          className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          {error}
        </div>
      )}
    </div>
  );
}
