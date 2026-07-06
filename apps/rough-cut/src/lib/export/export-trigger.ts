import type { EDL } from "@/lib/edl";
import type { ExportErrorCode, ExportRequestMessage, ExportResponseMessage } from "@/lib/export/types";

export interface ExportHandle {
  cancel: () => void;
}

export interface ExportCallbacks {
  onProgress: (processedSeconds: number, totalSeconds: number) => void;
  onDone: () => void;
  onError: (message: string, code: ExportErrorCode) => void;
}

export type ExportSupport = { supported: true } | { supported: false; reason: string };

/** Checks the APIs the export pipeline needs, without starting anything. */
export function isExportSupported(): ExportSupport {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return { supported: false, reason: "Export requires Chrome or Edge (WebCodecs isn't available)." };
  }
  if (typeof window === "undefined" || typeof window.showSaveFilePicker !== "function") {
    return {
      supported: false,
      reason: "Your browser can't save files directly. Please update Chrome or Edge.",
    };
  }
  return { supported: true };
}

/**
 * Starts an export: opens a native save dialog (must run within the click's
 * user-activation), then hands the source file + EDL + save-target handle to
 * a Worker. FileSystemFileHandle is structured-cloneable (unlike the
 * writable stream it produces), so the worker creates its own writable and
 * owns the write/close/abort lifecycle end to end — nothing streams back
 * through postMessage.
 *
 * Throws (with `name: "AbortError"`) if the user cancels the save dialog —
 * callers should treat that as a silent no-op, not a failure.
 */
export async function startExport(
  file: File,
  edl: EDL,
  suggestedName: string,
  callbacks: ExportCallbacks,
  options: { maxHeight?: number } = {}
): Promise<ExportHandle> {
  const baseName = suggestedName.replace(/\.[^./\\]+$/, "");

  const handle = await window.showSaveFilePicker!({
    suggestedName: `${baseName}-export.mp4`,
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });

  const worker = new Worker(new URL("../../workers/export-worker.ts", import.meta.url), {
    type: "module",
  });

  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    fn();
  };

  worker.onmessage = (event: MessageEvent<ExportResponseMessage>) => {
    const message = event.data;
    if (message.type === "progress") {
      callbacks.onProgress(message.processedSeconds, message.totalSeconds);
    } else if (message.type === "done") {
      finish(() => callbacks.onDone());
    } else if (message.type === "error") {
      finish(() => callbacks.onError(message.message, message.code));
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    finish(() => callbacks.onError(event.message || "Export failed unexpectedly.", "unknown"));
  };

  const startMessage: ExportRequestMessage = {
    type: "start",
    file,
    edl,
    handle,
    maxHeight: options.maxHeight,
  };
  worker.postMessage(startMessage);

  return {
    cancel: () => {
      const cancelMessage: ExportRequestMessage = { type: "cancel" };
      worker.postMessage(cancelMessage);
    },
  };
}
