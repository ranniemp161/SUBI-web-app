import { reportError } from "@/lib/observability";

/**
 * Notification seam for auto-recharge events (ADR 0002/0002 decision 4).
 *
 * The ADR deliberately leaves the CHANNEL undecided (umbrella 0002 Follow-up:
 * "Notifications channel for auto-recharge ... Settle when the notifications
 * approach is chosen; not a blocker for the charge logic"). So this is a single
 * seam, not a provider: it records the event now (log + Sentry breadcrumb) and
 * is the one place to wire email/in-app later, without touching the charge code.
 *
 * Picking an email/in-app provider is an architecture decision — route it
 * through /architect before turning this into a real send.
 */
export type AutoRechargeNotice =
  | { kind: "recharged"; amountMicros: number }
  | { kind: "declined"; failures: number }
  | { kind: "disabled"; failures: number };

export async function notifyAutoRecharge(
  userId: string,
  notice: AutoRechargeNotice
): Promise<void> {
  // Placeholder delivery: make the event visible in logs/Sentry until a channel
  // is chosen. Never throws — a notification failure must not affect billing.
  try {
    console.warn(
      `[auto-recharge notice] user=${userId} kind=${notice.kind} ` +
        JSON.stringify(notice)
    );
    reportError(
      `Auto-recharge notification (${notice.kind}) — no channel wired yet`,
      new Error("notification channel not configured"),
      { userId, ...notice }
    );
  } catch {
    // Swallow: notifications are best-effort and off the billing path.
  }
}
