"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import type { SceneSummary } from "@/lib/scenes";
import { formatClock } from "@/lib/utterances";
import { RenderSceneButton } from "./render-scene-button";

/**
 * The Plan button, the phases while a run is in flight, and the resulting
 * scenes read only (spec `broll/0003` AC-56, AC-58).
 *
 * A client component because the run is a stream it has to read incrementally:
 * the route sends HTTP 200 before the model answers, so a failure arrives as
 * `{"error"}` inside the last line rather than as a status, and `res.json()`
 * would deadlock on a body that is still open.
 */

type PlanRejection = {
  utteranceIndex: number | null;
  reason: string;
  kind: "scene" | "chart";
};

type TerminalLine = {
  scenes?: SceneSummary[];
  rejected?: PlanRejection[];
  refunded?: boolean;
  error?: string;
};

const PHASE_LABELS: Record<string, string> = {
  merging: "Reading the transcript",
  planning: "Planning scenes",
  validating: "Checking every number",
};

export function PlanPanel({
  projectId,
  initialScenes,
  planRuns,
  rerunPrice,
  outputWidth,
  outputHeight,
  fps,
}: {
  projectId: string;
  initialScenes: SceneSummary[];
  planRuns: number;
  /** Formatted server side: the price env override is not public. */
  rerunPrice: string;
  /** The project's output frame size, which the renderer encodes at. */
  outputWidth: number;
  outputHeight: number;
  /** The project's output rate as an exact rational, never a decimal. */
  fps: VideoFps;
}) {
  const [scenes, setScenes] = useState<SceneSummary[]>(initialScenes);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<PlanRejection[]>([]);
  const [confirming, setConfirming] = useState(false);

  const running = phase !== null;
  const isRerun = planRuns > 0;

  // One key for the lifetime of one run, minted when the run starts. It is the
  // only thing standing between a retried request and a second charge, so the
  // button stays disabled until the run settles rather than relying on it twice.
  const keyRef = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setConfirming(false);
    setError(null);
    setRejections([]);
    setPhase("merging");
    keyRef.current = crypto.randomUUID();

    try {
      const response = await fetch(`/api/projects/${projectId}/plan`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
      });

      if (!response.ok) {
        // A failure before the stream opened still answers a real status.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The plan run failed. Try again.");
        return;
      }

      const terminal = await readPlanStream(response, setPhase);
      if (!terminal) {
        setError("The connection dropped before the plan finished. Reload to see whether it landed.");
        return;
      }
      if (terminal.error) setError(terminal.error);
      if (terminal.scenes) setScenes(terminal.scenes);
      if (terminal.rejected) setRejections(terminal.rejected);
    } catch {
      setError("The plan run failed. Try again.");
    } finally {
      setPhase(null);
      keyRef.current = null;
    }
  }, [projectId, running]);

  const droppedCharts = useMemo(
    () => rejections.filter((r) => r.kind === "chart").length,
    [rejections]
  );
  const rejectedScenes = useMemo(
    () => rejections.filter((r) => r.kind === "scene").length,
    [rejections]
  );
  // Twenty scenes failing one way is one problem, not twenty.
  const distinctReasons = useMemo(
    () => Array.from(new Set(rejections.map((r) => r.reason))).slice(0, 5),
    [rejections]
  );

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--broll-muted)" }}
        >
          Scenes
        </h2>

        <button
          type="button"
          onClick={() => (isRerun && scenes.length > 0 ? setConfirming(true) : run())}
          disabled={running}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          style={{
            background: "var(--broll-accent)",
            color: "var(--broll-accent-foreground)",
          }}
        >
          {running
            ? "Planning…"
            : scenes.length > 0
              ? "Re-run plan"
              : "Plan scenes"}
        </button>
      </div>

      {/* Nothing plans on its own, including the free first run (AC-56). */}
      {!running && scenes.length === 0 && !error && (
        <p className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
          {isRerun
            ? `Planning again costs ${rerunPrice}.`
            : "The first plan for this project is included."}
        </p>
      )}

      {confirming && (
        <div className="broll-glow mt-4 rounded-lg px-4 py-3">
          <p className="text-sm">
            Re-running costs <strong>{rerunPrice}</strong> and replaces the{" "}
            {scenes.filter((s) => s.origin === "planner").length} planned scenes below,
            including any you had switched off. Scenes you added by hand are kept.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={run}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{
                background: "var(--broll-accent)",
                color: "var(--broll-accent-foreground)",
              }}
            >
              Re-run for {rerunPrice}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{ color: "var(--broll-muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {running && (
        <p
          className="mt-4 text-sm"
          role="status"
          aria-live="polite"
          style={{ color: "var(--broll-accent)" }}
        >
          {PHASE_LABELS[phase] ?? "Working"}…
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      {(droppedCharts > 0 || rejectedScenes > 0) && (
        <div className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
          <p>
            {droppedCharts > 0 && (
              <>
                {droppedCharts} chart{droppedCharts === 1 ? "" : "s"} dropped because the
                numbers were not in the line they cited.{" "}
              </>
            )}
            {rejectedScenes > 0 && (
              <>
                {rejectedScenes} scene{rejectedScenes === 1 ? "" : "s"} rejected as
                malformed.
              </>
            )}
          </p>

          {/* The reason, not just the count: a run where everything was
              rejected is unfixable if all it reports is how many (AC-24). */}
          {distinctReasons.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {distinctReasons.map((reason) => (
                <li key={reason} className="text-xs">
                  · {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {scenes.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {scenes.map((scene, position) => (
            <li key={scene.id} className="broll-glass rounded-lg px-4 py-3">
              <div className="flex gap-4">
                <span
                  className="broll-tabular text-sm shrink-0 pt-0.5"
                  style={{ color: "var(--broll-accent)" }}
                >
                  {formatClock(scene.startMs)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed">
                    {scene.sourceText ?? <em>Added by hand</em>}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--broll-muted)" }}>
                    {scene.layoutTemplate}
                    {scene.emotion ? ` · ${scene.emotion}` : ""}
                    {` · ${(scene.durationMs / 1000).toFixed(1)}s`}
                    {scene.chart ? ` · chart: ${scene.chart.title}` : ""}
                    {scene.origin === "manual" ? " · manual" : ""}
                  </p>
                  {/*
                    Phase 4 proves the spine on exactly one template, so the
                    control appears only where it can actually render: a
                    chart-full scene whose chart survived the honesty check.
                  */}
                  {scene.layoutTemplate === "chart-full" && scene.chart && (
                    <RenderSceneButton
                      index={position + 1}
                      startMs={scene.startMs}
                      durationMs={scene.durationMs}
                      width={outputWidth}
                      height={outputHeight}
                      fps={fps}
                      scene={{
                        title: scene.chart.title,
                        values: scene.chart.values,
                        labels: scene.chart.labels,
                        unit: scene.chart.unit,
                      }}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Read the NDJSON stream, updating the phase as it goes, and return the last
 * line — the terminal one carrying the plan or the error (AC-52).
 *
 * A phase line and the heartbeat are the same shape, so anything carrying
 * `phase` updates the label and anything else is the result. Returns null if
 * the stream ended without one, which is a dropped connection rather than a
 * failed run: the route finishes its charge, call, write and refund server
 * side regardless (AC-59), so the money is settled even though the result is
 * lost on screen.
 */
async function readPlanStream(
  response: Response,
  onPhase: (phase: string) => void
): Promise<TerminalLine | null> {
  if (!response.body) {
    // No streaming body (a test double, or a proxy that buffered it): the whole
    // payload is text, and the last line is still the result.
    const text = await response.text();
    return lastJsonLine(text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: TerminalLine | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last element is whatever arrived after the final newline: a partial
    // line, kept for the next chunk rather than parsed as a whole one.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (typeof parsed.phase === "string") {
        onPhase(parsed.phase);
      } else {
        terminal = parsed as TerminalLine;
      }
    }
  }

  const trailing = parseLine(buffer);
  if (trailing && typeof trailing.phase !== "string") terminal = trailing as TerminalLine;

  return terminal;
}

function parseLine(line: string): (TerminalLine & { phase?: string }) | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function lastJsonLine(text: string): TerminalLine | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseLine(lines[i]);
    if (parsed && typeof parsed.phase !== "string") return parsed as TerminalLine;
  }
  return null;
}
