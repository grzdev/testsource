'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Hero from '@/components/Hero';
import RepoInput, { type AnalysisMode } from '@/components/RepoInput';
import { useScrollReveal } from '@/components/useScrollReveal';

const FEATURE_CARDS = [
  {
    mode: 'repo' as AnalysisMode,
    accent: 'emerald',
    icon: (
      <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
      </svg>
    ),
    title: 'Repository Insights',
    description: 'Project health, contributor readiness, testing signals.',
    tags: ['Health Score', 'CI/CD', 'Docs'],
    badge: { color: 'emerald', label: 'Repo' },
    example: 'github.com/vercel/next.js',
  },
  {
    mode: 'pr' as AnalysisMode,
    accent: 'violet',
    icon: (
      <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: 'Pull Request Analysis',
    description: 'Changed areas, testing focus, and validation guidance.',
    tags: ['Diff Scope', 'Test Plan', 'Risk'],
    badge: { color: 'violet', label: 'PR' },
    example: 'github.com/pnpm/pnpm/pull/10920',
  },
  {
    mode: 'issue' as AnalysisMode,
    accent: 'sky',
    icon: (
      <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
    ),
    title: 'Issue Breakdown',
    description: 'Contribution signals, work status, and issue quality.',
    tags: ['Open?', 'Complexity', 'Next Step'],
    badge: { color: 'sky', label: 'Issue' },
    example: 'github.com/facebook/react/issues/28779',
  },
];

// Colour maps for accent colours used in cards
const ACCENT_RING: Record<string, string> = {
  emerald: 'hover:border-emerald-500/40 hover:shadow-[0_0_28px_rgba(16,185,129,0.10)]',
  violet: 'hover:border-violet-500/40 hover:shadow-[0_0_28px_rgba(139,92,246,0.10)]',
  sky: 'hover:border-sky-500/40 hover:shadow-[0_0_28px_rgba(14,165,233,0.10)]',
};

const ACCENT_ICON_BG: Record<string, string> = {
  emerald: 'bg-emerald-500/10 border-emerald-500/20',
  violet: 'bg-violet-500/10 border-violet-500/20',
  sky: 'bg-sky-500/10 border-sky-500/20',
};

const ACCENT_TAG: Record<string, string> = {
  emerald: 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/15',
  violet: 'bg-violet-500/8 text-violet-400/80 border-violet-500/15',
  sky: 'bg-sky-500/8 text-sky-400/80 border-sky-500/15',
};

const ACCENT_CODE: Record<string, string> = {
  emerald: 'text-emerald-400/75',
  violet: 'text-violet-400/75',
  sky: 'text-sky-400/75',
};

const ACCENT_BADGE: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
};

export default function Home() {
  const router = useRouter();
  const [inputReady, setInputReady] = useState(false);
  const [cardsReady, setCardsReady] = useState(false);
  const revealRef = useScrollReveal();

  const handleInputReveal = useCallback(() => setInputReady(true), []);

  // Fade in feature cards 500ms after the input appears
  useEffect(() => {
    if (!inputReady) return;
    const t = setTimeout(() => setCardsReady(true), 500);
    return () => clearTimeout(t);
  }, [inputReady]);

  function handleAnalyze(url: string, _mode: AnalysisMode) {
    router.push('/results?url=' + encodeURIComponent(url));
  }

  return (
    <main className="min-h-screen bg-slate-950 bg-grid text-white overflow-x-hidden">
      {/* ── Hero + Input ─────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-6 flex flex-col items-center">
        <Hero onInputReveal={handleInputReveal} />
        <div
          className="mt-1 pb-2 w-full max-w-2xl transition-all duration-500 ease-out"
          style={{
            opacity: inputReady ? 1 : 0,
            transform: inputReady ? 'translateY(0)' : 'translateY(18px)',
          }}
        >
          <RepoInput onAnalyze={handleAnalyze} loading={false} />
        </div>
      </div>

      {/* ── Feature cards ──────────────────────────────────── */}
      <div className="max-w-[1320px] mx-auto px-6 pb-24">
        <div
          ref={revealRef}
          className="mt-20 pt-4 md:pt-8 transition-all duration-600 ease-out"
          style={{
            opacity: cardsReady ? 1 : 0,
            transform: cardsReady ? 'translateY(0)' : 'translateY(20px)',
          }}
        >
              {/* Section label */}
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest text-center mb-5">
                What you can analyze
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {FEATURE_CARDS.map((card, i) => (
                  <div
                    key={card.mode}
                    data-reveal
                    data-reveal-delay={String(i * 80)}
                    className={`group relative bg-slate-900 border border-slate-800/80 rounded-2xl p-5 card-hover flex flex-col gap-3 cursor-default overflow-hidden transition-[border-color,box-shadow] duration-200 ${ACCENT_RING[card.accent]}`}
                  >
                    {/* Subtle corner glow on hover */}
                    <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-2xl bg-current pointer-events-none"
                      style={{ color: card.accent === 'emerald' ? 'rgba(16,185,129,0.08)' : card.accent === 'violet' ? 'rgba(139,92,246,0.08)' : 'rgba(14,165,233,0.08)' }}
                    />

                    {/* Top row: icon + badge */}
                    <div className="flex items-center justify-between">
                      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${ACCENT_ICON_BG[card.accent]}`}>
                        {card.icon}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${ACCENT_BADGE[card.accent]}`}>
                        {card.badge.label}
                      </span>
                    </div>

                    {/* Title + description */}
                    <div>
                      <h3 className="text-white font-semibold text-sm leading-snug">{card.title}</h3>
                      <p className="text-slate-400 text-xs leading-relaxed mt-0.5">{card.description}</p>
                    </div>

                    {/* Signal tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {card.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded border ${ACCENT_TAG[card.accent]}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Example URL */}
                    <code className={`text-[11px] font-mono bg-slate-800/70 px-2.5 py-1.5 rounded-md block truncate mt-auto ${ACCENT_CODE[card.accent]}`}>
                      {card.example}
                    </code>
                  </div>
                ))}
              </div>

              {/* Bottom hint */}
              <p className="text-center text-xs text-slate-600 mt-8">
                 Free to try
              </p>
        </div>
      </div>
    </main>
  );
}
