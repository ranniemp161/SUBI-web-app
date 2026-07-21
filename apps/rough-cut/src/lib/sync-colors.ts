/**
 * Shared visual tokens between the transcript panel and the timeline bar
 * (AC-10): playhead / active-word, cross-panel selection, and hover preview
 * each read from one place so the two panels can't drift into different
 * colors for the same concept. Cut-reason colors (retake amber, AI sky,
 * repetition teal, silence red) stay local to each panel — they're per-word
 * classification, not part of the sync surface this spec unifies.
 */

/** Playhead position / the word currently being spoken — the app's accent yellow. */
export const SYNC_PLAYHEAD_CLASS = "bg-accent";
export const SYNC_PLAYHEAD_HEX = "#fffc00";

/** A cross-panel selection (transcript drag-select, timeline clip select/trim). */
export const SYNC_SELECTION_RING_CLASS = "ring-2 ring-inset ring-blue-500/80";
export const SYNC_SELECTION_BG_CLASS = "bg-blue-500/20";

/** A read-only hover preview — never mistaken for the playhead or a selection. */
export const SYNC_HOVER_RING_CLASS = "ring-1 ring-inset ring-foreground/40";
export const SYNC_HOVER_BG_CLASS = "bg-foreground/10";
export const SYNC_HOVER_LINE_CLASS = "bg-foreground/40";
