"use client";

import { X } from "lucide-react";

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Space / K", label: "Play / pause" },
  { keys: "J / L", label: "Jump back / forward 5s" },
  { keys: "← / →", label: "Step 1s (Shift = 5s)" },
  { keys: ", / .", label: "Nudge 0.1s" },
  { keys: "↑ / ↓", label: "Previous / next edit point" },
  { keys: "Home / End", label: "Jump to start / end" },
  { keys: "Click word", label: "Seek to that word" },
  { keys: "Shift-click + Delete", label: "Cut selected words" },
  { keys: "Q / W", label: "Trim clip to playhead — left / right" },
  { keys: "S", label: "Split clip at playhead" },
  { keys: "Click clip + Delete", label: "Select a clip, then delete it" },
  { keys: "Click a cut", label: "Restore it" },
  { keys: "Drag handle", label: "Trim a cut edge (Alt = free, no snap)" },
  { keys: "= / − / 0", label: "Zoom in / out / fit timeline" },
  { keys: "⌘Z / ⇧⌘Z", label: "Undo / redo" },
  { keys: "?", label: "Toggle this help" },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-foreground/10 bg-background p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-foreground/60">{s.label}</span>
              <kbd className="rounded-md border border-foreground/10 bg-foreground/5 px-2 py-0.5 font-mono text-xs text-foreground/80">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
