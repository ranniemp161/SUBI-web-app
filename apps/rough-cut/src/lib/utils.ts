import { type ClassValue, clsx } from "clsx";

/**
 * Merge Tailwind class names conditionally.
 *
 * Uses clsx for conditional class joining. We keep this simple
 * since Tailwind v4 handles specificity better than v3 — no need
 * for tailwind-merge in most cases.
 *
 * @example cn("px-4 py-2", isActive && "bg-blue-500", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * Format milliseconds into a human-readable duration string.
 *
 * @example formatDuration(125000) → "2:05"
 * @example formatDuration(3661000) → "1:01:01"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Nearest value in a sorted ascending array to `target` (binary search).
 * Shared by every place that snaps a raw time to the nearest word edge —
 * the timeline's boundary-drag snap and the playhead-driven cut snap
 * (cutToPlayhead) both need the same "closest edge" lookup.
 */
export function nearestSorted(sorted: number[], target: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const candidate = sorted[lo];
  const prev = lo > 0 ? sorted[lo - 1] : candidate;
  return Math.abs(prev - target) <= Math.abs(candidate - target) ? prev : candidate;
}

/**
 * Format a date into a human-readable relative or absolute string.
 *
 * @example formatDate(new Date()) → "Just now"
 * @example formatDate(yesterday) → "Yesterday"
 * @example formatDate(lastWeek) → "Jun 22, 2026"
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
