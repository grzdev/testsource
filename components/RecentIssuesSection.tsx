'use client';

import { CircleDot, ExternalLink } from 'lucide-react';
import type { RecentIssue, IssueLabel } from '@/lib/types';

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
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-2">
          <CircleDot className="w-3.5 h-3.5" />
          Recent Open Issues
        </h3>
      </div>

      {issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
          <CircleDot className="w-6 h-6 opacity-30" />
          <span className="text-sm">No issues in this repo yet</span>
        </div>
      ) : (
      <ul className="divide-y divide-slate-800/60">
        {issues.map(issue => (
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

