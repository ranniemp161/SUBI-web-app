"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Film } from "lucide-react";
import { dropdownOptionClass, dropdownTriggerClass } from "@/components/editor/styled-select";

/**
 * The export cluster's format menu (AC-16): one styled trigger, matching the
 * resolution dropdown, opening two action entries (FCPXML, CMX 3600 EDL).
 * Each entry immediately generates and downloads its format, then closes —
 * there's no persisted selection, just two actions behind one control. Built
 * on Radix DropdownMenu for the same reason as StyledSelect above: this is a
 * menu of actions, not a value picker, so DropdownMenu (not Select) is the
 * semantic fit.
 */
export function ExportFormatMenu({
  onExportFcpxml,
  onExportCmx3600,
  disabled,
  title,
}: {
  onExportFcpxml?: () => void;
  onExportCmx3600?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        title={title ?? "Export cut list for DaVinci Resolve or Premiere Pro"}
        className={dropdownTriggerClass}
      >
        <Film className="h-4 w-4" />
        For DaVinci / Premiere
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-20 min-w-[12rem] overflow-hidden rounded-lg border border-foreground/10 bg-background py-1 shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={() => onExportFcpxml?.()}
            className={`${dropdownOptionClass} cursor-pointer select-none outline-none data-[highlighted]:bg-foreground/10`}
          >
            FCPXML (.fcpxml)
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onExportCmx3600?.()}
            className={`${dropdownOptionClass} cursor-pointer select-none outline-none data-[highlighted]:bg-foreground/10`}
          >
            CMX 3600 EDL (.edl)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
