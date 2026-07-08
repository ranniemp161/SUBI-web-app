import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and de-conflict Tailwind utilities.
 *
 * `clsx` resolves conditionals/arrays/objects into a class string; `twMerge`
 * then resolves Tailwind conflicts so the last utility wins (e.g.
 * `cn("px-2", "px-4")` → `"px-4"`). The shared helper for both apps (ADR 0001).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
