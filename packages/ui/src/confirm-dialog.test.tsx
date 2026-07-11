// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

afterEach(() => {
  cleanup();
});

// ConfirmDialog is the shared Radix AlertDialog wrapper from ADR 0003 child 3
// (AC-8's exit-confirm dialog is built on it). It's controlled — open/
// onOpenChange live in the caller — so these tests exercise the contract the
// callers depend on.

describe("ConfirmDialog — closed state", () => {
  it("renders nothing in the document when open is false", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Leave the editor?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("Leave the editor?")).toBeNull();
  });
});

describe("ConfirmDialog — open state", () => {
  it("shows the title and description with the alertdialog role", async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Leave the editor?"
        description="Unsaved changes will be lost."
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={vi.fn()}
      />
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeVisible();
    expect(screen.getByText("Leave the editor?")).toBeVisible();
    expect(screen.getByText("Unsaved changes will be lost.")).toBeVisible();
  });

  it("renders no description text when description is omitted", async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete this project?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
      />
    );
    await screen.findByRole("alertdialog");
    // Only the title text should be present — no stray empty description node.
    expect(screen.getByRole("alertdialog").textContent).not.toContain("undefined");
  });

  it("exposes accessible names on both buttons matching confirmLabel/cancelLabel", async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Leave the editor?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={vi.fn()}
      />
    );
    await screen.findByRole("alertdialog");
    expect(screen.getByRole("button", { name: "Leave" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeVisible();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Leave the editor?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={onConfirm}
      />
    );
    await user.click(await screen.findByRole("button", { name: "Leave" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) and not onConfirm when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Leave the editor?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={onConfirm}
      />
    );
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
