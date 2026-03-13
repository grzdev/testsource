'use client';

import { useEffect, useRef, useState } from 'react';

// ── Timing config (ms) ──────────────────────────────────────
const BADGE_START = 100;
const BADGE_DUR = 500;
const HEADING_START = BADGE_START + BADGE_DUR - 100; // overlap slightly
const CHAR_STAGGER = 40;
const SUB_GAP = 200; // gap after last heading char
const WORD_STAGGER = 35;
const INPUT_GAP = 250; // gap after last subheading word

const HEADING_TEXT = ['T', 'e', 's', 't'];
const HEADING_ACCENT = ['S', 'o', 'u', 'r', 'c', 'e'];
const allChars = [...HEADING_TEXT, ...HEADING_ACCENT];

const SUB_WORDS = [
  'Paste', 'any', 'GitHub', 'repository,', 'pull', 'request,', 'or', 'issue',
  'to', 'instantly', 'understand', '{{project health}},', '{{contributor readiness}},',
  'and', 'how', 'to', 'test', 'it', 'with', '{{TestSprite}}.',
];

interface HeroProps {
  onInputReveal?: () => void;
}

export default function Hero({ onInputReveal }: HeroProps) {
  const [phase, setPhase] = useState(0); // 0=waiting, 1=badge, 2=heading, 3=sub, 4=input
  const [badgeVisible, setBadgeVisible] = useState(false);
  const [visibleChars, setVisibleChars] = useState(0);
  const [visibleWords, setVisibleWords] = useState(0);
  const inputFired = useRef(false);

  useEffect(() => {
    // Phase 1: Badge pops in
    const t1 = setTimeout(() => {
      setPhase(1);
      setBadgeVisible(true);
    }, BADGE_START);

    // Phase 2: Heading chars reveal
    const headingStart = HEADING_START;
    const charTimers: ReturnType<typeof setTimeout>[] = [];
    allChars.forEach((_, i) => {
      charTimers.push(
        setTimeout(() => setVisibleChars(i + 1), headingStart + i * CHAR_STAGGER)
      );
    });

    // Phase 3: Subheading words reveal
    const subStart = headingStart + allChars.length * CHAR_STAGGER + SUB_GAP;
    const wordTimers: ReturnType<typeof setTimeout>[] = [];
    SUB_WORDS.forEach((_, i) => {
      wordTimers.push(
        setTimeout(() => setVisibleWords(i + 1), subStart + i * WORD_STAGGER)
      );
    });

    // Phase 4: Input reveal
    const inputStart = subStart + SUB_WORDS.length * WORD_STAGGER + INPUT_GAP;
    const t4 = setTimeout(() => {
      setPhase(4);
      if (onInputReveal && !inputFired.current) {
        inputFired.current = true;
        onInputReveal();
      }
    }, inputStart);

    return () => {
      clearTimeout(t1);
      clearTimeout(t4);
      charTimers.forEach(clearTimeout);
      wordTimers.forEach(clearTimeout);
    };
  }, [onInputReveal]);

  function renderWord(raw: string, i: number) {
    const visible = i < visibleWords;
    // Match {{highlighted text}} with optional trailing punctuation
    const highlight = raw.match(/^\{\{(.+?)\}\}(.*)$/);
    const text = highlight ? highlight[1] : raw;
    const trailing = highlight ? highlight[2] : '';
    const isTestSprite = text.startsWith('TestSprite');
    const isBold = highlight && !isTestSprite;

    return (
      <span
        key={i}
        className="inline-block transition-all duration-300 ease-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          marginRight: '0.3em',
        }}
      >
        {isTestSprite ? (
          <>
            <a
              href="https://testsprite.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-block text-emerald-400 font-semibold"
            >
              {text}
              <span className="absolute left-0 bottom-0 right-0 h-px bg-gradient-to-r from-emerald-500/0 via-emerald-400/60 to-emerald-500/0" />
            </a>
            {trailing}
          </>
        ) : isBold ? (
          <><span className="text-slate-300 font-medium">{text}</span>{trailing}</>
        ) : (
          text
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center text-center pt-20 md:pt-36 pb-10 px-4 w-full">
      {/* Badge — pop in with bounce */}
      <div
        className={`badge-glow inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-gradient-to-r from-emerald-500/12 to-emerald-500/6 border text-emerald-400 text-xs font-semibold tracking-wide mb-7 backdrop-blur-sm transition-[opacity,transform] duration-500 ${
          badgeVisible
            ? 'opacity-100 scale-100 badge-bounce'
            : 'opacity-0 scale-50'
        }`}
      >
        <svg
          className="w-4 h-4 flex-shrink-0 badge-icon-float"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
        Know the Codebase Before You Touch It
      </div>

      {/* Heading — character-by-character from left to right */}
      <h1 className="text-5xl sm:text-6xl font-bold font-mono tracking-tight leading-none mb-5 whitespace-nowrap">
        {HEADING_TEXT.map((ch, i) => (
          <span
            key={`t${i}`}
            className="inline-block text-white transition-all duration-200 ease-out"
            style={{
              opacity: i < visibleChars ? 1 : 0,
              transform: i < visibleChars ? 'translateY(0)' : 'translateY(14px)',
            }}
          >
            {ch}
          </span>
        ))}
        {HEADING_ACCENT.map((ch, i) => {
          const idx = HEADING_TEXT.length + i;
          return (
            <span
              key={`a${i}`}
              className="inline-block text-emerald-400 transition-all duration-200 ease-out"
              style={{
                opacity: idx < visibleChars ? 1 : 0,
                transform: idx < visibleChars ? 'translateY(0)' : 'translateY(14px)',
              }}
            >
              {ch}
            </span>
          );
        })}
        {/* Underline appears after all chars visible */}
        <span className="block relative h-0.5 mx-auto mt-1">
          <span
            className="absolute left-0 right-0 h-px bg-gradient-to-r from-emerald-500/0 via-emerald-400/60 to-emerald-500/0 transition-opacity duration-500"
            style={{ opacity: visibleChars >= allChars.length ? 1 : 0 }}
          />
        </span>
      </h1>

      {/* Subheading — word-by-word from left to right */}
      <p className="mt-2 text-base sm:text-lg text-slate-400 max-w-xl md:max-w-[44rem] mx-auto leading-relaxed">
        {SUB_WORDS.map((w, i) => renderWord(w, i))}
      </p>
    </div>
  );
}
