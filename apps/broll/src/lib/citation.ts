import type { SceneChart } from "./scene-schema";

/**
 * Split a scene's source line into the parts the review surface marks up: the
 * span the chart cited, and the figures inside it (spec `broll/0005` AC-86).
 *
 * **This is presentation, and it decides nothing.** Whether a chart may exist
 * at all is settled once, at plan time, by `traceChart` in `honesty.ts`, and a
 * chart that reaches this function has already been proved against its cited
 * line. So a figure this fails to locate is still a traced figure: it is shown
 * inside the cited span like the rest of the words, just without the extra
 * emphasis. Nothing here can promote an untraced number, and nothing here can
 * drop a traced one.
 *
 * That is why the matching below is deliberately literal while the honesty
 * check is not. `traceChart` accepts "three" as the value `3`, because a
 * speaker who says it has said it; underlining the word "three" as though it
 * were a figure would be reading more into the sentence than the offsets
 * support. Exact spellings get emphasis, everything else stays plain.
 *
 * Pure and dependency free: the scene list renders this in the browser.
 */

export type CitationPart = {
  text: string;
  /** `plain` outside the citation, `cited` inside it, `figure` on a number. */
  kind: "plain" | "cited" | "figure";
};

/** `80.0` and `80` are the same claim, written the way the column stores it. */
function canonicalNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

/**
 * Whole token matching, with the same digit boundary rule the honesty check
 * uses: `80` must not match inside `1802`, or a highlight would point at a
 * number the line never contained.
 */
function findRanges(haystack: string, needle: string): [number, number][] {
  if (needle.length === 0) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsAlnum = /^[a-z0-9]/i.test(needle);
  const endsAlnum = /[a-z0-9]$/i.test(needle);
  const before = startsAlnum ? "(?<![a-z0-9.])" : "";
  const after = endsAlnum ? "(?![a-z0-9.])" : "";

  const ranges: [number, number][] = [];
  const pattern = new RegExp(`${before}${escaped}${after}`, "gi");
  for (const match of haystack.matchAll(pattern)) {
    if (match.index === undefined) continue;
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Sort and fuse overlapping or touching ranges, so no part is emitted twice. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range] as [number, number]);
    }
  }
  return merged;
}

function push(parts: CitationPart[], text: string, kind: CitationPart["kind"]): void {
  if (text.length > 0) parts.push({ text, kind });
}

/**
 * The whole source line, marked up.
 *
 * A span that does not resolve against the text yields the line as one plain
 * part rather than an error: the citation is what would have been extra, and
 * losing it must not cost the creator the line itself.
 */
export function citationParts(sourceText: string, chart: SceneChart): CitationPart[] {
  const start = chart.source_span.start_char;
  const end = Math.min(chart.source_span.end_char, sourceText.length);

  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start >= sourceText.length ||
    end <= start
  ) {
    return sourceText.length > 0 ? [{ text: sourceText, kind: "plain" }] : [];
  }

  const span = sourceText.slice(start, end);
  const figures = mergeRanges([
    ...chart.values.flatMap((value) => findRanges(span, canonicalNumber(value))),
    ...(chart.unit ? findRanges(span, chart.unit) : []),
  ]);

  const parts: CitationPart[] = [];
  push(parts, sourceText.slice(0, start), "plain");

  let cursor = 0;
  for (const [from, to] of figures) {
    push(parts, span.slice(cursor, from), "cited");
    push(parts, span.slice(from, to), "figure");
    cursor = to;
  }
  push(parts, span.slice(cursor), "cited");

  push(parts, sourceText.slice(end), "plain");
  return parts;
}
