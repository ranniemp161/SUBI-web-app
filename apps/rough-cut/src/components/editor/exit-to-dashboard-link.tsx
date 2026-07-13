"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@repo/ui";

/**
 * Blocking "leave the editor?" exit link (ADR 0003 child 3). Replaces the old
 * fire-and-forget toast: clicking it opens a real confirm dialog instead of
 * navigating immediately, so the exit is an impossible-to-miss decision. Kept
 * as a self-contained component (own dialog state + router) so both the
 * StatusScreen and TopBar exit points get the same copy and behavior even
 * though StatusScreen renders as an early return, before the editor body.
 */
export function ExitToDashboardLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Leave the editor?"
        description="Your edits are saved automatically. To reopen this project, reselect the same source video from your computer."
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={() => router.push("/dashboard")}
      />
    </>
  );
}
