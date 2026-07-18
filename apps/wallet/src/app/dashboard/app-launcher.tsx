"use client";

import React from "react";
import { Scissors } from "lucide-react";
import { ROUGH_CUT_URL } from "@/lib/env";

export function AppLauncher() {
  return (
    <section 
      aria-label="Works with apps" 
      className="wallet-fade-in flex flex-col p-6 rounded-2xl gap-4"
      style={{ background: "var(--wallet-surface)", border: "1px solid var(--wallet-border)" }}
    >
      <h2
        className="text-xs font-bold uppercase tracking-wide"
        style={{ color: "var(--wallet-text-secondary)" }}
      >
        Works with
      </h2>
      
      <div className="flex flex-col gap-2">
        {/* Active App: MyFirstCut */}
        <a
          href={ROUGH_CUT_URL + "/dashboard"}
          className="group relative px-4 py-3.5 flex items-center gap-4 rounded-xl transition-all duration-200 hover:bg-white/5"
          style={{ background: "var(--wallet-surface-sunken)" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{
              background: "#fffc00",
              color: "#000",
            }}
          >
            <Scissors size={20} strokeWidth={2.5} />
          </div>
          
          <div className="flex flex-col">
            <h3 className="font-bold text-sm" style={{ color: "var(--wallet-text-primary)" }}>
              MyFirstCut
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--wallet-text-secondary)" }}>
              AI video cutting & transcription
            </p>
          </div>
        </a>

        {/* Coming Soon: Infographics */}
        <div
          className="relative px-4 py-3.5 flex items-center gap-4 rounded-xl"
          style={{ background: "var(--wallet-surface-sunken)", opacity: 0.6 }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
            style={{ background: "transparent" }}
          >
          </div>
          
          <div className="flex flex-col">
            <h3 className="font-bold text-sm" style={{ color: "var(--wallet-text-secondary)" }}>
              Infographics
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--wallet-text-tertiary)" }}>
              Coming soon
            </p>
          </div>
        </div>

        {/* Coming Soon: Thumbnail */}
        <div
          className="relative px-4 py-3.5 flex items-center gap-4 rounded-xl"
          style={{ background: "var(--wallet-surface-sunken)", opacity: 0.6 }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
            style={{ background: "transparent" }}
          >
          </div>
          
          <div className="flex flex-col">
            <h3 className="font-bold text-sm" style={{ color: "var(--wallet-text-secondary)" }}>
              Thumbnail
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--wallet-text-tertiary)" }}>
              Coming soon
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
