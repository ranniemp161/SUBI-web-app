import React from "react";

export interface StatChipProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function StatChip({ label, value, className = "" }: StatChipProps) {
  return (
    <div
      className={`px-3 py-1.5 rounded-lg bg-[#141518] border border-white/10 text-xs text-zinc-400 broll-tabular flex items-center gap-1.5 ${className}`}
    >
      <span>{label}</span>
      <strong className="text-zinc-200 font-semibold">{value}</strong>
    </div>
  );
}
