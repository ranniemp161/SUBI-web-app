import type { EDL } from "@/lib/edl";

/** Messages the main thread sends to the export worker. */
export type ExportRequestMessage =
  | {
      type: "start";
      file: File;
      edl: EDL;
      /**
       * FileSystemFileHandle is structured-cloneable (unlike the writable
       * stream it produces), so the worker receives the handle itself and
       * calls `createWritable()` on its side — it owns the write, close, and
       * abort lifecycle end to end.
       */
      handle: FileSystemFileHandle;
    }
  | { type: "cancel" };

/** Messages the export worker sends back to the main thread. */
export type ExportResponseMessage =
  | { type: "progress"; processedSeconds: number; totalSeconds: number }
  | { type: "done" }
  | { type: "error"; code: ExportErrorCode; message: string };

export type ExportErrorCode =
  | "unsupported-codec"
  | "empty-timeline"
  | "decode-failed"
  | "encode-failed"
  | "cancelled"
  | "unknown";
