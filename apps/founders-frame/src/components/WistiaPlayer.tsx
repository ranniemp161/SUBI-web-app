"use client";

import { useEffect } from "react";

interface WistiaPlayerProps {
  mediaId: string;
  aspect?: number;
  className?: string;
}

export default function WistiaPlayer({ mediaId, aspect = 1.7777777777777777, className = "" }: WistiaPlayerProps) {
  useEffect(() => {
    // Load main player script if missing
    if (!document.querySelector(`script[src="https://fast.wistia.com/player.js"]`)) {
      const script = document.createElement("script");
      script.src = "https://fast.wistia.com/player.js";
      script.async = true;
      document.body.appendChild(script);
    }

    // Load media specific script if missing
    const mediaScriptUrl = `https://fast.wistia.com/embed/${mediaId}.js`;
    if (!document.querySelector(`script[src="${mediaScriptUrl}"]`)) {
      const mediaScript = document.createElement("script");
      mediaScript.src = mediaScriptUrl;
      mediaScript.async = true;
      mediaScript.type = "module";
      document.body.appendChild(mediaScript);
    }
  }, [mediaId]);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 ${className}`}>
      {/* @ts-expect-error custom element */}
      <wistia-player media-id={mediaId} aspect={aspect}></wistia-player>
    </div>
  );
}
