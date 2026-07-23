"use client";

import { useEffect } from "react";

interface CalendlyWidgetProps {
  url?: string;
  height?: string;
}

export default function CalendlyWidget({
  url = "https://calendly.com/tunjibamgbola/30min",
  height = "700px",
}: CalendlyWidgetProps) {
  useEffect(() => {
    // Load Calendly script dynamically
    const scriptUrl = "https://assets.calendly.com/assets/external/widget.js";
    if (!document.querySelector(`script[src="${scriptUrl}"]`)) {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="w-full rounded-2xl overflow-hidden glass-panel border border-white/10 shadow-2xl p-2 bg-[#0c0c0e]">
      <div
        className="calendly-inline-widget w-full rounded-xl"
        data-url={url}
        style={{ minWidth: "320px", height: height }}
      />
    </div>
  );
}
