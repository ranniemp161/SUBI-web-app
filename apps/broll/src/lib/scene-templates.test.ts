import { describe, it, expect } from "vitest";
import {
  canUseTemplate,
  isCharacterTemplate,
  templateOptionsFor,
  visualTypeForTemplate,
} from "./scene-templates";
import { LAYOUT_TEMPLATES } from "./scene-schema";

/**
 * Spec `broll/0005` AC-75, AC-76, AC-93.
 *
 * These assert the *offer*, because AC-75's whole shape is that a creator is
 * never given a template their scene cannot draw. A picker and a route that
 * disagree is a control that fails after the click, so both read this module
 * and these tests are what hold it to one answer.
 */

describe("visualTypeForTemplate (AC-76)", () => {
  it("derives a type for every template the planner may write", () => {
    // A derivation with a hole in it cannot be trusted as one: the planner
    // writes all six, including the two nothing renders yet.
    for (const template of LAYOUT_TEMPLATES) {
      expect(["character", "infographic", "text"]).toContain(
        visualTypeForTemplate(template)
      );
    }
  });

  it("maps each renderable template to what is actually on screen", () => {
    expect(visualTypeForTemplate("character-left")).toBe("character");
    expect(visualTypeForTemplate("character-center")).toBe("character");
    expect(visualTypeForTemplate("chart-full")).toBe("infographic");
    expect(visualTypeForTemplate("text-card")).toBe("text");
  });
});

describe("templateOptionsFor (AC-75)", () => {
  it("never offers a template with no renderer", () => {
    const options = templateOptionsFor({ hasChart: true, hasCharacterSet: true });
    expect(options).not.toContain("character-plus-chart");
    expect(options).not.toContain("split-compare");
  });

  it("offers chart-full only to a scene that has a chart", () => {
    // A chart-full scene with no chart draws an empty frame. This is exactly
    // the scene whose chart the honesty check dropped.
    expect(templateOptionsFor({ hasChart: false, hasCharacterSet: true })).not.toContain(
      "chart-full"
    );
    expect(templateOptionsFor({ hasChart: true, hasCharacterSet: true })).toContain(
      "chart-full"
    );
  });

  it("offers a character template only once the set is committed", () => {
    const without = templateOptionsFor({ hasChart: true, hasCharacterSet: false });
    expect(without).not.toContain("character-left");
    expect(without).not.toContain("character-center");
  });

  it("always offers text-card, which needs neither", () => {
    // The floor: a project with no chart and no character set can still style
    // a scene, and a hand added scene starts here.
    expect(templateOptionsFor({ hasChart: false, hasCharacterSet: false })).toEqual([
      "text-card",
    ]);
  });
});

describe("canUseTemplate", () => {
  it("agrees with what is offered, which is what stops the picker drifting", () => {
    const input = { hasChart: false, hasCharacterSet: true };
    for (const template of LAYOUT_TEMPLATES) {
      expect(canUseTemplate(template, input)).toBe(
        templateOptionsFor(input).includes(template)
      );
    }
  });
});

describe("isCharacterTemplate (AC-93)", () => {
  it("is true for exactly the two templates that composite a character", () => {
    expect(isCharacterTemplate("character-left")).toBe(true);
    expect(isCharacterTemplate("character-center")).toBe(true);
    expect(isCharacterTemplate("text-card")).toBe(false);
    expect(isCharacterTemplate("chart-full")).toBe(false);
  });
});
