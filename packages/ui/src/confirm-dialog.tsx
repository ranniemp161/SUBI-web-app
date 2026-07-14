"use client";

/**
 * Shared blocking confirm dialog for the SUBI ecosystem (ADR 0003 child 3) —
 * the first real component `@repo/ui` ships. Built on Radix AlertDialog, which
 * already solves focus trapping, ESC handling, overlay dismissal, and the
 * correct ARIA roles for a confirm, so this is a thin, themed wrapper rather
 * than a hand-rolled dialog. Controlled (no built-in trigger): the caller owns
 * `open`/`onOpenChange`, opening it in place of an immediate action.
 *
 * Styled only with the ecosystem tokens both apps share (background/foreground,
 * plus the focus-visible ring in theme.css), so it renders correctly in either
 * app without pulling in app-specific tokens.
 */

import * as AlertDialog from "@radix-ui/react-alert-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-foreground/10 bg-background p-6 text-foreground shadow-2xl">
          <AlertDialog.Title className="text-lg font-bold text-foreground">
            {title}
          </AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="mt-1.5 text-sm text-foreground/60">
              {description}
            </AlertDialog.Description>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <AlertDialog.Cancel className="cursor-pointer rounded-lg border border-foreground/10 bg-foreground/[0.03] px-4 py-2 text-xs font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground">
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground shadow-md shadow-[var(--accent-shadow)] transition-colors hover:bg-accent-hover"
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
