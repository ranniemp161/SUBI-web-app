import { describe, expect, it } from "vitest";
import { recorder } from "./test-recorder";
import {
  centeredFirstBaseline,
  drawRunLine,
  parseRuns,
  runLineText,
  wrapRuns,
} from "./text";

const wrap = (text: string, width: number) =>
  wrapRuns(recorder(), parseRuns(text), width).map((l) => l.map((r) => [r.text, r.emphasis]));

/**
 * The setting rules, checked where they can be: on the runs, not on the frame.
 *
 * None of this can assert that a clip looks right, which is what spec `0009`'s
 * verify sheet is for. What it can hold is the part that fails silently: a
 * parser that eats a character, an orphan rule that overflows a line, and a
 * block placed on the font's declared box instead of on its own ink.
 */
describe("text", () => {
  it("parses a marked word and never renders the marks", () => {
    expect(parseRuns("we built a *castle* here")).toEqual([
      { text: "we built a ", emphasis: false },
      { text: "castle", emphasis: true },
      { text: " here", emphasis: false },
    ]);
  });

  it("leaves an unmatched mark literal and eats nothing", () => {
    expect(parseRuns("a *castle")).toEqual([{ text: "a *castle", emphasis: false }]);
    expect(parseRuns("**")).toEqual([{ text: "**", emphasis: false }]);
    expect(runLineText(parseRuns("a *castle"))).toBe("a *castle");
  });

  it("emphasises nothing on its own", () => {
    expect(parseRuns("it was 94%").every((r) => !r.emphasis)).toBe(true);
  });

  it("pulls a word down rather than leaving an orphan", () => {
    // The recorder charges 5px a character at its default font.
    expect(wrap("aa bb cc dddd", 40)).toEqual([
      [["aa bb", false]],
      [["cc dddd", false]],
    ]);
  });

  it("keeps the orphan when the pulled line would overflow", () => {
    // "a bbbbbbbbb" exactly fills 55; pulling "cc" down would need 60.
    const lines = wrap("a bbbbbbbbb cc", 55);
    expect(lines[lines.length - 1]).toEqual([["cc", false]]);
  });

  it("keeps emphasis on the right word across a line break", () => {
    const lines = wrap("aaaa bbbb *cccc* dddd", 50);
    const marked = lines.flat().filter(([, emphasis]) => emphasis);
    expect(marked).toEqual([["cccc", true]]);
  });

  it("centres on the ink rather than on the declared box", () => {
    const ctx = recorder();
    ctx.font = "700 100px x";
    const lines = wrapRuns(ctx, parseRuns("one"), 10_000);
    // Recorder ink: ascent 72, descent 20, so the ink is 92 tall and its centre
    // sits 26 below the baseline. Centred on 500 puts the baseline at 526.
    expect(centeredFirstBaseline(ctx, lines, { centerY: 500, lineHeight: 124, size: 100 })).toBe(526);
  });

  it("draws each run in its own colour, advancing across the line", () => {
    const ctx = recorder();
    ctx.font = "700 20px x";
    drawRunLine(ctx, parseRuns("ab *cd* ef"), 0, 0, "#ffffff");
    expect(ctx.calls).toEqual([
      { op: "fillText", text: "ab ", x: 0, y: 0, alpha: 1, font: "700 20px x" },
      { op: "fillText", text: "cd", x: 30, y: 0, alpha: 1, font: "700 20px x" },
      { op: "fillText", text: " ef", x: 50, y: 0, alpha: 1, font: "700 20px x" },
    ]);
  });
});
