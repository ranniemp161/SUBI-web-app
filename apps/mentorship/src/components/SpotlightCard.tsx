"use client";

import { ReactNode } from "react";

interface SpotlightCardProps {
  number: string;
  title: string;
  description: string;
  icon?: ReactNode;
}

export default function SpotlightCard({ number, title, description, icon }: SpotlightCardProps) {
  return (
    <div className="group relative rounded-2xl border border-white/10 bg-[#111115] p-8 transition-all duration-300 hover:-translate-y-1.5 hover:border-yellow-400/50 hover:shadow-[0_0_30px_rgba(255,255,0,0.15)] flex flex-col justify-between">
      <div className="absolute top-0 right-0 h-24 w-24 rounded-bl-full bg-gradient-to-bl from-yellow-400/5 to-transparent transition-opacity group-hover:from-yellow-400/15" />
      
      <div>
        <div className="flex items-center justify-between mb-6">
          <span className="text-3xl font-black text-yellow-400 tracking-wider font-mono">
            {number}
          </span>
          {icon && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-yellow-400 group-hover:scale-110 group-hover:border-yellow-400/30 transition-all">
              {icon}
            </div>
          )}
        </div>

        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-yellow-400 transition-colors">
          {title}
        </h3>

        <p className="text-gray-400 text-sm leading-relaxed">
          {description}
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 flex items-center text-xs font-semibold text-yellow-400/80 group-hover:text-yellow-400 transition-colors">
        <span>Core Strategy</span>
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </div>
  );
}
