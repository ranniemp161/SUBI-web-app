"use client";

/**
 * Centered radial progress with the percentage inside the ring — the
 * prominent "what's happening right now" indicator used on dashboard project
 * cards (extract / upload / transcribe) and the studio's AI Cut overlay.
 */
export default function ProgressRing({
  percent,
  size = 72,
  strokeWidth = 5,
}: {
  /** 0–100; clamped. */
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(59 130 246)" /* blue-500 */
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute font-semibold tabular-nums text-white" style={{ fontSize: size / 4 }}>
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
