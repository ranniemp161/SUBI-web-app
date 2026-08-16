import type { SceneSummary } from "@/lib/scenes";

/**
 * Reading a plan run as it happens (spec `broll/0003` AC-52, AC-59).
 *
 * Lifted out of `plan-panel.tsx` unchanged when that component retired into the
 * studio shell. It is here rather than inline because the shell already owns
 * selection, filtering, the keyboard and the render queue, and a stream parser
 * sitting in the middle of that is the kind of thing nobody finds again.
 *
 * The route sends HTTP 200 before the model answers, so a failure arrives as
 * `{"error"}` inside the last line rather than as a status, and `res.json()`
 * would deadlock on a body that is still open.
 */

export type PlanRejection = {
  utteranceIndex: number | null;
  reason: string;
  kind: "scene" | "chart";
};

export type TerminalLine = {
  scenes?: SceneSummary[];
  rejected?: PlanRejection[];
  refunded?: boolean;
  error?: string;
};

export const PHASE_LABELS: Record<string, string> = {
  merging: "Reading the transcript",
  planning: "Planning scenes",
  validating: "Checking every number",
};

/**
 * Read the NDJSON stream, updating the phase as it goes, and return the last
 * line, the terminal one carrying the plan or the error.
 *
 * A phase line and the heartbeat are the same shape, so anything carrying
 * `phase` updates the label and anything else is the result. Returns null if
 * the stream ended without one, which is a dropped connection rather than a
 * failed run: the route finishes its charge, call, write and refund server side
 * regardless (AC-59), so the money is settled even though the result is lost on
 * screen.
 */
export async function readPlanStream(
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
