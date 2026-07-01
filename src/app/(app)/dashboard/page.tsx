"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import FilePicker, { type VideoMetadata } from "@/components/file-picker";
import { formatDuration, formatDate } from "@/lib/utils";

interface Project {
  id: string;
  fileName: string;
  durationMs: number | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}

const TRANSCRIPT_STATUS_LABEL: Record<Project["transcriptStatus"], string> = {
  idle: "",
  processing: "Transcribing...",
  ready: "Transcript ready",
  failed: "Transcription failed",
};

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
          const response = await fetch(`/api/projects/${id}`, {
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Your Projects
        </h1>
        <p className="mt-2 text-foreground/50">
          Select a video file to start a new rough cut
        </p>
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
        <h2 className="mb-4 text-lg font-semibold text-foreground/80">
          Recent projects
        </h2>

        {isLoadingProjects ? (
          <div className="flex items-center justify-center py-12 text-foreground/30">
            <svg
              className="mr-3 h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] px-8 py-12 text-center">
            <p className="text-foreground/30">
              No projects yet. Select a video file above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                id={`project-${project.id}`}
                className="group flex items-center justify-between rounded-xl border border-foreground/5 bg-foreground/[0.02] px-6 py-4 transition-colors hover:border-foreground/10 hover:bg-foreground/[0.04]"
              >
                <Link
                  href={`/dashboard/${project.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <svg
                      className="h-5 w-5 text-blue-400"
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
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {project.fileName}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-foreground/40">
                      {project.durationMs && (
                        <span>{formatDuration(project.durationMs)}</span>
                      )}
                      <span>{formatDate(project.createdAt)}</span>
                      {TRANSCRIPT_STATUS_LABEL[project.transcriptStatus] && (
                        <span
                          className={
                            project.transcriptStatus === "failed"
                              ? "text-red-400"
                              : project.transcriptStatus === "ready"
                                ? "text-green-400"
                                : "text-blue-400"
                          }
                        >
                          {TRANSCRIPT_STATUS_LABEL[project.transcriptStatus]}
                        </span>
                      )}
                    </div>
                    {project.transcriptStatus === "processing" && (
                      <div
                        role="progressbar"
                        aria-label="Transcription in progress"
                        className="mt-2 h-1 w-full max-w-48 overflow-hidden rounded-full bg-foreground/10"
                      >
                        <div className="h-full w-1/3 animate-indeterminate-progress rounded-full bg-blue-500" />
                      </div>
                    )}
                  </div>
                </Link>

                <button
                  onClick={(e) => handleDeleteProject(e, project.id)}
                  className="rounded-lg p-2 text-foreground/20 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
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
            ))}
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
