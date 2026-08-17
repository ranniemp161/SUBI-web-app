import { describe, it, expect } from "vitest";
import {
  canUseTemplate,
  isCharacterTemplate,
  sceneBlocker,
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

describe("sceneBlocker (AC-138)", () => {
  const SIX = ["neutral", "happy", "surprised", "thoughtful", "skeptical", "excited"];

  it("never blocks a template that needs no character", () => {
    // The templates a faceless project can still cut b-roll with. If this ever
    // starts blocking them, a project with no character has nothing at all.
    for (const layoutTemplate of ["text-card", "chart-full"]) {
      expect(sceneBlocker({ layoutTemplate, emotion: null }, { committedEmotions: [] })).toBeNull();
    }
  });

  it("blocks a character scene when the project has no character", () => {
    const blocked = sceneBlocker(
      { layoutTemplate: "character-left", emotion: "happy" },
      { committedEmotions: [] }
    );
    expect(blocked?.code).toBe("no_character");
  });

  it("blocks a character scene whose emotion the character does not have", () => {
    const blocked = sceneBlocker(
      { layoutTemplate: "character-center", emotion: "furious" },
      { committedEmotions: SIX }
    );
    expect(blocked?.code).toBe("missing_emotion");
    // Names the emotion, because "this cannot render" without saying which
    // image is missing leaves the creator nothing to act on.
    expect(blocked?.reason).toContain("furious");
  });

  it("blocks a character scene with no emotion picked at all", () => {
    const blocked = sceneBlocker(
      { layoutTemplate: "character-left", emotion: null },
      { committedEmotions: SIX }
    );
    expect(blocked?.code).toBe("no_emotion_chosen");
  });

  it("passes a character scene the character can actually draw", () => {
    expect(
      sceneBlocker({ layoutTemplate: "character-left", emotion: "happy" }, { committedEmotions: SIX })
    ).toBeNull();
  });

  it("distinguishes 'no character' from 'wrong emotion', because the fixes differ", () => {
    // One is fixed by attaching a character, the other by picking a different
    // emotion or redrawing one. A single blended reason would send half the
    // creators who read it to the wrong screen.
    const noCharacter = sceneBlocker(
      { layoutTemplate: "character-left", emotion: "happy" },
      { committedEmotions: [] }
    );
    const wrongEmotion = sceneBlocker(
      { layoutTemplate: "character-left", emotion: "happy" },
      { committedEmotions: ["neutral"] }
    );
    expect(noCharacter?.code).not.toBe(wrongEmotion?.code);
  });

  it("clears the moment a character is attached, with no re-plan", () => {
    // The criterion's last clause. It holds because the block is derived and
    // never stored: the same scene answers differently on new inputs alone.
    const scene = { layoutTemplate: "character-left", emotion: "happy" };
    expect(sceneBlocker(scene, { committedEmotions: [] })).not.toBeNull();
    expect(sceneBlocker(scene, { committedEmotions: SIX })).toBeNull();
  });
});
