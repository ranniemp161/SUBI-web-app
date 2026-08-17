import React, { forwardRef } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  function Switch({ checked, onChange, disabled = false, label, className = "" }, ref) {
    return (
      <label
        className={`relative inline-flex items-center cursor-pointer select-none ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        } ${className}`}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
          aria-label={label}
        />
        <div
          onClick={() => !disabled && onChange(!checked)}
          className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
            checked ? "bg-[var(--broll-accent)]" : "bg-white/15"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full bg-[#111111] shadow-md transition-transform transform ${
              checked ? "translate-x-5" : "translate-x-0 bg-white"
            }`}
          />
        </div>
      </label>
    );
  }
);
