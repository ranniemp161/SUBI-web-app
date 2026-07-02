"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import FilePicker, { type VideoMetadata } from "@/components/file-picker";
import { formatDuration, formatDate } from "@/lib/utils";
import { DEEPGRAM_MAX_UPLOAD_BYTES } from "@/lib/deepgram";

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

// Which transcription backend to use. Deepgram is the real pipeline; local
// faster-whisper is the token-saving stand-in for local dev. Set
// NEXT_PUBLIC_TRANSCRIBE_PROVIDER=deepgram to exercise the Deepgram path
// (requires the app be reached over the public tunnel so Deepgram's callback
// can land on /api/transcribe/callback).
const TRANSCRIBE_PROVIDER =
  process.env.NEXT_PUBLIC_TRANSCRIBE_PROVIDER === "deepgram" ? "deepgram" : "whisper";

/** Kick off transcription for a project, dispatching to the active provider. */
function startTranscription(projectId: string, file: File) {
  return TRANSCRIBE_PROVIDER === "deepgram"
    ? startDeepgramTranscription(projectId, file)
    : startWhisperTranscription(projectId, file);
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
 * Deepgram path: upload the media to our own server, which forwards it to
 * Deepgram with a callback URL. We proxy (rather than upload straight from the
 * browser) because Deepgram's pre-recorded REST endpoint isn't CORS-enabled.
 * Deepgram posts the finished transcript to /api/transcribe/callback, which the
 * dashboard's polling picks up.
 */
async function startDeepgramTranscription(projectId: string, file: File) {
  const response = await fetch(
    `/api/transcribe/deepgram?projectId=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }
  );

  if (!response.ok) {
    throw new Error(await readErrorReason(response));
  }
}

/**
 * Local faster-whisper path: upload the video to our own route, which runs
 * whisper in the background and writes the transcript when it finishes.
 */
async function startWhisperTranscription(projectId: string, file: File) {
  const formData = new FormData();
  formData.set("projectId", projectId);
  formData.set("file", file);

  const response = await fetch("/api/transcribe/whisper", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorReason(response));
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

  /** Fetch user's projects on mount. */
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
  }, []);

  /** Handle file selection — create a new project, then kick off transcription. */
  const handleFileSelected = useCallback(
    async (file: File, metadata: VideoMetadata) => {
      // Deepgram rejects uploads past its size limit — catch it here so we don't
      // create an orphan project and waste a multi-GB upload. (The local whisper
      // path has no such limit.)
      if (TRANSCRIBE_PROVIDER === "deepgram" && file.size > DEEPGRAM_MAX_UPLOAD_BYTES) {
        toast.error("File too large to transcribe", {
          description: `Deepgram accepts files up to ${Math.floor(
            DEEPGRAM_MAX_UPLOAD_BYTES / (1024 * 1024 * 1024)
          )} GB. Try a shorter clip or a smaller file.`,
        });
        return;
      }

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

        // Fire-and-forget — status updates arrive via polling below, but we
        // surface start/failure explicitly so the user isn't left guessing
        // whether anything is happening.
        toast.loading("Uploading & starting transcription…", {
          id: `transcribe-${project.id}`,
        });
        startTranscription(project.id, file)
          .then(() => {
            toast.success("Transcription started", {
              id: `transcribe-${project.id}`,
              description: "This can take a minute — the status updates here when it's ready.",
            });
          })
          .catch((error) => {
            console.error("Failed to start transcription:", error);
            toast.error("Transcription didn't start", {
              id: `transcribe-${project.id}`,
              description: error instanceof Error ? error.message : String(error),
            });
            // Don't leave the row spinning "Transcribing…" — reflect the failure now.
            setProjects((prev) =>
              prev.map((p) =>
                p.id === project.id ? { ...p, transcriptStatus: "failed" } : p
              )
            );
          });
      } catch (error) {
        console.error("Failed to create project:", error);
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

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
  }, [projects]);

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
                className="overflow-hidden rounded-2xl border border-foreground/5 bg-foreground/[0.02]"
              >
                <div className="aspect-video animate-pulse bg-foreground/[0.04]" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-foreground/[0.06]" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-foreground/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-foreground/10 bg-foreground/[0.02] px-8 py-16 text-center">
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
            <p className="font-medium text-foreground/80">No projects yet</p>
            <p className="mt-1 max-w-xs text-sm text-foreground/40">
              Select a video file above and your first rough cut will show up
              here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const status = STATUS_META[project.transcriptStatus];
              return (
                <div
                  key={project.id}
                  id={`project-${project.id}`}
                  className="group relative overflow-hidden rounded-2xl border border-foreground/5 bg-foreground/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/15 hover:bg-foreground/[0.04] hover:shadow-xl hover:shadow-black/20"
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
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/25 text-white/90 ring-1 ring-inset ring-white/20 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
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
                          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm ${status.chip} ${status.text}`}
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
                        <span className="absolute bottom-3 right-3 rounded-md bg-black/45 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/90 backdrop-blur-sm">
                          {formatDuration(project.durationMs)}
                        </span>
                      )}
                    </div>

                    {/* Body */}
                    <div className="p-4">
                      <p className="truncate font-medium text-foreground">
                        {project.fileName}
                      </p>
                      <p className="mt-1 text-xs text-foreground/40">
                        {formatDate(project.createdAt)}
                      </p>

                      {project.transcriptStatus === "processing" && (
                        <div
                          role="progressbar"
                          aria-label="Transcription in progress"
                          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-foreground/10"
                        >
                          <div className="h-full w-1/3 animate-indeterminate-progress rounded-full bg-blue-500" />
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    className="absolute right-3 top-3 rounded-lg bg-black/40 p-2 text-white/70 opacity-0 backdrop-blur-sm transition-all hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
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
