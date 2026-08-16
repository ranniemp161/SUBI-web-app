import { describe, it, expect } from "vitest";
import { citationParts } from "./citation";
import type { SceneChart } from "./scene-schema";

/**
 * Spec `broll/0005` AC-86.
 *
 * The thing being protected here is that the highlight points at the words the
 * numbers were actually read from. A citation that marks the wrong span, or
 * marks a number the line does not contain, would look like proof while being
 * none — worse than showing nothing.
 */

function chart(over: Partial<SceneChart> = {}): SceneChart {
  return {
    type: "bar",
    title: "Fuel imports",
    values: [80],
    labels: [],
    unit: "%",
    source_span: { start_char: 0, end_char: 10 },
    ...over,
  };
}

/** The text of the parts of one kind, joined, for asserting what was marked. */
function textOf(parts: ReturnType<typeof citationParts>, kind: string): string {
  return parts
    .filter((part) => part.kind === kind)
    .map((part) => part.text)
    .join("");
}

describe("citationParts", () => {
  it("splits the line at the cited offsets", () => {
    const text = "We cut fuel imports by 80% last year.";
    const parts = citationParts(
      text,
      chart({ source_span: { start_char: 7, end_char: 26 } })
    );

    // Everything outside the span is still shown; it is just not the citation.
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(textOf(parts, "plain")).toBe("We cut  last year.");
  });

  it("marks the charted value and unit inside the span", () => {
    const parts = citationParts(
      "We cut fuel imports by 80% last year.",
      chart({ source_span: { start_char: 7, end_char: 26 } })
    );

    expect(textOf(parts, "figure")).toBe("80%");
  });

  it("does not mark a number that only appears inside a longer one", () => {
    // The digit boundary rule: highlighting the `80` inside `1802` would point
    // at a figure the line never stated, which is the failure this product
    // exists to prevent.
    const parts = citationParts(
      "Revenue hit 1802 in the same quarter.",
      chart({
        values: [80],
        unit: null,
        source_span: { start_char: 0, end_char: 36 },
      })
    );

    expect(textOf(parts, "figure")).toBe("");
  });

  it("marks several values in one span", () => {
    const parts = citationParts(
      "It went from 20 to 80 over two years.",
      chart({
        values: [20, 80],
        unit: null,
        source_span: { start_char: 0, end_char: 21 },
      })
    );

    expect(textOf(parts, "figure")).toBe("2080");
  });

  it("leaves a word form of a number unmarked, and keeps it in the citation", () => {
    // The honesty check accepts "three" as 3, and this deliberately does not
    // emphasise it: the offsets support showing the span, not asserting which
    // word is the figure. The chart is still traced and still drawn.
    const parts = citationParts(
      "Traffic went up three times.",
      chart({ values: [3], unit: null, source_span: { start_char: 0, end_char: 27 } })
    );

    expect(textOf(parts, "figure")).toBe("");
    expect(textOf(parts, "cited")).toBe("Traffic went up three times");
  });

  it("shows the whole line as plain text when the span does not resolve", () => {
    // Losing the citation must never cost the creator the line itself.
    const text = "Short line.";
    const parts = citationParts(
      text,
      chart({ source_span: { start_char: 400, end_char: 420 } })
    );

    expect(parts).toEqual([{ text, kind: "plain" }]);
  });

  it("clamps an end offset past the end of the line", () => {
    // A model overshooting the last character of a line it genuinely cited
    // should not cost an honest citation, exactly as `resolveSpan` decided.
    const parts = citationParts(
      "Up 40% today",
      chart({ values: [40], source_span: { start_char: 3, end_char: 999 } })
    );

    expect(textOf(parts, "figure")).toBe("40%");
    expect(textOf(parts, "plain")).toBe("Up ");
  });
});
