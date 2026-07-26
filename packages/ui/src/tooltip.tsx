"use client";

/**
 * Shared hover/focus tooltip for the SUBI ecosystem — the second component
 * `@repo/ui` ships, following the same shape as `confirm-dialog.tsx`: a thin
 * themed wrapper over a Radix primitive rather than a hand-rolled popover.
 * Radix already owns the hover/focus timing, the dismissal on Escape and
 * pointer-down, the collision-aware placement, and the `aria-describedby`
 * wiring that makes the hint reachable by screen readers — none of which
 * the native `title` attribute gives us with usable timing or styling.
 *
 * Styled only with the ecosystem tokens both apps share (background/foreground
 * in theme.css), so it renders correctly in either app.
 *
 * Usage: wrap a group of tooltips in one `TooltipProvider` — sharing a provider
 * is what gives a toolbar its "hover the next button and it opens instantly"
 * feel, since Radix skips the open delay while the group is already warm.
 *
 *   <TooltipProvider>
 *     <Tooltip label="Split clip at playhead" keys="S">
 *       <button …>…</button>
 *     </Tooltip>
 *   </TooltipProvider>
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";

/** How long the pointer must rest on a trigger before the first tooltip opens. */
const DELAY_MS = 300;

export interface TooltipProviderProps {
  children: React.ReactNode;
  /** Override the shared open delay, in milliseconds. */
  delayDuration?: number;
}

export function TooltipProvider({
  children,
  delayDuration = DELAY_MS,
}: TooltipProviderProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  /** The hint text. */
  label: string;
  /** Optional keyboard shortcut, rendered as a keycap chip beside the label. */
  keys?: string;
  side?: "top" | "right" | "bottom" | "left";
  /**
   * The trigger. Rendered with `asChild`, so this must be a single element that
   * forwards its ref and props — pass your own `<button>` and it keeps its own
   * classes, `aria-pressed`, and click handler.
   */
  children: React.ReactNode;
}

export function Tooltip({ label, keys, side = "top", children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground/80 shadow-lg"
        >
          {label}
          {keys && (
            <kbd className="rounded-md border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">
              {keys}
            </kbd>
          )}
          <RadixTooltip.Arrow className="fill-background" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
