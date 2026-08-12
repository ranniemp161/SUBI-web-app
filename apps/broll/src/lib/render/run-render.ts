import type { RenderResponseMessage, RenderSceneRequest } from "./types";

/**
 * Drives one render worker to completion.
 *
 * Both the single scene button and the batch export need exactly this, so it
 * lives here rather than being written twice. The batch depends on the
 * guarantees below, which are easy to get subtly wrong per copy: the worker is
 * always terminated, and the promise always settles.
 */

export class RenderFailure extends Error {
  constructor(
    readonly code: RenderResponseMessage extends { code: infer C } ? C : string,
    message: string
  ) {
    super(message);
    this.name = "RenderFailure";
  }
}

export interface RenderHandle {
  /** Resolves with the MP4 bytes, or rejects with a `RenderFailure`. */
  readonly done: Promise<ArrayBuffer>;
  /** Asks the worker to stop. The promise then rejects as cancelled. */
  cancel(): void;
}

/**
 * Starts a render and returns a handle to it.
 *
 * The worker is terminated on every exit path, including a rejection and a
 * cancel. A batch that leaks one worker per scene would have a dozen encoders
 * alive at once, which on a laptop is the difference between a slow export and
 * a dead tab.
 */
export function startRender(
  request: RenderSceneRequest,
  onProgress?: (ratio: number) => void
): RenderHandle {
  const worker = new Worker(new URL("../../workers/render-worker.ts", import.meta.url), {
    type: "module",
  });

  let settled = false;
  let resolve!: (buffer: ArrayBuffer) => void;
  let reject!: (error: Error) => void;

  const done = new Promise<ArrayBuffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    action();
  };

  worker.onmessage = (event: MessageEvent<RenderResponseMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "progress":
        onProgress?.(message.ratio);
        return;
      case "done":
        finish(() => resolve(message.buffer));
        return;
      case "canceled":
        finish(() => reject(new RenderFailure("canceled", "Render cancelled.")));
        return;
      case "error":
        finish(() => reject(new RenderFailure(message.code, message.message)));
    }
  };

  // A worker that fails to load never posts a message, so without this the
  // promise would hang and a batch would stall on that scene forever.
  worker.onerror = () => {
    finish(() => reject(new RenderFailure("encode-failed", "The renderer failed to start.")));
  };

  // Posted without a transfer list on purpose. An ImageBitmap is both
  // serializable and transferable; transferring it would detach the page's
  // copy and blank the preview the creator is looking at.
  worker.postMessage(request);

  return {
    done,
    cancel() {
      if (settled) return;
      worker.postMessage({ type: "cancel" });
      // Not terminated here: the worker answers `canceled`, which settles the
      // promise through the normal path so callers see one shape of ending.
    },
  };
}
