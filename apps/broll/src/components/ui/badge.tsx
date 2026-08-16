import React from "react";

export type BadgeVariant =
  | "accent"
  | "success"
  | "warning"
  | "neutral"
  | "outline"
  | "danger";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantStyles: Record<BadgeVariant, string> = {
  accent:
    "bg-[var(--broll-accent)]/10 text-[var(--broll-accent)] border border-[var(--broll-accent)]/30",
  success:
    "bg-emerald-400/10 text-emerald-300 border border-emerald-400/30",
  warning:
    "bg-amber-400/10 text-amber-300 border border-amber-400/30",
  neutral:
    "bg-white/5 text-zinc-400 border border-white/10",
  outline:
    "bg-transparent text-zinc-300 border border-white/15",
  danger:
    "bg-red-500/10 text-red-300 border border-red-500/20",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[9px] rounded",
  md: "px-2 py-0.5 text-[10px] rounded-md",
};

export function Badge({
  variant = "neutral",
  size = "md",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
