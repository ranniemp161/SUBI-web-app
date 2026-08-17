import { describe, it, expect } from "vitest";
import { traceChart, traceObject, normalizeForTrace, resolveSpan } from "./honesty";
import type { SceneChart, SceneObject } from "./scene-schema";

function chart(over: Partial<SceneChart> = {}): SceneChart {
  return {
    type: "bar",
    title: "Fuel imports",
    values: [80],
    labels: ["cut"],
    unit: "%",
    source_span: { start_char: 0, end_char: 40 },
    ...over,
  };
}

describe("traceChart", () => {
  const line = "We cut fuel imports by 80% in three years.";

  it("passes a chart whose value and unit are both in the cited span", () => {
    expect(traceChart(chart(), line)).toEqual({ traced: true });
  });

  it("drops a chart whose value is nowhere in the line (AC-54)", () => {
    // The backstop: the model cited a real line and then reported a number that
    // line never contained.
    const result = traceChart(chart({ values: [64] }), line);
    expect(result.traced).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("64") });
  });

  it("drops a chart claiming a unit the line never states", () => {
    const bare = "We cut fuel imports by 80 in three years.";
    const result = traceChart(chart({ unit: "%" }), bare);

    // A bare 80 is a different claim than 80%, and the unit is traced exactly
    // as hard as the values are.
    expect(result.traced).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("unit") });
  });

  it("accepts a null unit when the line states none", () => {
    const bare = "We shipped 12 of them.";
    expect(traceChart(chart({ values: [12], unit: null }), bare)).toEqual({ traced: true });
  });

  it("does not let a value match inside a longer number", () => {
    // `80` appears inside `1802`, and a chart claiming 80 backed only by 1802
    // is exactly the fabrication this check exists to catch.
    const result = traceChart(chart({ values: [80], unit: null }), "It ran from 1802 onward.");
    expect(result.traced).toBe(false);
  });

  it("does not let a whole number match a decimal that starts with it", () => {
    const result = traceChart(chart({ values: [80], unit: null }), "It moved 80.5 points.");
    expect(result.traced).toBe(false);
  });

  it("treats 80.0 and 80 as the same claim", () => {
    expect(traceChart(chart({ values: [80.0] }), line)).toEqual({ traced: true });
  });

  it("sees through a thousands separator", () => {
    const spoken = "We had 1,200 of them on the first day.";
    expect(
      traceChart(
        chart({ values: [1200], unit: null, source_span: { start_char: 0, end_char: 40 } }),
        spoken
      )
    ).toEqual({ traced: true });
  });

  it("ignores a leading currency mark", () => {
    const spoken = "It cost $250 to run.";
    expect(traceChart(chart({ values: [250], unit: null }), spoken)).toEqual({ traced: true });
  });

  it("accepts percent spelled either way", () => {
    const spoken = "We cut it by 80 percent last year.";
    expect(traceChart(chart({ values: [80], unit: "%" }), spoken)).toEqual({ traced: true });
  });

  it("accepts the word form of a small integer", () => {
    const spoken = "We tripled it, three times over.";
    expect(traceChart(chart({ values: [3], unit: "x" }), spoken)).toEqual({ traced: true });
  });

  it("rejects every value, not just the first", () => {
    const spoken = "It went from 20% to 80% in a year.";
    const result = traceChart(chart({ values: [20, 55], unit: "%" }), spoken);
    expect(result).toMatchObject({ traced: false, reason: expect.stringContaining("55") });
  });

  it("drops a chart citing a span outside the line", () => {
    const result = traceChart(
      chart({ source_span: { start_char: 900, end_char: 950 } }),
      line
    );
    expect(result).toMatchObject({
      traced: false,
      reason: expect.stringContaining("does not exist"),
    });
  });

  it("drops a chart whose span is inverted or empty", () => {
    expect(
      traceChart(chart({ source_span: { start_char: 20, end_char: 20 } }), line).traced
    ).toBe(false);
    expect(
      traceChart(chart({ source_span: { start_char: 30, end_char: 10 } }), line).traced
    ).toBe(false);
  });

  it("only searches inside the cited span, not the whole line", () => {
    // The number is real and in the transcript — but not where the model said
    // it was. A citation that points at the wrong words is not a citation.
    const twoClaims = "Revenue rose 12%. Costs fell 40%.";
    const result = traceChart(
      chart({ values: [40], unit: "%", source_span: { start_char: 0, end_char: 17 } }),
      twoClaims
    );
    expect(result.traced).toBe(false);
  });

  it("forgives an end offset that overshoots the line", () => {
    // A model overshooting the last character of a line it genuinely cited
    // should not cost an honest chart.
    expect(
      traceChart(chart({ source_span: { start_char: 0, end_char: 9_999 } }), line)
    ).toEqual({ traced: true });
  });

  it("rejects a paraphrased number, and this is deliberate", () => {
    // "Four in five" is a fair way to say 80% and it will not trace. The bias
    // is toward dropping a true chart over publishing a false one (spec 0003,
    // Consequences). Pinned so the tradeoff is a decision, not a surprise.
    const spoken = "Four in five of them agreed.";
    expect(traceChart(chart({ values: [80], unit: "%" }), spoken).traced).toBe(false);
  });
});

describe("normalizeForTrace", () => {
  it("folds case, collapses whitespace, strips separators and currency", () => {
    expect(normalizeForTrace("  We  had $1,200   PER cent ")).toBe("we had 1200 per cent");
  });

  it("keeps a comma that is not a thousands separator", () => {
    expect(normalizeForTrace("eighty, roughly")).toBe("eighty, roughly");
  });
});

describe("resolveSpan", () => {
  it("returns the cited slice", () => {
    expect(resolveSpan("abcdefgh", { start_char: 2, end_char: 5 })).toBe("cde");
  });

  it("returns null for a start past the end of the line", () => {
    expect(resolveSpan("abc", { start_char: 5, end_char: 9 })).toBeNull();
  });
});

/**
 * The subject trace (spec `broll/0008`).
 *
 * The same rule as `traceChart`, applied to the thing a scene is about to draw
 * rather than to the numbers on it. An illustration of a castle nobody mentioned
 * is a picture of a claim nobody made — and it is harder to spot than an invented
 * number, because nothing about a well drawn castle looks wrong.
 */

function object(over: Partial<SceneObject> = {}): SceneObject {
  return {
    subject: "a castle",
    source_span: { start_char: 0, end_char: 60 },
    ...over,
  };
}

describe("traceObject", () => {
  const line = "They built a castle on the hill above the river.";

  it("passes a subject the speaker actually named", () => {
    expect(traceObject(object(), line)).toEqual({ traced: true });
  });

  it("drops a subject the line never names", () => {
    const result = traceObject(object({ subject: "a submarine" }), line);
    expect(result.traced).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("submarine") });
  });

  it("drops an adjective the speaker did not say", () => {
    // "a castle" and "a ruined castle" are different pictures, and the second
    // one is the model's rather than the speaker's. Requiring every content word
    // is what catches this; requiring only one would let it through on "castle".
    expect(traceObject(object({ subject: "a ruined castle" }), line).traced).toBe(false);
  });

  it("ignores the articles and joining words a noun phrase attracts", () => {
    // Those are the model's grammar, not the speaker's content, so a subject is
    // not rejected for containing "a" or "the" when the line phrased it another
    // way.
    expect(traceObject(object({ subject: "the castle" }), line).traced).toBe(true);
    expect(traceObject(object({ subject: "castle" }), line).traced).toBe(true);
  });

  it("matches across singular and plural", () => {
    // A speaker says "castles dotted the hillside" and a model quite reasonably
    // proposes "a castle". Refusing that would drop an illustration of something
    // the speaker plainly named.
    const plural = "Castles dotted the hillside for miles.";
    expect(traceObject(object({ subject: "a castle" }), plural).traced).toBe(true);
    expect(traceObject(object({ subject: "castles" }), line).traced).toBe(true);
  });

  it("handles a -y to -ies plural", () => {
    expect(
      traceObject(object({ subject: "a factory" }), "The factories closed that winter.").traced
    ).toBe(true);
  });

  it("is case and punctuation insensitive, like the chart trace", () => {
    expect(
      traceObject(object({ subject: "A Castle," }), line.toUpperCase()).traced
    ).toBe(true);
  });

  it("drops a subject cited outside the span, even when the line contains it", () => {
    // The offsets are the citation. A subject found somewhere else in the line
    // was not read out of the words the model pointed at.
    const result = traceObject(
      object({ subject: "a castle", source_span: { start_char: 0, end_char: 10 } }),
      line
    );
    expect(result.traced).toBe(false);
  });

  it("drops a span that does not exist in the line it points at", () => {
    const result = traceObject(
      object({ source_span: { start_char: 500, end_char: 520 } }),
      line
    );
    expect(result.traced).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("cited span") });
  });

  it("drops a subject made only of stopwords", () => {
    expect(traceObject(object({ subject: "the" }), line)).toEqual({
      traced: false,
      reason: "the subject names nothing",
    });
  });

  it("does not match a word inside a longer one", () => {
    // The same boundary discipline `traceChart` uses for numbers: "cat" must not
    // pass on "catalogue", or the check stops meaning anything.
    expect(
      traceObject(object({ subject: "a cat" }), "The catalogue arrived on Tuesday.").traced
    ).toBe(false);
  });
});
