"use client";

import { formatUsd } from "@repo/ui";

interface LedgerEntry {
  id: string;
  reason: string;
  deltaMicros: number;
  createdAt: string | Date;
}

interface TransactionHistoryProps {
  entries: LedgerEntry[];
}

/** Human-readable labels for credit_ledger_reason enum values. */
const REASON_LABELS: Record<string, string> = {
  purchase: "Credit purchase",
  auto_recharge: "Auto-recharge",
  transcription: "Transcription",
  ai_cut: "AI Cut",
  refund: "Refund",
  conversion: "Balance conversion",
  grant: "Monthly grant",
  hold: "Hold",
  settle: "Usage settled",
  reclaim: "Hold released",
};

/**
 * Refined ledger table: date, humanised reason, and signed dollar amount.
 * Deposits are green, charges are neutral, and there is a friendly empty state.
 */
export function TransactionHistory({ entries }: TransactionHistoryProps) {
  return (
    <section
      className="wallet-fade-in"
      aria-label="Transaction history"
      style={{ animationDelay: "240ms" }}
    >
      <h2
        className="text-lg font-semibold mb-4"
        style={{ color: "var(--wallet-text-primary)" }}
      >
        Transaction history
      </h2>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--wallet-surface)",
          border: "1px solid var(--wallet-border)",
        }}
      >
        <table className="w-full text-left">
          <thead>
            <tr
              style={{
                background: "var(--wallet-surface-raised)",
                borderBottom: "1px solid var(--wallet-border)",
              }}
            >
              <th
                className="px-5 py-3 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--wallet-text-tertiary)" }}
              >
                Date
              </th>
              <th
                className="px-5 py-3 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--wallet-text-tertiary)" }}
              >
                Description
              </th>
              <th
                className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-right"
                style={{ color: "var(--wallet-text-tertiary)" }}
              >
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-5 py-12 text-center text-sm"
                  style={{ color: "var(--wallet-text-tertiary)" }}
                >
                  <svg
                    className="mx-auto mb-3 h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{ color: "var(--wallet-text-tertiary)" }}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  No transactions yet. Your history will appear here after your
                  first purchase or usage.
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const isDeposit = entry.deltaMicros > 0;
                const date = new Date(entry.createdAt);
                const label =
                  REASON_LABELS[entry.reason] ??
                  entry.reason.replace(/_/g, " ");

                return (
                  <tr
                    key={entry.id}
                    className="transition-colors duration-150"
                    style={{
                      borderBottom: "1px solid var(--wallet-border-subtle)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "var(--wallet-surface-raised)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td
                      className="px-5 py-3.5 text-sm tabular-nums"
                      style={{ color: "var(--wallet-text-secondary)" }}
                    >
                      {date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year:
                          date.getFullYear() !== new Date().getFullYear()
                            ? "numeric"
                            : undefined,
                      })}
                    </td>
                    <td
                      className="px-5 py-3.5 text-sm font-medium capitalize"
                      style={{ color: "var(--wallet-text-primary)" }}
                    >
                      {label}
                    </td>
                    <td
                      className="px-5 py-3.5 text-sm font-semibold text-right tabular-nums"
                      style={{
                        color: isDeposit
                          ? "var(--wallet-success)"
                          : "var(--wallet-text-primary)",
                      }}
                    >
                      {isDeposit ? "+" : ""}
                      {formatUsd(entry.deltaMicros)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
