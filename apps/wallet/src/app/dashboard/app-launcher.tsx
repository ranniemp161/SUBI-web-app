"use client";

import React from "react";
import { Scissors, PieChart, Image as ImageIcon, ArrowRight } from "lucide-react";
import { ROUGH_CUT_URL } from "@/lib/env";

export function AppLauncher() {
  return (
    <section aria-label="Ecosystem Apps" className="wallet-fade-in flex flex-col gap-4">
      <h2
        className="text-sm font-semibold tracking-wide uppercase px-2"
        style={{ color: "var(--wallet-text-secondary)" }}
      >
        Subi Apps
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Active App: Rough Cut */}
        <a
          href={ROUGH_CUT_URL + "/dashboard"}
          className="wallet-card group relative p-5 flex flex-col gap-4 overflow-hidden transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          
          <div className="flex items-center justify-between">
            <div
              className="p-2 rounded-xl"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-accent)",
              }}
            >
              <Scissors size={24} strokeWidth={2} />
            </div>
            <ArrowRight
              size={18}
              className="text-gray-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
            />
          </div>
          
          <div>
            <h3 className="font-bold text-lg" style={{ color: "var(--wallet-text-primary)" }}>
              Rough Cut
            </h3>
            <p className="text-sm mt-1" style={{ color: "var(--wallet-text-secondary)" }}>
              AI-powered video cutting and transcription.
            </p>
          </div>
        </a>

        {/* Coming Soon: Infographics */}
        <div
          className="wallet-card relative p-5 flex flex-col gap-4 overflow-hidden opacity-75 grayscale-[0.3]"
          style={{ cursor: "not-allowed", background: "var(--wallet-surface-raised)" }}
        >
          <div className="flex items-center justify-between">
            <div
              className="p-2 rounded-xl"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              <PieChart size={24} strokeWidth={2} />
            </div>
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full uppercase tracking-wider"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              Coming Soon
            </span>
          </div>
          
          <div>
            <h3 className="font-bold text-lg" style={{ color: "var(--wallet-text-tertiary)" }}>
              Infographics
            </h3>
            <p className="text-sm mt-1" style={{ color: "var(--wallet-text-tertiary)" }}>
              Automated data visualization from transcripts.
            </p>
          </div>
        </div>

        {/* Coming Soon: Thumbnail */}
        <div
          className="wallet-card relative p-5 flex flex-col gap-4 overflow-hidden opacity-75 grayscale-[0.3]"
          style={{ cursor: "not-allowed", background: "var(--wallet-surface-raised)" }}
        >
          <div className="flex items-center justify-between">
            <div
              className="p-2 rounded-xl"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              <ImageIcon size={24} strokeWidth={2} />
            </div>
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full uppercase tracking-wider"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              Coming Soon
            </span>
          </div>
          
          <div>
            <h3 className="font-bold text-lg" style={{ color: "var(--wallet-text-tertiary)" }}>
              Thumbnail
            </h3>
            <p className="text-sm mt-1" style={{ color: "var(--wallet-text-tertiary)" }}>
              AI-generated youtube thumbnails.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
}
