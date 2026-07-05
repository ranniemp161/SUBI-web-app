"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { upload } from "@vercel/blob/client";
import FilePicker, { type VideoMetadata } from "@/components/file-picker";
import CreditsPanel, { type CreditsInfo } from "@/components/credits-panel";
import { formatDuration, formatDate } from "@/lib/utils";
import { extractAudioForTranscription } from "@/lib/audio-extract";
import { uploadPathnameForProject } from "@/lib/blob";

interface Project {
  id: string;
  fileName: string;
  durationMs: number | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}

/**
 * Visual treatment for each transcript status, used for the pill badge shown on
 * a project card. `idle` has no badge (null).
 */
const STATUS_META: Record<
  Project["transcriptStatus"],
  { label: string; dot: string; text: string; chip: string } | null
> = {
  idle: null,
  processing: {
    label: "Transcribing",
    dot: "bg-blue-400",
    text: "text-blue-200",
    chip: "bg-blue-500/15 ring-1 ring-inset ring-blue-400/25",
  },
  ready: {
    label: "Ready",
    dot: "bg-emerald-400",
    text: "text-emerald-200",
    chip: "bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/25",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-400",
    text: "text-red-200",
    chip: "bg-red-500/15 ring-1 ring-inset ring-red-400/25",
  },
};

/** Gradient presets for a project card's poster, so the grid feels alive. */
const POSTER_GRADIENTS = [
  "from-blue-500/25 via-indigo-500/10 to-violet-500/25",
  "from-cyan-500/25 via-blue-500/10 to-indigo-500/25",
  "from-violet-500/25 via-fuchsia-500/10 to-blue-500/20",
  "from-emerald-500/20 via-teal-500/10 to-cyan-500/25",
  "from-amber-500/20 via-orange-500/10 to-rose-500/25",
  "from-sky-500/25 via-blue-500/10 to-purple-500/20",
];

/** Deterministically pick a poster gradient from a project id. */
function posterFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return POSTER_GRADIENTS[hash % POSTER_GRADIENTS.length];
}

/**
 * Fetch the caller's credit balance. Returns null on any failure (network,
 * auth, an HTML redirect body instead of JSON) — deliberately side-effect
 * free (no setState) so every call site, including a mount effect, can invoke
 * it directly without tripping react-hooks/set-state-in-effect, and decide
 * for itself what to do with the result.
 */
async function fetchCreditsInfo(): Promise<CreditsInfo | null> {
  try {
    const response = await fetch("/api/credits");
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) return null;
    return (await response.json()) as CreditsInfo;
  } catch (error) {
    console.error("Failed to fetch credits:", error);
    return null;
  }
}

/** Pull the most useful human-readable reason out of a failed API response. */
async function readErrorReason(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.detail || data.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

/**
 * Deepgram path: upload the media straight to Vercel Blob from the browser
 * (bypassing our server for the bytes entirely — Deepgram's pre-recorded REST
 * endpoint isn't CORS-enabled, so the browser can't hand it to Deepgram
 * directly, but Blob's client upload works fine), then tell our server to
 * kick off transcription against that URL. Deepgram fetches the audio itself
 * and posts the finished transcript to /api/transcribe/callback, which the
 * dashboard's polling picks up.
 */
async function startDeepgramTranscription(
  projectId: string,
  media: Blob,
  contentType: string,
  onUploadProgress: (fraction: number) => void
) {
  // Uniqueness comes from the store's addRandomSuffix (set at token issuance),
  // so the pathname is the fixed per-project value the token route enforces.
  const blob = await upload(uploadPathnameForProject(projectId), media, {
    access: "public",
    handleUploadUrl: "/api/transcribe/blob-token",
    clientPayload: JSON.stringify({ projectId }),
    contentType,
    onUploadProgress: ({ percentage }) => onUploadProgress(percentage / 100),
  });

  try {
    const response = await fetch(
      `/api/transcribe/deepgram?projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url }),
      }
    );

    if (!response.ok) {
      // Tagged so the caller can show a "buy credits" action instead of the
      // generic failure copy.
      throw Object.assign(new Error(await readErrorReason(response)), {
        insufficientCredits: response.status === 402,
      });
    }
  } catch (error) {
    // The bytes are already in Blob but the server never learned about them —
    // without this, the blob would sit orphaned until the daily sweep. Best
    // effort only (keepalive lets it outlive a page navigation); the sweep
    // remains the backstop if this request is lost too.
    fetch("/api/transcribe/blob-cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl: blob.url }),
      keepalive: true,
    }).catch(() => {});
    throw error;
  }
}

/**
 * Dashboard page — the user's home screen after login.
 *
 * Shows existing projects and a file picker for creating new ones.
 * Fetches projects from the API on mount.
 */
export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [activeUploads, setActiveUploads] = useState<
    Record<string, { step: "extracting" | "uploading"; percent: number }>
  >({});

  const [isDraggingPage, setIsDraggingPage] = useState(false);

  const fetchCredits = useCallback(async () => {
    const data = await fetchCreditsInfo();
    if (data) setCredits(data);
  }, []);

  /** Fetch user's projects and credit balance on mount. */
  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await fetch("/api/projects");
        if (response.ok) {
          const data = await response.json();
          setProjects(data);
        }
      } catch (error) {
        console.error("Failed to fetch projects:", error);
      } finally {
        setIsLoadingProjects(false);
      }
    }

    fetchProjects();
    fetchCreditsInfo().then((data) => {
      if (data) setCredits(data);
    });
  }, []);

  // Returning from Stripe Checkout: ?checkout=success|cancelled. Read from
  // window.location (client-only effect) rather than useSearchParams, which
  // would force a Suspense boundary around the whole page. The webhook may
  // land a beat after the redirect, so re-fetch the balance a few times.
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (!checkout) return;
    window.history.replaceState(null, "", "/dashboard");
    if (checkout === "success") {
      toast.success("Payment received", {
        description: "Your credits are being added — the balance updates in a moment.",
      });
      const timers = [2000, 5000, 10000].map((ms) => setTimeout(fetchCredits, ms));
      return () => timers.forEach(clearTimeout);
    }
    if (checkout === "cancelled") {
      toast.message("Checkout cancelled", {
        description: "No payment was made.",
      });
    }
  }, [fetchCredits]);

  // Guards against double-submitting the same project (e.g. mashing "Retry")
  // — the Deepgram route no longer has a DB column to detect that itself,
  // since the blob URL is now just a request-scoped value, not stored state.
  const inFlightProjectIds = useRef<Set<string>>(new Set());

  /**
   * Prepare the media, upload it, and start transcription, narrating progress
   * via toasts. Shared by the create-project flow and the retry flow on
   * failed cards. Fire-and-forget — status updates arrive via polling, but we
   * surface each stage explicitly so the user isn't left guessing.
   *
   * We first extract the audio track in the browser
   * (~50-100x smaller than the video) and upload that straight to Vercel Blob
   * — our server never sees the bytes, which both keeps uploads fast and
   * avoids Vercel serverless Functions' ~4.5MB request body cap. If
   * extraction isn't possible we fall back to uploading the original file,
   * still via Blob (so even that fallback stays Vercel-compatible).
   */
  const kickOffTranscription = useCallback(async (projectId: string, file: File) => {
    if (inFlightProjectIds.current.has(projectId)) return;
    inFlightProjectIds.current.add(projectId);

    const toastId = `transcribe-${projectId}`;
    // Don't leave the row spinning "Transcribing…" on failure — reflect it now.
    const fail = (message: string, description?: string) => {
      toast.error(message, { id: toastId, description });
      setActiveUploads((prev) => {
        const copy = { ...prev };
        delete copy[projectId];
        return copy;
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, transcriptStatus: "failed" } : p
        )
      );
    };

    try {
      let payload: Blob = file;
      let contentType = file.type || "application/octet-stream";

      toast.loading("Extracting audio…", { id: toastId });
      setActiveUploads((prev) => ({
        ...prev,
        [projectId]: { step: "extracting", percent: 0 },
      }));

      let lastPercent = -1;
      const extracted = await extractAudioForTranscription(file, (fraction) => {
        const percent = Math.round(fraction * 100);
        setActiveUploads((prev) => ({
          ...prev,
          [projectId]: { step: "extracting", percent },
        }));
        if (percent === lastPercent) return; // don't spam toast re-renders
        lastPercent = percent;
        toast.loading("Extracting audio…", {
          id: toastId,
          description: `${percent}% — only the audio track is uploaded, not the video`,
        });
      });

      if (extracted.kind === "no-audio") {
        fail(
          "No audio track found",
          "This video has no audio, so there's nothing to transcribe."
        );
        return;
      }
      if (extracted.kind === "audio") {
        payload = extracted.blob;
        contentType = extracted.mimeType;
      }
      // "unsupported" → fall through and upload the original file.

      toast.loading("Uploading…", { id: toastId, description: "0%" });
      setActiveUploads((prev) => ({
        ...prev,
        [projectId]: { step: "uploading", percent: 0 },
      }));

      let lastUploadPercent = -1;
      await startDeepgramTranscription(projectId, payload, contentType, (fraction) => {
        const percent = Math.round(fraction * 100);
        setActiveUploads((prev) => ({
          ...prev,
          [projectId]: { step: "uploading", percent },
        }));
        if (percent === lastUploadPercent) return;
        lastUploadPercent = percent;
        toast.loading("Uploading…", { id: toastId, description: `${percent}%` });
      });

      toast.success("Transcription started", {
        id: toastId,
        description: "This can take a minute — the status updates here when it's ready.",
      });
      setActiveUploads((prev) => {
        const copy = { ...prev };
        delete copy[projectId];
        return copy;
      });
      // The reserve just changed the balance — reflect it in the header chip.
      fetchCredits();
    } catch (error) {
      console.error("Failed to start transcription:", error);
      setActiveUploads((prev) => {
        const copy = { ...prev };
        delete copy[projectId];
        return copy;
      });
      if ((error as { insufficientCredits?: boolean })?.insufficientCredits) {
        // Server-authoritative "out of credits" — offer the fix directly.
        fetchCredits();
        toast.error("Not enough credits", {
          id: toastId,
          description:
            error instanceof Error ? error.message : String(error),
          action: { label: "Buy credits", onClick: () => setBuyOpen(true) },
        });
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectId ? { ...p, transcriptStatus: "failed" } : p
          )
        );
      } else {
        fail(
          "Transcription didn't start",
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      inFlightProjectIds.current.delete(projectId);
    }
  }, [fetchCredits]);

  /**
   * Pre-flight credit check (UX only — the server re-checks authoritatively
   * and 402s). Returns true when the upload should be blocked.
   */
  const blockedByCredits = useCallback(
    (durationMs: number | null | undefined): boolean => {
      if (credits == null || durationMs == null || durationMs <= 0) return false;
      const needed = Math.ceil(durationMs / 1000);
      if (needed <= credits.creditSeconds) return false;
      toast.error("Not enough credits for this video", {
        description: `It needs ${formatDuration(durationMs)} of credit — you have ${formatDuration(
          credits.creditSeconds * 1000
        )}.`,
        action: { label: "Buy credits", onClick: () => setBuyOpen(true) },
      });
      return true;
    },
    [credits]
  );

  /** Handle file selection — create a new project, then kick off transcription. */
  const handleFileSelected = useCallback(
    async (file: File, metadata: VideoMetadata) => {
      // Note: no up-front size gate on the video itself — what's uploaded is
      // the extracted audio track, which kickOffTranscription size-checks
      // against the Deepgram cap after extraction.
      if (blockedByCredits(metadata.durationMs)) return;
      setIsCreating(true);

      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: metadata.fileName,
            durationMs: metadata.durationMs,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create project");
        }

        const project = await response.json();
        // Add new project to the list immediately for instant feedback.
        // Mark it "processing" right away (instead of waiting on a poll
        // tick) so the progress bar shows from the start — startTranscription
        // is about to set this same status server-side anyway.
        setProjects((prev) => [
          { ...project, transcriptStatus: "processing" },
          ...prev,
        ]);

        kickOffTranscription(project.id, file);
      } catch (error) {
        console.error("Failed to create project:", error);
      } finally {
        setIsCreating(false);
      }
    },
    [kickOffTranscription, blockedByCredits]
  );

  /** Page-level drag-and-drop listener. */
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounter++;
        setIsDraggingPage(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounter--;
        if (dragCounter === 0) {
          setIsDraggingPage(false);
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingPage(false);
      dragCounter = 0;

      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          const durationMs = Math.round(video.duration * 1000);
          URL.revokeObjectURL(video.src);
          handleFileSelected(file, {
            fileName: file.name,
            fileSize: file.size,
            durationMs,
          });
        };
        video.onerror = () => {
          URL.revokeObjectURL(video.src);
          toast.error("Could not read this video file. Try a different format.");
        };
        video.src = URL.createObjectURL(file);
      } else if (file) {
        toast.error("Please drop a valid video file.");
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleFileSelected]);

  // Retry flow: the media only ever lives in the browser (nothing is stored
  // server-side), so retranscribing a failed project means asking the user to
  // re-select the file from disk, then re-running the same upload against the
  // existing project id.
  const retryInputRef = useRef<HTMLInputElement>(null);
  const retryProjectRef = useRef<Project | null>(null);

  function handleRetryClick(e: React.MouseEvent, project: Project) {
    e.preventDefault();
    retryProjectRef.current = project;
    if (retryInputRef.current) {
      // Reset so picking the same file as last time still fires onChange.
      retryInputRef.current.value = "";
      retryInputRef.current.click();
    }
  }

  function handleRetryFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const project = retryProjectRef.current;
    retryProjectRef.current = null;
    if (!file || !project) return;

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a video file.");
      return;
    }

    if (blockedByCredits(project.durationMs)) return;

    // Picking a different file than the project was created from is probably a
    // mistake (the transcript would describe the wrong video) — flag it, but
    // don't block: the user may simply have renamed the file.
    if (file.name !== project.fileName) {
      toast.message("Different file name", {
        description: `This project was created from "${project.fileName}" but you picked "${file.name}". The transcript will be for the file you just picked.`,
      });
    }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id ? { ...p, transcriptStatus: "processing" } : p
      )
    );
    kickOffTranscription(project.id, file);
  }

  /** Poll any project still transcribing until it's ready or failed. */
  useEffect(() => {
    const processingIds = projects
      .filter((p) => p.transcriptStatus === "processing")
      .map((p) => p.id);

    if (processingIds.length === 0) return;

    const abortController = new AbortController();

    const interval = setInterval(async () => {
      for (const id of processingIds) {
        try {
          const response = await fetch(`/api/projects/${id}/status`, {
            signal: abortController.signal,
          });
          if (!response.ok) continue;

          // A redirect (e.g. to the sign-in page during a session refresh)
          // resolves with response.ok === true but an HTML body, not JSON —
          // guard against parsing that as a transcript status update.
          if (!response.headers.get("content-type")?.includes("application/json")) {
            continue;
          }

          const updated = await response.json();
          setProjects((prev) =>
            prev.map((p) =>
              p.id === id
                ? { ...p, transcriptStatus: updated.transcriptStatus }
                : p
            )
          );
          // A finished job settled its credit hold (reconcile or refund) —
          // pick up the corrected balance.
          if (updated.transcriptStatus !== "processing") {
            fetchCredits();
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") continue;
          console.error("Failed to poll transcript status:", error);
        }
      }
    }, 4000);

    return () => {
      clearInterval(interval);
      abortController.abort();
    };
  }, [projects, fetchCredits]);

  /** Delete a project. */
  async function handleDeleteProject(e: React.MouseEvent, projectId: string) {
    e.preventDefault();
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  }

  const readyCount = projects.filter((p) => p.transcriptStatus === "ready").length;
  const processingCount = projects.filter(
    (p) => p.transcriptStatus === "processing"
  ).length;

  return (
    <div className="relative mx-auto max-w-6xl px-6 py-12">
      {/* Ambient glow behind the header */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-8rem] h-72 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600/20 via-indigo-500/10 to-violet-600/20 blur-3xl" />
      </div>

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Your Projects
          </h1>
          <p className="mt-2 text-foreground/50">
            Turn raw footage into a rough cut — start by adding a video below.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <CreditsPanel credits={credits} buyOpen={buyOpen} onBuyOpenChange={setBuyOpen} />
          {!isLoadingProjects && projects.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] px-3 py-1.5 font-medium text-foreground/60 ring-1 ring-inset ring-foreground/10">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            {readyCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-200 ring-1 ring-inset ring-emerald-400/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {readyCount} ready
              </span>
            )}
              {processingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1.5 font-medium text-blue-200 ring-1 ring-inset ring-blue-400/20">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                  {processingCount} transcribing
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* File Picker */}
      <div className="mb-12">
        <FilePicker
          onFileSelected={handleFileSelected}
          isLoading={isCreating}
        />
      </div>

      {/* Project List */}
      <div>
        <div className="mb-5 flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground/90">
            Recent projects
          </h2>
          <div className="h-px flex-1 bg-foreground/5" />
        </div>

        {isLoadingProjects ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.01]"
              >
                <div className="aspect-video animate-shimmer bg-white/[0.02]" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-2/3 animate-shimmer rounded bg-white/[0.02]" />
                  <div className="h-3 w-1/3 animate-shimmer rounded bg-white/[0.01]" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-8 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 ring-1 ring-inset ring-blue-400/20">
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
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="font-semibold text-white tracking-tight">No projects yet</p>
            <p className="mt-1.5 max-w-xs text-sm text-zinc-400">
              Select a video file above and your first rough cut will show up
              here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const status = STATUS_META[project.transcriptStatus];
              const activeUpload = activeUploads[project.id];
              return (
                <div
                  key={project.id}
                  id={`project-${project.id}`}
                  className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.01] backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/30 hover:bg-white/[0.03] hover:shadow-2xl hover:shadow-blue-500/5"
                >
                  <Link href={`/dashboard/${project.id}`} className="block">
                    {/* Poster */}
                    <div
                      className={`relative aspect-video overflow-hidden bg-gradient-to-br ${posterFor(
                        project.id
                      )}`}
                    >
                      {/* Play glyph */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white/90 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                          <svg
                            className="ml-0.5 h-6 w-6"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>

                      {/* Status badge */}
                      {status && (
                        <span
                          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${status.chip} ${status.text}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${status.dot} ${
                              project.transcriptStatus === "processing"
                                ? "animate-pulse"
                                : ""
                            }`}
                          />
                          {status.label}
                        </span>
                      )}

                      {/* Duration chip */}
                      {project.durationMs != null && (
                        <span className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/95 backdrop-blur-md">
                          {formatDuration(project.durationMs)}
                        </span>
                      )}
                    </div>

                    {/* Body */}
                    <div className="p-4">
                      <p className="truncate font-semibold text-white tracking-tight">
                        {project.fileName}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatDate(project.createdAt)}
                      </p>

                      {project.transcriptStatus === "processing" && (
                        <div className="mt-3.5 space-y-1.5">
                          {activeUpload ? (
                            <>
                              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                                <span>
                                  {activeUpload.step === "extracting"
                                    ? "Extracting audio…"
                                    : "Uploading media…"}
                                </span>
                                <span className="tabular-nums font-semibold text-blue-400">
                                  {activeUpload.percent}%
                                </span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label="Upload/Extraction progress"
                                className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
                              >
                                <div
                                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                                  style={{ width: `${activeUpload.percent}%` }}
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                                <span>Transcribing…</span>
                                <span className="animate-pulse font-semibold text-blue-400">AI working</span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label="Transcription in progress"
                                className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
                              >
                                <div className="h-full w-1/3 animate-indeterminate-progress rounded-full bg-blue-500" />
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Retry / start transcription — the media isn't stored
                      server-side, so this re-prompts for the file. */}
                  {(project.transcriptStatus === "failed" ||
                    project.transcriptStatus === "idle") && (
                    <div className="px-4 pb-4">
                      <button
                        onClick={(e) => handleRetryClick(e, project)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.03] hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/20 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-white transition-all duration-200 cursor-pointer"
                      >
                        <svg
                          className="h-3.5 w-3.5 text-zinc-400 group-hover:text-blue-400 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        {project.transcriptStatus === "failed"
                          ? "Retry transcription"
                          : "Start transcription"}
                      </button>
                    </div>
                  )}

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-zinc-400 opacity-0 backdrop-blur-md transition-all hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
                    title="Delete project"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hidden input backing the per-card retry buttons. */}
      <input
        ref={retryInputRef}
        type="file"
        accept="video/*"
        onChange={handleRetryFileSelected}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {isDraggingPage && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md transition-all duration-300">
          <div className="m-8 flex max-w-xl flex-col items-center justify-center rounded-2xl border border-dashed border-blue-500/40 bg-blue-500/5 px-12 py-20 text-center shadow-2xl shadow-blue-500/10">
            <div className="mb-6 flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/30">
              <svg className="h-10 w-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white tracking-tight">Drop your video here</h3>
            <p className="mt-2 text-zinc-400 text-sm">
              We'll instantly extract the audio and start generating your transcription.
            </p>
          </div>
        </div>
      )}

      <Toaster
        position="bottom-center"
        gap={8}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-lg !border !border-foreground/10 !bg-background !text-foreground !shadow-2xl",
            description: "!text-foreground/60",
            error: "!text-red-300",
            icon: "!text-violet-300",
          },
        }}
      />
    </div>
  );
}
