import { useState, useEffect } from "react";
import { X, Video, FileVideo2, FileText, Download, Loader2 } from "lucide-react";
import { cn } from "@repo/ui";

export type ExportFormat = "mp4" | "fcpxml" | "cmx3600";
export type ExportResolution = "source" | 1080 | 720;

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportMp4: (maxHeight: number | null) => void;
  onExportFcpxml: () => void;
  onExportCmx3600: () => void;
  exportBlockedReason?: string;
  exportFormatBlockedReason?: string;
  busy: boolean;
}

export function ExportModal({
  isOpen,
  onClose,
  onExportMp4,
  onExportFcpxml,
  onExportCmx3600,
  exportBlockedReason,
  exportFormatBlockedReason,
  busy,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [resolution, setResolution] = useState<ExportResolution>("source");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExport = () => {
    if (format === "mp4") {
      onExportMp4(resolution === "source" ? null : resolution);
    } else if (format === "fcpxml") {
      onExportFcpxml();
      onClose(); // Close immediately for synchronous exports
    } else if (format === "cmx3600") {
      onExportCmx3600();
      onClose(); // Close immediately for synchronous exports
    }
  };

  const currentBlockedReason =
    format === "mp4" ? exportBlockedReason : exportFormatBlockedReason;
  const isCurrentFormatDisabled = Boolean(currentBlockedReason);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-foreground/10 bg-background p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">Export Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold text-foreground/80">File Type</h3>
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => setFormat("mp4")}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                format === "mp4"
                  ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500"
                  : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                exportBlockedReason ? "opacity-50" : ""
              )}
            >
              <div className={cn("rounded-lg p-2.5", format === "mp4" ? "bg-blue-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                <Video className="h-5 w-5" />
              </div>
              <div>
                <div className={cn("font-medium", format === "mp4" ? "text-blue-500" : "text-foreground")}>Video (MP4)</div>
                <div className="text-xs text-foreground/50 mt-0.5">Render and download the final cut</div>
              </div>
            </button>

            <button
              onClick={() => setFormat("cmx3600")}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                format === "cmx3600"
                  ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500"
                  : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                exportFormatBlockedReason ? "opacity-50" : ""
              )}
            >
              <div className={cn("rounded-lg p-2.5", format === "cmx3600" ? "bg-amber-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className={cn("font-medium", format === "cmx3600" ? "text-amber-500" : "text-foreground")}>DaVinci Resolve / Premiere Pro (.edl)</div>
                <div className="text-xs text-foreground/50 mt-0.5">Timeline data for DaVinci & Premiere</div>
              </div>
            </button>

            <button
              onClick={() => setFormat("fcpxml")}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                format === "fcpxml"
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                  : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                exportFormatBlockedReason ? "opacity-50" : ""
              )}
            >
              <div className={cn("rounded-lg p-2.5", format === "fcpxml" ? "bg-emerald-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                <FileVideo2 className="h-5 w-5" />
              </div>
              <div>
                <div className={cn("font-medium", format === "fcpxml" ? "text-emerald-500" : "text-foreground")}>Final Cut Pro (.fcpxml)</div>
                <div className="text-xs text-foreground/50 mt-0.5">Timeline data for Final Cut Pro</div>
              </div>
            </button>
          </div>
        </div>

        {format === "mp4" && (
          <div className="mb-8 space-y-3">
            <h3 className="text-sm font-semibold text-foreground/80">Quality</h3>
            <div className="flex gap-2">
              {(["source", 1080, 720] as const).map((res) => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className={cn(
                    "flex-1 rounded-lg border py-2.5 text-sm font-medium transition-all",
                    resolution === res
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-foreground/10 bg-transparent text-foreground hover:bg-foreground/5"
                  )}
                >
                  {res === "source" ? "Source" : `${res}p`}
                </button>
              ))}
            </div>
            <p className="text-xs text-foreground/50 mt-2">
              Downscales larger sources, never upscales.
            </p>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={busy || isCurrentFormatDisabled}
          title={currentBlockedReason}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-600/60 disabled:text-white/70"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 motion-safe:animate-spin" />
          ) : (
            <Download className="h-5 w-5" />
          )}
          {busy ? "Exporting..." : "Export Now"}
        </button>
      </div>
    </div>
  );
}
