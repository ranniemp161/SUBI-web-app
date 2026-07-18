'use client';

import { useRef } from 'react';
import Image from 'next/image';
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'framer-motion';

export function ChapterTimeline({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.7'],
  });
  const scaleY = useSpring(scrollYProgress, { stiffness: 70, damping: 22 });

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Faint hint of the path before it is drawn */}
      <div className="absolute left-0 top-1 bottom-0 w-px bg-white/5" />
      {/* The line draws itself as the reader scrolls */}
      <motion.div
        style={reduce ? undefined : { scaleY }}
        className="absolute left-0 top-1 bottom-0 w-px origin-top bg-gradient-to-b from-brand/60 via-brand/25 to-transparent"
      />
      {children}
    </div>
  );
}

export function ChapterBlock({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const ghostY = useTransform(scrollYProgress, [0, 1], [48, -48]);

  return (
    <div ref={ref} className="relative pl-10 md:pl-16 pb-20 last:pb-8">
      {/* Node ignites when the chapter enters view */}
      <motion.span
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
        className="absolute left-[-7px] top-[6px] w-[15px] h-[15px] rounded-full bg-brand shadow-[0_0_16px_rgba(255,255,0,0.6)] ring-4 ring-brand/10"
      />
      {/* Ghost chapter number drifts against the prose */}
      <motion.span
        aria-hidden="true"
        style={reduce ? undefined : { y: ghostY }}
        className="absolute right-0 -top-10 text-[7rem] md:text-[9rem] leading-none font-heading font-bold text-white/[0.04] select-none pointer-events-none"
      >
        {number}
      </motion.span>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.21, 0.47, 0.32, 0.98] }}
        className="relative"
      >
        <p className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase mb-3">
          Chapter {number}
        </p>
        <h2 className="text-2xl md:text-4xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent leading-tight pb-1 mb-6">
          {title}
        </h2>
      </motion.div>
      <div className="space-y-5 text-gray-300 text-base md:text-lg leading-relaxed relative">
        {children}
      </div>
    </div>
  );
}

export function ChapterFigure({
  src,
  alt,
  width,
  height,
  caption,
  frame = 'photo',
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  frame?: 'photo' | 'browser';
}) {
  const reduce = useReducedMotion();

  return (
    <figure className="pt-4">
      <motion.div
        initial={reduce ? false : { rotate: -5, opacity: 0 }}
        whileInView={{ rotate: frame === 'photo' ? -1.5 : 0, opacity: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.9, ease: [0.21, 0.47, 0.32, 0.98] }}
        whileHover={{ rotate: 0 }}
        className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0c0c0e]"
      >
        {frame === 'browser' && (
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-brand/40" />
          </div>
        )}
        <motion.div
          initial={reduce ? false : { clipPath: 'inset(0 0 100% 0)' }}
          whileInView={{ clipPath: 'inset(0 0 0% 0)' }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.21, 0.47, 0.32, 0.98] }}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes="(max-width: 768px) 100vw, 720px"
            className="w-full h-auto object-cover"
          />
        </motion.div>
      </motion.div>
      <figcaption className="text-gray-500 text-xs md:text-sm mt-4 text-center">
        {caption}
      </figcaption>
    </figure>
  );
}
