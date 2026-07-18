"use client";

import { useRef, useState, useCallback } from "react";

interface FilePickerProps {
  /** Called when the user selects a valid video file. */
  onFileSelected: (file: File, metadata: VideoMetadata) => void;
  /** Whether the picker is in a loading state (e.g. creating project). */
  isLoading?: boolean;
  /**
   * The project's stored duration, on the reselect (reopen) path only. When
   * set, a file whose duration differs by more than the tolerance is blocked
   * outright — the original transcript's timestamps applied to a different
   * video silently corrupt every seek and cut. Absent on initial upload.
   */
  expectedDurationMs?: number;
  expectedFileSize?: number;
  expectedFileName?: string;
  expectedFileType?: string;
}

/**
 * Reselecting the same physical file decodes to the same duration, so real
 * drift only comes from a remux/re-encode of the same content — typically tens
 * to a few hundred ms. 1500ms sits above that noise floor and far below the
 * error of a genuinely wrong video (whole seconds to the entire runtime).
 */
const DURATION_TOLERANCE_MS = 1500;

export interface VideoMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  durationMs: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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
  expectedDurationMs,
  expectedFileSize,
  expectedFileName,
  expectedFileType,
}: FilePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    file: File;
    metadata: VideoMetadata;
  } | null>(null);

  /** Process a selected file — extract metadata via a hidden video element. */
  const processFile = useCallback(
    (file: File) => {
      setError("");
      setWarning("");
      setPendingSelection(null);

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

      const timeoutId = setTimeout(() => {
        URL.revokeObjectURL(video.src);
        video.src = "";
        video.onerror = null;
        video.onloadedmetadata = null;
        setError(
          "Could not read this video file (metadata load timed out). Try a different format."
        );
      }, 8000);

      video.onloadedmetadata = () => {
        clearTimeout(timeoutId);
        const durationMs = Math.round(video.duration * 1000);
        URL.revokeObjectURL(video.src);

        if (
          expectedDurationMs != null &&
          Math.abs(durationMs - expectedDurationMs) > DURATION_TOLERANCE_MS
        ) {
          setError(
            "That video does not match this project. The file you picked is a different length than the original. Reopen this project with the same source video you transcribed, then try again."
          );
          // Clear the input so picking again (even the same file) re-fires
          // the change event and re-runs this check.
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        const metadata: VideoMetadata = {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          durationMs,
        };

        const nameMismatch = expectedFileName != null && file.name !== expectedFileName;
        const sizeMismatch = expectedFileSize != null && file.size !== expectedFileSize;
        const typeMismatch = expectedFileType != null && file.type !== expectedFileType;

        if (nameMismatch || sizeMismatch || typeMismatch) {
          const reasons: string[] = [];
          if (nameMismatch) {
            reasons.push(`filename (expected: "${expectedFileName}", got: "${file.name}")`);
          }
          if (sizeMismatch) {
            reasons.push(`size (expected: ${formatBytes(expectedFileSize)}, got: ${formatBytes(file.size)})`);
          }
          if (typeMismatch) {
            reasons.push(`type (expected: "${expectedFileType}", got: "${file.type}")`);
          }

          setWarning(
            `The selected file does not exactly match this project's metadata: different ${reasons.join(", ")}.`
          );
          setPendingSelection({ file, metadata });
          return;
        }

        onFileSelected(file, metadata);
      };

      video.onerror = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(video.src);
        setError(
          "Could not read this video file. Try a different format (MP4, MOV, WebM)."
        );
      };

      video.src = URL.createObjectURL(file);
    },
    [onFileSelected, expectedDurationMs, expectedFileSize, expectedFileName, expectedFileType]
  );

  const handleConfirmWarning = () => {
    if (pendingSelection) {
      onFileSelected(pendingSelection.file, pendingSelection.metadata);
      setPendingSelection(null);
      setWarning("");
    }
  };

  const handleCancelWarning = () => {
    setPendingSelection(null);
    setWarning("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
            ? "border-[#fffc00] bg-[#fffc00]/10 shadow-2xl shadow-[#fffc00]/10"
            : "border-dashed border-white/20 bg-[#111111] hover:border-[#fffc00]/50 hover:bg-[#fffc00]/[0.05] hover:shadow-2xl hover:shadow-[#fffc00]/10"
        } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#2c2c2c] border border-white/10 transition-all duration-300 group-hover:scale-110 group-active:scale-95 shadow-inner">
          <svg
            className="h-6 w-6 text-[#fffc00] transition-transform duration-300 group-hover:-translate-y-0.5"
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
          Up to a few hours long
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

      {warning && (
        <div
          id="file-picker-warning"
          className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3.5 text-sm text-amber-400 backdrop-blur-md animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-amber-300">Warning: File Mismatch</span>
              <span>{warning}</span>
            </div>
          </div>
          <div className="flex gap-2 pl-6.5">
            <button
              id="file-picker-warning-confirm"
              type="button"
              onClick={handleConfirmWarning}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors"
            >
              Use this file anyway
            </button>
            <button
              id="file-picker-warning-cancel"
              type="button"
              onClick={handleCancelWarning}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 transition-colors"
            >
              Choose different file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
