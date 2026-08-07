import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Money helpers used to live here. They are in `@repo/billing/pricing` now —
// one definition of what a minute costs, shared by the server that charges for
// it and the client that displays it. Import that subpath directly (not the
// `@repo/billing` barrel, which reaches the database).

export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipProviderProps,
} from "./tooltip";

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
