import React, { forwardRef } from "react";

export type ButtonVariant = "primary" | "glass" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "font-bold transition-all disabled:opacity-40 shadow-sm active:scale-[0.98]",
  glass:
    "font-semibold text-zinc-200 bg-[#16171c] hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50 active:scale-[0.98]",
  ghost:
    "font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40",
  danger:
    "font-semibold bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "px-2.5 py-1 text-[11px] rounded-md",
  sm: "px-3.5 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2 text-xs rounded-lg",
  lg: "px-6 py-3 text-xs rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "glass", size = "sm", className = "", style, children, ...props },
    ref
  ) {
    const isPrimary = variant === "primary";

    const customStyle: React.CSSProperties = isPrimary
      ? {
          background: "var(--broll-accent)",
          color: "var(--broll-accent-foreground)",
          ...style,
        }
      : style ?? {};

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1.5 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--broll-accent)] cursor-pointer disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        style={customStyle}
        {...props}
      >
        {children}
      </button>
    );
  }
);
