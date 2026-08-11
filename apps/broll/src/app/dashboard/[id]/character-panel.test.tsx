/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const probeSegmentation = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock("@/lib/segmentation", () => ({
  probeSegmentation,
  removeCharacterBackground: vi.fn(),
}));
vi.mock("@/lib/trim", () => ({ trimTransparent: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ uploadPresigned: vi.fn() }));

import { CharacterPanel } from "./character-panel";

/**
 * When the capability probe is allowed to run (spec `broll/0004` AC-61).
 *
 * The probe is a real inference, and starting one is not cheap: it pulls the
 * `@imgly/background-removal` model and the onnxruntime WASM from a third party
 * CDN, 84 MB and 11 MB at the default model, then runs single threaded on the
 * **main thread**. It used to run from a mount effect, so every visitor who
 * merely opened a project paid that. It starved the main thread long enough for
 * Clerk's `UserButton` to miss its own ten second mount budget and log
 * "Component renderer did not mount within 10s".
 *
 * AC-61 still holds, and is enforced somewhere stricter than a disabled
 * attribute: `generate` and `regenerate` each await the probe themselves, so no
 * request that reserves money is sent until it has passed.
 */

function renderPanel() {
  return render(
    <CharacterPanel
      projectId="11111111-1111-1111-1111-111111111111"
      initialAssets={[]}
      initialRegenerationsUsed={0}
      setPrice="$2.00"
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("the capability probe", () => {
  it("does not run just because the page rendered", async () => {
    renderPanel();

    // The whole point. A visitor who opens a project and reads it downloads
    // nothing and blocks nothing.
    expect(probeSegmentation).not.toHaveBeenCalled();

    // Not merely "not yet": give the mount effects a turn to settle first.
    await waitFor(() => {
      expect(screen.getByText(/Generate character set/)).toBeTruthy();
    });
    expect(probeSegmentation).not.toHaveBeenCalled();
  });

  it("runs once the user picks a photo, before they can press Generate", async () => {
    const { container } = renderPanel();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array(10)], "me.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(probeSegmentation).toHaveBeenCalledTimes(1);
    });
  });
});
