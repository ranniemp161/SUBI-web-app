"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

/** Shared styling for the two select-style controls in the export cluster (AC-8). */
export const dropdownTriggerClass =
  "flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-transparent px-2 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50";
export const dropdownOptionClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-foreground/10";

/**
 * A design-token-styled listbox replacing the browser's native `<select>`
 * chrome (AC-8), built on Radix Select rather than hand-rolled dismiss/focus
 * logic (the pattern packages/ui/src/confirm-dialog.tsx already established:
 * prefer Radix over reimplementing focus trapping, ESC handling, and overlay
 * dismissal). Radix supplies arrow-key navigation between options and
 * restores focus to the trigger on close for free.
 */
export function StyledSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <Select.Trigger id={id} title={title} aria-label={label} className={dropdownTriggerClass}>
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="h-3.5 w-3.5" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          align="end"
          className="z-20 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-foreground/10 bg-background py-1 shadow-lg"
        >
          <Select.Viewport>
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className={`${dropdownOptionClass} cursor-pointer select-none outline-none data-[highlighted]:bg-foreground/10 data-[state=checked]:text-blue-300 data-[state=unchecked]:text-foreground/70`}
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator className="ml-auto">
                  <Check className="h-3.5 w-3.5" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
