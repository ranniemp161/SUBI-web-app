"use client";

import { ArrowLeft, Clapperboard, Download, Loader2, Redo2, Undo2, X } from "lucide-react";
import { ExitToDashboardLink } from "@/components/editor/exit-to-dashboard-link";
import { StyledSelect } from "@/components/editor/styled-select";
import { ExportFormatMenu } from "@/components/editor/export-format-menu";

export function TopBar({
  fileName,
  savedAt,
  onUndo,
  onRedo,
  disabled,
  onExport,
  onCancelExport,
  exportBlockedReason,
  exportState = "idle",
  exportMaxHeight = null,
  onExportMaxHeightChange,
  onExportFcpxml,
  onExportCmx3600,
  exportFormatBlockedReason,
}: {
  fileName: string;
  savedAt: "saved" | "saving";
  onUndo?: () => void;
  onRedo?: () => void;
  disabled?: boolean;
  onExport?: () => void;
  onCancelExport?: () => void;
  // Non-empty when the Export button should be disabled in the idle state (no
  // source re-selected, or the browser can't export); doubles as the tooltip.
  exportBlockedReason?: string;
  exportState?: "idle" | "starting" | "exporting" | "cancelling";
  // Output resolution cap for export; null = source resolution.
  exportMaxHeight?: number | null;
  onExportMaxHeightChange?: (height: number | null) => void;
  // Exports the current EDL as an FCPXML file for DaVinci Resolve / Premiere Pro.
  onExportFcpxml?: () => void;
  // Exports the current EDL as a CMX 3600 EDL file, the alternate interchange format.
  onExportCmx3600?: () => void;
  // Non-empty when both format export options should be disabled (no kept EDL yet); doubles as the tooltip.
  exportFormatBlockedReason?: string;
}) {
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
  const busy = exportState !== "idle";
  const exportDisabled = busy || Boolean(exportBlockedReason);
  const exportFormatDisabled = Boolean(exportFormatBlockedReason);
  // Cancel is offered only once a cancellable handle exists — not during
  // "starting" (save dialog open, nothing to cancel yet).
  const showCancel = exportState === "exporting" || exportState === "cancelling";
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
      <div className="flex items-center gap-3">
        <ExitToDashboardLink className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </ExitToDashboardLink>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/15 text-blue-300">
            <Clapperboard className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
              {fileName}
            </div>
            <div
              aria-live="polite"
              className="flex items-center gap-1 text-[11px] text-foreground/55"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${savedAt === "saving" ? "bg-amber-400" : "bg-emerald-400"
                  }`}
              />
              {savedAt === "saving" ? "Saving…" : "All changes saved"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-foreground/10">
          <button type="button" onClick={onUndo} disabled={disabled} aria-label="Undo" className={iconBtn}>
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRedo} disabled={disabled} aria-label="Redo" className={iconBtn}>
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <StyledSelect
          id="export-quality"
          label="Export resolution"
          value={exportMaxHeight === null ? "source" : String(exportMaxHeight)}
          onChange={(v) => onExportMaxHeightChange?.(v === "source" ? null : Number(v))}
          disabled={busy}
          title="Export resolution — downscales larger sources, never upscales"
          options={[
            { value: "source", label: "Source" },
            { value: "1080", label: "1080p" },
            { value: "720", label: "720p" },
          ]}
        />
        <ExportFormatMenu
          onExportFcpxml={onExportFcpxml}
          onExportCmx3600={onExportCmx3600}
          disabled={exportFormatDisabled}
          title={exportFormatBlockedReason}
        />
        {showCancel && (
          <button
            type="button"
            onClick={onCancelExport}
            disabled={exportState === "cancelling"}
            title="Cancel export"
            className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {exportState === "cancelling" ? "Cancelling…" : "Cancel"}
          </button>
        )}
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          title={exportBlockedReason ?? "Export to MP4"}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-600/60 disabled:text-white/70 disabled:hover:bg-blue-600/60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {busy ? "Exporting…" : "Export"}
        </button>
      </div>
    </div>
  );
}
