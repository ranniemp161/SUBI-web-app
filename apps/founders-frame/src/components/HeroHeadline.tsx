'use client';

import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.21, 0.47, 0.32, 0.98] as const;
const STAGGER = 0.045;
const START = 0.15;

export default function HeroHeadline() {
  const reduce = useReducedMotion();
  let wordIndex = 0;

  const word = (text: string, className = '') => {
    const i = wordIndex++;
    return (
      <motion.span
        key={`${i}-${text}`}
        initial={reduce ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: START + i * STAGGER, ease: EASE }}
        className={`inline-block ${className}`}
      >
        {text}
      </motion.span>
    );
  };

  const words = (text: string, className = '') =>
    text.split(' ').map((t, k) => (
      <span key={k} className="inline-block">
        {word(t, className)}
        <span>&nbsp;</span>
      </span>
    ));

  return (
    <h1 className="relative text-4xl md:text-6xl lg:text-7xl font-heading font-bold tracking-tight leading-[1.15] max-w-4xl mb-8">
      {words('People buy from people they know, like, and')}
      {word(
        'trust.',
        'bg-gradient-to-r from-brand to-yellow-200 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(255,255,0,0.3)]'
      )}
      <br />
      {words('It is time to get in')}
      <span className="relative inline-block whitespace-nowrap px-4 py-1">
        {words('the frame.')}
        <motion.span
          aria-hidden="true"
          initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
          animate={{ clipPath: 'inset(0 0% 0 0)' }}
          transition={{ duration: 0.8, delay: START + 16 * STAGGER + 0.35, ease: [0.21, 0.47, 0.32, 0.98] }}
          className="absolute inset-0 border-[3px] border-brand rounded-xl -rotate-2 pointer-events-none shadow-[0_0_18px_rgba(255,255,0,0.35),inset_0_0_18px_rgba(255,255,0,0.15)]"
        />
      </span>
    </h1>
  );
}
