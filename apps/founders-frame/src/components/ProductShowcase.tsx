'use client';

import { useRef } from 'react';
import Image from 'next/image';
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from 'framer-motion';

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

function WindowChrome() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
      <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
      <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
      <span className="w-2.5 h-2.5 rounded-full bg-brand/40" />
    </div>
  );
}

export default function ProductShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const backY = useTransform(scrollYProgress, [0, 1], [20, -20]);
  const frontY = useTransform(scrollYProgress, [0, 1], [40, -35]);

  return (
    <div ref={ref} className="relative pr-2 md:pr-6">
      {/* Ambient glow behind the stack */}
      <div className="absolute inset-0 m-auto w-2/3 h-2/3 bg-brand/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="relative">
        {/* Back window: Editor Studio */}
        <motion.div
          style={reduce ? undefined : { y: backY }}
          initial={reduce ? false : { opacity: 0, y: 40, rotate: 2.5 }}
          whileInView={{ opacity: 1, y: 0, rotate: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: EASE }}
          className="relative rotate-1"
        >
          <motion.div
            animate={reduce ? undefined : { y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
            className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0c0c0e]"
          >
            <WindowChrome />
            <Image
              src="/assets/editor-studio.webp"
              alt="The MyFirstCut editor studio with video, transcript, and cut timeline"
              width={1400}
              height={662}
              sizes="(max-width: 1024px) 100vw, 640px"
              className="w-full h-auto object-cover"
            />
            <span className="absolute top-11 right-3 px-3 py-1 rounded-full glass-panel text-[10px] md:text-xs font-medium text-gray-300">
              Editor Studio
            </span>
          </motion.div>
        </motion.div>

        {/* Front window: Project Dashboard */}
        <motion.div
          style={reduce ? undefined : { y: frontY }}
          initial={reduce ? false : { opacity: 0, y: 60, rotate: -4 }}
          whileInView={{ opacity: 1, y: 0, rotate: -2 }}
          whileHover={{ rotate: 0, scale: 1.03 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
          className="absolute -bottom-6 md:-bottom-8 -left-3 md:-left-10 w-[62%] -rotate-2 z-10"
        >
          <motion.div
            animate={reduce ? undefined : { y: [0, -14, 0] }}
            transition={{ repeat: Infinity, duration: 7.5, ease: 'easeInOut', delay: 0.8 }}
            className="relative rounded-xl overflow-hidden border border-white/10 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.8)] bg-[#0c0c0e]"
          >
            <WindowChrome />
            <Image
              src="/assets/project-dashboard.webp"
              alt="The MyFirstCut project dashboard with uploads and recent projects"
              width={1000}
              height={477}
              sizes="(max-width: 1024px) 62vw, 400px"
              className="w-full h-auto object-cover"
            />
            <span className="absolute top-10 right-3 px-3 py-1 rounded-full glass-panel text-[10px] md:text-xs font-medium text-gray-300">
              Project Dashboard
            </span>
          </motion.div>
        </motion.div>
      </div>

      {/* Title card */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.4, ease: EASE }}
        className="relative mt-16 md:mt-20 text-center"
      >
        <p className="text-[10px] md:text-xs tracking-[0.35em] uppercase text-gray-500">
          The Founder&apos;s Frame presents
        </p>
        <p className="mt-2 font-heading font-bold text-xl md:text-2xl bg-gradient-to-r from-brand to-yellow-200 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(255,255,0,0.25)]">
          MyFirstCut App
        </p>
      </motion.div>
    </div>
  );
}
