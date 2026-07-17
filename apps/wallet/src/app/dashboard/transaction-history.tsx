"use client";

import { useState, useMemo, useTransition } from "react";
import { formatUsd } from "@repo/ui";
import { Scissors, FileText, Plus, Loader2, RefreshCcw, Banknote, DollarSign } from "lucide-react";
import { loadMoreTransactions } from "../actions";

interface LedgerEntry {
  id: string;
  reason: string;
  deltaMicros: number;
  createdAt: string | Date;
  fileName?: string | null;
  cardInfo?: string | null;
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

function getIconForReason(reason: string) {
  switch (reason) {
    case "ai_cut":
      return <Scissors className="h-[14px] w-[14px]" />;
    case "transcription":
      return <FileText className="h-[14px] w-[14px]" />;
    case "purchase":
    case "auto_recharge":
    case "grant":
      return <Plus className="h-[14px] w-[14px]" />;
    case "refund":
    case "reclaim":
      return <RefreshCcw className="h-[14px] w-[14px]" />;
    case "conversion":
      return <Banknote className="h-[14px] w-[14px]" />;
    default:
      return <DollarSign className="h-[14px] w-[14px]" />;
  }
}

export function TransactionHistory({ entries: initialEntries }: TransactionHistoryProps) {
  const [hideZero, setHideZero] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>(initialEntries);
  const [isPending, startTransition] = useTransition();
  const [hasMore, setHasMore] = useState(initialEntries.length >= 50);

  const displayedEntries = hideZero
    ? entries.filter((entry) => entry.deltaMicros !== 0)
    : entries;

  const groupedEntries = useMemo(() => {
    const groups: { dateKey: string; entries: LedgerEntry[]; netMicros: number }[] = [];
    let currentGroupKey = "";
    
    for (const entry of displayedEntries) {
      const entryDate = new Date(entry.createdAt);
      const dateStr = entryDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: entryDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      });
      
      const isToday = dateStr === new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const groupKey = isToday ? `Today · ${dateStr}` : dateStr;
      
      if (groupKey !== currentGroupKey) {
        groups.push({ dateKey: groupKey, entries: [], netMicros: 0 });
        currentGroupKey = groupKey;
      }
      
      const currentGroup = groups[groups.length - 1];
      currentGroup.entries.push(entry);
      currentGroup.netMicros += entry.deltaMicros;
    }
    
    return groups;
  }, [displayedEntries]);

  const handleLoadMore = () => {
    if (entries.length === 0) return;
    const oldestEntry = entries[entries.length - 1];
    
    startTransition(async () => {
      try {
        const olderEntries = await loadMoreTransactions(
          typeof oldestEntry.createdAt === "string" ? oldestEntry.createdAt : oldestEntry.createdAt.toISOString()
        );
        
        if (olderEntries.length > 0) {
          setEntries((prev) => [...prev, ...olderEntries]);
        }
        
        if (olderEntries.length < 50) {
          setHasMore(false);
        }
      } catch (err) {
        console.error("Failed to load more transactions", err);
      }
    });
  };

  return (
    <section
      className="wallet-fade-in flex flex-col p-6 rounded-2xl"
      aria-label="Transaction history"
      style={{ background: "var(--wallet-surface)", border: "1px solid var(--wallet-border)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--wallet-text-primary)" }}
        >
          Transaction history
        </h2>
        <label
          className="flex items-center gap-2 text-[11px] cursor-pointer select-none"
          style={{ color: "var(--wallet-text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="h-3.5 w-3.5 rounded-sm border-gray-600 bg-transparent text-[#fffc00] focus:ring-0 focus:ring-offset-0"
          />
          Hide $0.00 entries
        </label>
      </div>

      <div className="flex flex-col">
        {groupedEntries.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--wallet-text-tertiary)" }}>
            No transactions yet.
          </div>
        ) : (
          <div className="flex flex-col overflow-y-auto custom-scrollbar gap-4" style={{ maxHeight: "700px" }}>
            {groupedEntries.map((group) => (
              <div key={group.dateKey} className="flex flex-col">
                <div className="flex items-center justify-between text-[11px] font-bold mb-3 px-1">
                  <span style={{ color: "var(--wallet-text-primary)" }}>{group.dateKey}</span>
                  <span style={{ color: "var(--wallet-text-secondary)" }}>
                    Net {group.netMicros >= 0 ? "+" : "-"}{formatUsd(Math.abs(group.netMicros))}
                  </span>
                </div>
                
                <div className="flex flex-col gap-1">
                  {group.entries.map((entry) => {
                    const isDeposit = entry.deltaMicros > 0;
                    const isZero = entry.deltaMicros === 0;
                    const label = REASON_LABELS[entry.reason] ?? entry.reason.replace(/_/g, " ");
                    const subtitle = entry.reason === "purchase" || entry.reason === "auto_recharge" ? entry.cardInfo : entry.fileName;

                    return (
                      <div
                        key={entry.id}
                        className="group flex items-center justify-between px-3 py-2 rounded-xl transition-colors duration-150"
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px]"
                            style={{ background: "#111111", color: "var(--wallet-text-secondary)" }}
                          >
                            {getIconForReason(entry.reason)}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[12px] font-semibold capitalize" style={{ color: "var(--wallet-text-primary)" }}>
                              {label}
                            </span>
                            {subtitle && (
                              <span className="text-[10px]" style={{ color: "var(--wallet-text-tertiary)" }}>
                                {subtitle}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className="text-[12px] font-bold tabular-nums"
                          style={{ color: isDeposit && !isZero ? "var(--wallet-success)" : "var(--wallet-text-primary)" }}
                        >
                          {isDeposit && !isZero ? "+" : ""}{!isDeposit && !isZero ? "-" : ""}{formatUsd(Math.abs(entry.deltaMicros))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {hasMore && (
          <button
            onClick={handleLoadMore}
            disabled={isPending}
            className="w-full mt-6 py-2.5 rounded-full text-[12px] font-bold transition-colors flex justify-center items-center gap-2"
            style={{ 
              background: "#111111", 
              color: "var(--wallet-text-secondary)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wallet-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--wallet-text-secondary)")}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </>
            ) : (
              "Show earlier transactions"
            )}
          </button>
        )}
      </div>
    </section>
  );
}
