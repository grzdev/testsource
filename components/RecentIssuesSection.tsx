'use client';

import { useState } from 'react';
import { CircleDot, Bug, Zap, ExternalLink } from 'lucide-react';
import type { RecentIssue, IssueLabel } from '@/lib/types';

type Filter = 'all' | 'bug' | 'feature';

function isBugLabel(name: string) {
  return /\bbug\b/i.test(name);
}

function isFeatureLabel(name: string) {
  return /\bfeature\b|\benhancement\b|\bimprovement\b/i.test(name);
}

function labelTextColor(hex: string): string {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1e293b' : '#f1f5f9';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function RecentIssuesSection({ issues }: { issues: RecentIssue[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  if (issues.length === 0) return null;

  const filtered = issues.filter(issue => {
    if (filter === 'all') return true;
    if (filter === 'bug') return issue.labels.some(l => isBugLabel(l.name));
    return issue.labels.some(l => isFeatureLabel(l.name));
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-2">
          <CircleDot className="w-3.5 h-3.5" />
          Recent Open Issues
        </h3>
        <div className="flex items-center gap-1">
          {(['all', 'bug', 'feature'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? f === 'bug'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : f === 'feature'
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'bg-slate-700 text-slate-200 border border-slate-600'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {f === 'bug' && <Bug className="w-3 h-3" />}
              {f === 'feature' && <Zap className="w-3 h-3" />}
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-6 text-center text-slate-500 text-sm">
          No {filter} issues found.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800/60">
          {filtered.map(issue => (
            <li key={issue.number} className="px-5 py-3 flex items-start gap-3 hover:bg-slate-800/30 transition-colors">
              <CircleDot className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-slate-200 hover:text-emerald-400 font-medium leading-snug transition-colors flex items-center gap-1 min-w-0"
                  >
                    <span className="truncate">{issue.title}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                  </a>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-slate-500">#{issue.number} · {formatDate(issue.createdAt)}</span>
                  {issue.labels.slice(0, 4).map((label: IssueLabel) => (
                    <span
                      key={label.name}
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        backgroundColor: `#${label.color}`,
                        color: labelTextColor(label.color),
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
