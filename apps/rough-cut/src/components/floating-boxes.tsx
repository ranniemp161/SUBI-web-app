"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface BoxConfig {
  width: number;
  height: number;
  left: string;
  top: string;
  duration: number;
  delay: number;
}

export function FloatingBoxes() {
  const [boxes, setBoxes] = useState<BoxConfig[]>([]);

  useEffect(() => {
    // Generate static random values once mounted to avoid hydration mismatch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoxes(
      [...Array(6)].map(() => ({
        width: Math.random() * 100 + 80,
        height: Math.random() * 100 + 80,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        duration: Math.random() * 15 + 10,
        delay: Math.random() * 2,
      }))
    );
  }, []);

  if (boxes.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden flex items-center justify-center">
      <div className="relative w-full h-full max-w-[1400px]">
        {boxes.map((box, i) => (
          <motion.div
            key={i}
            className="absolute rounded-3xl border border-[rgba(255,252,0,0.15)] bg-[rgba(255,252,0,0.02)] backdrop-blur-[1px]"
            style={{
              width: box.width,
              height: box.height,
              left: box.left,
              top: box.top,
            }}
            initial={{
              y: 0,
              rotate: 0,
              opacity: 0,
            }}
            animate={{
              y: [0, -200, -400],
              rotate: [0, 90, 180],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: box.duration,
              repeat: Infinity,
              ease: "linear",
              delay: box.delay,
            }}
          />
        ))}
      </div>
    </div>
  );
}
