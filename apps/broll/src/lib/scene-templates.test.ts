import { describe, it, expect } from "vitest";
import {
  canUseTemplate,
  isCharacterTemplate,
  isObjectTemplate,
  sceneBlocker,
  templateOptionsFor,
  visualTypeForTemplate,
  type TemplateCapabilities,
} from "./scene-templates";
import { LAYOUT_TEMPLATES, VISUAL_TYPES } from "./scene-schema";

/** A scene that can draw anything, so each test narrows exactly one gate. */
const ALL: TemplateCapabilities = {
  hasChart: true,
  hasCharacterSet: true,
  hasObject: true,
};

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
    // writes every one of these, including the two nothing renders yet.
    // Asserted against `VISUAL_TYPES` rather than a literal list, so adding a
    // type cannot make this pass by accident.
    for (const template of LAYOUT_TEMPLATES) {
      expect(VISUAL_TYPES).toContain(visualTypeForTemplate(template));
    }
  });

  it("maps each renderable template to what is actually on screen", () => {
    expect(visualTypeForTemplate("character-left")).toBe("character");
    expect(visualTypeForTemplate("character-center")).toBe("character");
    expect(visualTypeForTemplate("chart-full")).toBe("infographic");
    expect(visualTypeForTemplate("text-card")).toBe("text");
    expect(visualTypeForTemplate("object-full")).toBe("object");
    expect(visualTypeForTemplate("object-left")).toBe("object");
  });

  it("reads a frame with the creator in it as a character scene", () => {
    // `character-plus-object` draws both, and the object is the prop. Calling it
    // an object scene would put it in the wrong filter chip and describe it to
    // the creator as something other than what they are looking at — the same
    // reading `character-plus-chart` already gets.
    expect(visualTypeForTemplate("character-plus-object")).toBe("character");
    expect(visualTypeForTemplate("character-plus-chart")).toBe("character");
  });
});

describe("templateOptionsFor (AC-75)", () => {
  it("never offers a template with no renderer", () => {
    const options = templateOptionsFor(ALL);
    expect(options).not.toContain("character-plus-chart");
    expect(options).not.toContain("split-compare");
  });

  it("offers chart-full only to a scene that has a chart", () => {
    // A chart-full scene with no chart draws an empty frame. This is exactly
    // the scene whose chart the honesty check dropped.
    expect(templateOptionsFor({ ...ALL, hasChart: false })).not.toContain("chart-full");
    expect(templateOptionsFor(ALL)).toContain("chart-full");
  });

  it("offers a character template only once the set is committed", () => {
    const without = templateOptionsFor({ ...ALL, hasCharacterSet: false });
    expect(without).not.toContain("character-left");
    expect(without).not.toContain("character-center");
  });

  it("offers an object template only to a scene that names something", () => {
    // A scene with no traced subject has nothing to illustrate and no prompt to
    // generate from, so the template could never work rather than merely not
    // working yet.
    const without = templateOptionsFor({ ...ALL, hasObject: false });
    expect(without).not.toContain("object-full");
    expect(without).not.toContain("object-left");
    expect(templateOptionsFor(ALL)).toContain("object-full");
  });

  it("offers an object template before its illustration exists (spec 0008)", () => {
    // **The gate is the subject, never the image.** An illustration is drawn
    // from the template that carries the button that draws it, so gating on the
    // image would make that template unreachable and no creator could ever get
    // one. A missing image is a blocker with a way out, which is a different
    // thing — see `sceneBlocker` below.
    expect(templateOptionsFor(ALL)).toContain("object-full");
  });

  it("requires both a character and an object for character-plus-object", () => {
    // The one template in both groups, so it has to satisfy both gates rather
    // than whichever the filter happens to check first.
    expect(templateOptionsFor({ ...ALL, hasObject: false })).not.toContain(
      "character-plus-object"
    );
    expect(templateOptionsFor({ ...ALL, hasCharacterSet: false })).not.toContain(
      "character-plus-object"
    );
    expect(templateOptionsFor(ALL)).toContain("character-plus-object");
  });

  it("always offers text-card, which needs none of them", () => {
    // The floor: a project with no chart, no character set and no subject can
    // still style a scene, and a hand added scene starts here.
    expect(
      templateOptionsFor({ hasChart: false, hasCharacterSet: false, hasObject: false })
    ).toEqual(["text-card"]);
  });
});

describe("canUseTemplate", () => {
  it("agrees with what is offered, which is what stops the picker drifting", () => {
    // Run over every combination rather than one, because the route re-checks
    // with whatever the scene actually has and a picker that agrees in one
    // configuration is not a picker that agrees.
    for (const hasChart of [true, false]) {
      for (const hasCharacterSet of [true, false]) {
        for (const hasObject of [true, false]) {
          const input = { hasChart, hasCharacterSet, hasObject };
          for (const template of LAYOUT_TEMPLATES) {
            expect(canUseTemplate(template, input)).toBe(
              templateOptionsFor(input).includes(template)
            );
          }
        }
      }
    }
  });
});

describe("isCharacterTemplate (AC-93)", () => {
  it("is true for exactly the templates that composite a character", () => {
    expect(isCharacterTemplate("character-left")).toBe(true);
    expect(isCharacterTemplate("character-center")).toBe(true);
    expect(isCharacterTemplate("character-plus-object")).toBe(true);
    expect(isCharacterTemplate("text-card")).toBe(false);
    expect(isCharacterTemplate("chart-full")).toBe(false);
    expect(isCharacterTemplate("object-full")).toBe(false);
  });
});

describe("isObjectTemplate (spec 0008)", () => {
  it("is true for exactly the templates that composite an illustration", () => {
    expect(isObjectTemplate("object-full")).toBe(true);
    expect(isObjectTemplate("object-left")).toBe(true);
    expect(isObjectTemplate("character-plus-object")).toBe(true);
    expect(isObjectTemplate("character-left")).toBe(false);
    expect(isObjectTemplate("text-card")).toBe(false);
  });

  it("puts character-plus-object in both groups, which is the point of it", () => {
    expect(isObjectTemplate("character-plus-object")).toBe(true);
    expect(isCharacterTemplate("character-plus-object")).toBe(true);
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

  it("blocks an object scene until its illustration is drawn (spec 0008)", () => {
    const blocked = sceneBlocker(
      { layoutTemplate: "object-full", emotion: null, objectAssetPath: null },
      { committedEmotions: [] }
    );
    expect(blocked?.code).toBe("no_object_image");
  });

  it("marks that block as one the creator can clear by spending", () => {
    // The studio bar counts exactly these to offer one batch draw before an
    // export. A missing character is not in this set: it is fixed on the project
    // page, not from this screen, and offering to buy it here would be a lie.
    const missingImage = sceneBlocker(
      { layoutTemplate: "object-left", emotion: null, objectAssetPath: null },
      { committedEmotions: SIX }
    );
    const missingCharacter = sceneBlocker(
      { layoutTemplate: "character-left", emotion: "happy" },
      { committedEmotions: [] }
    );
    expect(missingImage?.fixableByGenerating).toBe(true);
    expect(missingCharacter?.fixableByGenerating).toBeUndefined();
  });

  it("passes an object scene once it has an illustration", () => {
    expect(
      sceneBlocker(
        {
          layoutTemplate: "object-full",
          emotion: null,
          objectAssetPath: "broll/objects/abc/1-00112233445566ff.png",
        },
        { committedEmotions: [] }
      )
    ).toBeNull();
  });

  it("reports the missing illustration first on character-plus-object", () => {
    // Both blocks apply to a scene that has neither. The illustration is
    // reported because it is the one the creator can clear from this screen; the
    // character block surfaces on the next pass once the image exists.
    const blocked = sceneBlocker(
      { layoutTemplate: "character-plus-object", emotion: null, objectAssetPath: null },
      { committedEmotions: [] }
    );
    expect(blocked?.code).toBe("no_object_image");
  });

  it("still blocks character-plus-object for its character once drawn", () => {
    const blocked = sceneBlocker(
      {
        layoutTemplate: "character-plus-object",
        emotion: null,
        objectAssetPath: "broll/objects/abc/1-00112233445566ff.png",
      },
      { committedEmotions: [] }
    );
    expect(blocked?.code).toBe("no_character");
  });

  it("never blocks a text or chart scene for an illustration", () => {
    for (const layoutTemplate of ["text-card", "chart-full"]) {
      expect(
        sceneBlocker({ layoutTemplate, emotion: null, objectAssetPath: null }, {
          committedEmotions: [],
        })
      ).toBeNull();
    }
  });
});
