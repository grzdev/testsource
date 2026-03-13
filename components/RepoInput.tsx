'use client';

import { useState } from 'react';
import { Search, GitPullRequest, GitBranch, CircleDot } from 'lucide-react';

export type AnalysisMode = 'repo' | 'pr' | 'issue';

interface Props {
  onAnalyze: (url: string, mode: AnalysisMode) => void;
  loading: boolean;
  initialUrl?: string;
}

export function detectMode(url: string): AnalysisMode {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    if (parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3])) return 'pr';
    if (parts.length >= 4 && parts[2] === 'issues' && /^\d+$/.test(parts[3])) return 'issue';
  } catch {
    // fall through to repo default
  }
  return 'repo';
}

const MODE_INDICATORS: Record<AnalysisMode, { label: string; color: string; icon: React.ReactNode }> = {
  repo: {
    label: 'Repository',
    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    icon: <GitBranch className="w-3.5 h-3.5" />,
  },
  pr: {
    label: 'Pull Request',
    color: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
    icon: <GitPullRequest className="w-3.5 h-3.5" />,
  },
  issue: {
    label: 'Issue',
    color: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
    icon: <CircleDot className="w-3.5 h-3.5" />,
  },
};

const BUTTON_COLORS: Record<AnalysisMode, string> = {
  repo: 'bg-emerald-600 hover:bg-emerald-500',
  pr: 'bg-violet-600 hover:bg-violet-500',
  issue: 'bg-sky-600 hover:bg-sky-500',
};

export default function RepoInput({ onAnalyze, loading, initialUrl = '' }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const detectedMode = detectMode(url);
  const hasUrl = url.trim().length > 0;
  const indicator = MODE_INDICATORS[detectedMode];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onAnalyze(trimmed, detectMode(trimmed));
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2 w-full">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo  or  …/pull/123  or  …/issues/456"
            className="w-full bg-slate-900 border border-slate-700 text-white placeholder-slate-500 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-colors disabled:opacity-50"
            disabled={loading}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !hasUrl}
          className={`px-6 py-3 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed ${BUTTON_COLORS[detectedMode]}`}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>
      {/* Detection indicator */}
      {hasUrl && (
        <div className="flex items-center gap-1.5 ml-0.5">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${indicator.color}`}>
            {indicator.icon}
            {indicator.label} detected
          </span>
        </div>
      )}
    </div>
  );
}

