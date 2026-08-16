import React from "react";

export type CardVariant = "default" | "elevated" | "glow" | "subtle";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  default: "bg-[#111215] border border-white/[0.08] rounded-xl",
  elevated: "bg-[#16171c] border border-white/10 rounded-2xl shadow-xl",
  glow: "broll-glow rounded-2xl bg-[#111215]",
  subtle: "bg-white/[0.02] border border-white/5 rounded-xl",
};

export function Card({
  variant = "default",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div className={`${variantStyles[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}
