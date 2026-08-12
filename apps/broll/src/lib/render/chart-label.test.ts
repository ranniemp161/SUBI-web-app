import { describe, expect, it } from "vitest";
import { formatChartNumber, formatChartValue } from "./chart-label";

describe("formatChartValue", () => {
  it("never renders a value bare when the speaker gave it a unit (AC-34)", () => {
    // The criterion's own example: a line saying 80% must not label the bar 80.
    expect(formatChartValue(80, "%")).toBe("80%");
    expect(formatChartValue(80, "%")).not.toBe("80");
  });

  it("keeps the unit whatever shape it arrived in", () => {
    expect(formatChartValue(80, "percent")).toBe("80 percent");
    expect(formatChartValue(3, "x")).toBe("3x");
    expect(formatChartValue(1.2, "million")).toBe("1.2 million");
    expect(formatChartValue(250, "$")).toBe("$250");
  });

  it("renders a unit it has never seen rather than dropping it", () => {
    // Dropping is the one failure mode this module exists to prevent, so an
    // unrecognized unit must still reach the label.
    expect(formatChartValue(40, "basis points")).toBe("40 basis points");
    expect(formatChartValue(9, "widgets per hour")).toContain("widgets per hour");
  });

  it("renders bare only when the speaker stated no unit", () => {
    // A null unit is the planner saying none was spoken, which is a real answer
    // and not a loss. Empty and whitespace are treated the same way.
    expect(formatChartValue(12, null)).toBe("12");
    expect(formatChartValue(12, "")).toBe("12");
    expect(formatChartValue(12, "   ")).toBe("12");
  });

  it("matches the unit case insensitively but prints it as spoken", () => {
    expect(formatChartValue(12, "X")).toBe("12X");
    expect(formatChartValue(30, "°C")).toBe("30°C");
  });

  it("groups thousands and drops a meaningless trailing zero", () => {
    // The honesty check traces "1,200" and "80.0" to 1200 and 80, so the label
    // has to read back the way the line was spoken.
    expect(formatChartValue(1200, null)).toBe("1,200");
    expect(formatChartValue(80.0, "%")).toBe("80%");
    expect(formatChartValue(1234567, null)).toBe("1,234,567");
  });

  it("keeps real precision", () => {
    expect(formatChartValue(80.5, "%")).toBe("80.5%");
    expect(formatChartValue(0.25, null)).toBe("0.25");
  });

  it("handles negatives without stranding the sign", () => {
    expect(formatChartValue(-12, "%")).toBe("-12%");
    expect(formatChartValue(-250, "$")).toBe("$-250");
  });
});

describe("formatChartNumber", () => {
  it("returns an empty string for a value that cannot be drawn", () => {
    expect(formatChartNumber(Number.NaN)).toBe("");
    expect(formatChartNumber(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("returns empty from formatChartValue too, so nothing draws a NaN label", () => {
    expect(formatChartValue(Number.NaN, "%")).toBe("");
  });
});
