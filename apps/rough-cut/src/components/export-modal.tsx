import { useState, useEffect } from "react";
import { X, Video, FileVideo2, FileText, Download, Loader2, Info } from "lucide-react";
import { cn } from "@repo/ui";

export type ExportFormat = "mp4" | "fcpxml" | "cmx3600" | "xmeml";
export type ExportResolution = "source" | 1080 | 720;

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportMp4: (maxHeight: number | null) => void;
  onExportFcpxml: () => void;
  onExportCmx3600: () => void;
  onExportXmeml: () => void;
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
  onExportXmeml,
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
    } else if (format === "xmeml") {
      onExportXmeml();
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
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-foreground/10 bg-background shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between p-6 pb-0">
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

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-6 space-y-3">
            <h3 className="text-sm font-semibold text-foreground/80">File Type</h3>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setFormat("mp4")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all",
                  format === "mp4"
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-foreground/10 hover:border-foreground/20 hover:bg-foreground/[0.02]",
                  exportBlockedReason ? "opacity-50" : ""
                )}
              >
                <div className={cn("rounded-lg p-2", format === "mp4" ? "bg-accent text-accent-foreground" : "bg-foreground/10 text-foreground/60")}>
                  <Video className="h-4 w-4" />
                </div>
                <div>
                  <div className={cn("text-sm font-medium", format === "mp4" ? "text-accent" : "text-foreground")}>Video (MP4)</div>
                  <div className="text-xs text-foreground/60 mt-0.5">Final rendered cut</div>
                </div>
              </button>

              <button
                onClick={() => setFormat("cmx3600")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all",
                  format === "cmx3600"
                    ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500"
                    : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                  exportFormatBlockedReason ? "opacity-50" : ""
                )}
              >
                <div className={cn("rounded-lg p-2", format === "cmx3600" ? "bg-amber-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className={cn("text-sm font-medium", format === "cmx3600" ? "text-amber-500" : "text-foreground")}>DaVinci Resolve</div>
                  <div className="text-xs text-foreground/50 mt-0.5">.edl timeline</div>
                </div>
              </button>

              <button
                onClick={() => setFormat("xmeml")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all",
                  format === "xmeml"
                    ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500"
                    : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                  exportFormatBlockedReason ? "opacity-50" : ""
                )}
              >
                <div className={cn("rounded-lg p-2", format === "xmeml" ? "bg-sky-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className={cn("text-sm font-medium", format === "xmeml" ? "text-sky-500" : "text-foreground")}>Premiere Pro</div>
                  <div className="text-xs text-foreground/50 mt-0.5">.xml timeline</div>
                </div>
              </button>

              <button
                onClick={() => setFormat("fcpxml")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all",
                  format === "fcpxml"
                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                    : "border-foreground/10 hover:border-foreground/30 hover:bg-foreground/5",
                  exportFormatBlockedReason ? "opacity-50" : ""
                )}
              >
                <div className={cn("rounded-lg p-2", format === "fcpxml" ? "bg-emerald-500 text-white" : "bg-foreground/10 text-foreground/60")}>
                  <FileVideo2 className="h-4 w-4" />
                </div>
                <div>
                  <div className={cn("text-sm font-medium", format === "fcpxml" ? "text-emerald-500" : "text-foreground")}>Final Cut Pro</div>
                  <div className="text-xs text-foreground/50 mt-0.5">.fcpxml timeline</div>
                </div>
              </button>
            </div>
          </div>

          {format === "mp4" && (
            <div className="mb-2 space-y-3">
              <h3 className="text-sm font-semibold text-foreground/80">Quality</h3>
              <div className="flex gap-2">
                {(["source", 1080, 720] as const).map((res) => (
                  <button
                    key={res}
                    onClick={() => setResolution(res)}
                    className={cn(
                      "flex-1 rounded-lg border py-2.5 text-sm font-medium transition-all",
                      resolution === res
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-foreground/10 bg-transparent text-foreground hover:bg-foreground/5"
                    )}
                  >
                    {res === "source" ? "Source" : `${res}p`}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600/90 dark:text-amber-400/90">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <strong>Heavy File Warning:</strong> For videos over 1 hour or in 4K resolution, we highly recommend exporting to <strong>.fcpxml</strong> or <strong>.edl</strong>. MP4 exports process entirely on your device and can take a very long time for heavy files, consuming significant battery and CPU.
                </p>
              </div>
              <p className="text-xs text-foreground/50 mt-2">
                Downscales larger sources, never upscales.
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 p-6 pt-0">
          <button
            onClick={handleExport}
            disabled={busy || isCurrentFormatDisabled}
            title={currentBlockedReason}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/60 disabled:text-accent-foreground/70"
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
    </div>
  );
}
