/**
 * Background removal in the browser, and the probe that proves it can run
 * before any money moves (spec `broll/0004` AC-61).
 *
 * **Browser only. Never import this from a route or a server component.** It
 * pulls a WASM model and touches `document`. There is no `server-only` guard
 * available in reverse, so the rule is the comment plus the fact that nothing
 * server side has a reason to reach for it.
 *
 * Phase 0 measured `@imgly/background-removal` producing clean edges on Gemini
 * generated characters in both shipping styles, checked at high zoom on black
 * rather than on a checkerboard, at roughly four seconds an image. That
 * measurement is why segmentation is client side at all, and why no server side
 * fallback exists.
 */

/**
 * Why a probe exists at all.
 *
 * The user pays before the browser does its half of the work: the hold is
 * reserved, six Gemini images are bought, and only then does segmentation run.
 * A browser that cannot run the model would therefore fail *after* two dollars
 * and roughly eighty five cents of vendor cost were already spent. Spec `0001`
 * states that rule for Phase 4 rendering (AC-29, never fail mid export after
 * credits are spent); nothing covered the phase that spends them first, so
 * AC-61 does.
 *
 * The probe is a real inference, not a feature sniff, because a browser can pass
 * every capability check and still fail on the actual model. The cheap
 * synchronous checks run first only so a hopeless browser fails instantly
 * instead of downloading a model to find out.
 */
export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: string };

/** The model download is large and cached by the library, so probe once per page. */
let probeInFlight: Promise<ProbeResult> | null = null;

function missingCapability(): string | null {
  if (typeof window === "undefined") return "This check only runs in a browser.";
  if (typeof WebAssembly === "undefined") {
    return "This browser does not support WebAssembly, which the cutout step needs.";
  }
  if (typeof createImageBitmap !== "function") {
    return "This browser is missing createImageBitmap, which the cutout step needs.";
  }
  if (typeof document.createElement("canvas").getContext !== "function") {
    return "This browser cannot use a canvas, which the cutout step needs.";
  }
  return null;
}

/** A tiny PNG with something non uniform in it, so the model has an edge to find. */
async function stubImage(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = "#333333";
  ctx.beginPath();
  ctx.arc(16, 16, 8, 0, Math.PI * 2);
  ctx.fill();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png"
    );
  });
}

/**
 * Prove this browser can remove a background, before the Generate button is
 * usable.
 *
 * Cached for the life of the page: the first call pays for the model download
 * (which the library then caches, so the real run afterwards is fast), and every
 * later call reuses the answer. The cache holds the *promise*, so two callers
 * racing on mount share one download rather than starting two.
 */
export function probeSegmentation(): Promise<ProbeResult> {
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async (): Promise<ProbeResult> => {
    const missing = missingCapability();
    if (missing) return { ok: false, reason: missing };

    try {
      const { removeBackground } = await import("@imgly/background-removal");
      // The same configuration the real run uses. Probing on different settings
      // would prove the browser can do something it is never asked to do — a
      // GPU probe passing and a CPU run then failing is the shape of that bug.
      await removeBackground(await stubImage(), segmentationConfig());
      return { ok: true };
    } catch (error) {
      // Deliberately not reported to Sentry: an unsupported browser is an
      // expected outcome here, not an error. What matters is that the user is
      // told plainly and Generate stays disabled.
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `The cutout step could not run in this browser (${detail}). Try the latest Chrome, Edge or Firefox on a desktop.`,
      };
    }
  })();

  return probeInFlight;
}

/** Test seam: forget the cached probe so a fresh one runs. */
export function resetSegmentationProbe(): void {
  probeInFlight = null;
}

/**
 * How the background remover is configured, in one place for both callers.
 *
 * **Three settings, each fixing something measured rather than guessed.**
 *
 * `model: "isnet_fp16"` halves the download. The default `isnet` is the full
 * precision model, and this step was pulling roughly 84 MB of weights plus 11 MB
 * of onnxruntime WASM from a third party CDN on every cold browser — in front of
 * a $2.00 charge, with no explanation on screen. `isnet_quint8` is smaller still
 * and is deliberately **not** used: it is 8 bit quantised and the artefacts land
 * on the cutout edge, which is the exact thing this product is judged on at high
 * zoom. Half precision is visually indistinguishable here; quarter is a gamble
 * on the one pixel that matters.
 *
 * `device` asks for the GPU when the browser has WebGPU. That is not only a
 * speed win: the library's worker path is gated behind it
 * (`proxyToWorker = useWebGPU && config.proxyToWorker`), so on CPU this
 * inference runs on the **main thread** — which is how it once starved the page
 * badly enough that Clerk's `UserButton` missed its ten second mount budget.
 * WASM threads cannot rescue that, because they need `SharedArrayBuffer` and
 * therefore cross origin isolation headers this app does not send.
 *
 * `navigator.gpu` is checked rather than assumed: asking for a GPU that is not
 * there is a failure, and falling back to the previous behaviour is correct.
 */
export function segmentationConfig(onProgress?: SegmentationProgress) {
  const hasWebGpu =
    typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu != null;

  return {
    model: "isnet_fp16" as const,
    device: hasWebGpu ? ("gpu" as const) : ("cpu" as const),
    output: { format: "image/png" as const },
    ...(onProgress
      ? {
          progress: (key: string, current: number, total: number) => {
            onProgress({ key, current, total });
          },
        }
      : {}),
  };
}

/** What the library reports while it fetches weights and runs inference. */
export type SegmentationProgress = (update: {
  /** The library's own phase key, e.g. which asset is downloading. */
  key: string;
  current: number;
  total: number;
}) => void;

/**
 * Remove the background from one generated character, keeping PNG throughout
 * (AC-19). No JPEG intermediate exists anywhere between Gemini and storage,
 * because JPEG ringing lands exactly on the character edge that segmentation
 * depends on.
 *
 * `onProgress` exists because the first call of a session downloads a model
 * measured in tens of megabytes, and a creator who has just paid watches a
 * still screen for it. The library reports that progress and nothing was
 * listening.
 */
export async function removeCharacterBackground(
  png: Blob,
  onProgress?: SegmentationProgress
): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(png, segmentationConfig(onProgress));
}
