import Image from 'next/image';
import { GitPullRequest, Plus, Minus, FileCode2, Layout } from 'lucide-react';
import type { PRAnalysis, PRFocusType } from '@/lib/types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const focusColors: Record<PRFocusType, string> = {
  'frontend-focused': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'backend/API-focused': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'mixed': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'config/docs only': 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

const stateBadge: Record<string, string> = {
  open:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  closed: 'bg-red-500/15 text-red-300 border-red-500/30',
  merged: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-5 py-2.5 text-sm">
      <span className="text-slate-500 font-medium">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function PRReportCard({ result }: { result: PRAnalysis }) {
  const { meta, repoMeta, focusType, changedAreas, files, workflow, description, preflightHints } = result;

  const sortedFiles = [...files].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );

  return (
    <div className="space-y-4">
      {/* ── Row 1: PR meta + description/files (2-col grid) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* PR Meta card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3">
            <Image
              src={repoMeta.avatarUrl}
              alt="repo owner"
              width={24}
              height={24}
              className="rounded-full border border-slate-700 flex-shrink-0"
              unoptimized
            />
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              PR Summary
            </h3>
          </div>
          <div className="divide-y divide-slate-800/60">
            <Row label="Title">
              <span className="text-white leading-snug font-medium">{meta.title}</span>
            </Row>
            <Row label="Author">
              <span className="text-slate-300">@{meta.author}</span>
            </Row>
            <Row label="State">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stateBadge[meta.state] ?? 'text-slate-400 border-slate-600'}`}>
                <GitPullRequest className="w-3 h-3" />
                {meta.state}
              </span>
            </Row>
            <Row label="Created">
              <span className="text-slate-300">{formatDate(meta.createdAt)}</span>
            </Row>
            <Row label="Branches">
              <span className="text-slate-400 font-mono text-xs">{meta.baseBranch} ← {meta.headBranch}</span>
            </Row>
            <Row label="Files changed">
              <span className="flex items-center gap-3">
                <span className="text-slate-300">{meta.changedFiles} file{meta.changedFiles !== 1 ? 's' : ''}</span>
                <span className="flex items-center gap-0.5 text-xs text-emerald-400"><Plus className="w-3 h-3" />{meta.additions}</span>
                <span className="flex items-center gap-0.5 text-xs text-red-400"><Minus className="w-3 h-3" />{meta.deletions}</span>
              </span>
            </Row>
            <Row label="PR Focus">
              <span className={`inline-flex w-fit items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${focusColors[focusType]}`}>
                {focusType}
              </span>
            </Row>
          </div>
        </div>

        {/* Description + changed areas card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Overview</h3>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs text-slate-500 font-medium mb-1.5">Description</p>
              <p className="text-slate-300 text-sm leading-relaxed">{description}</p>
            </div>
            {changedAreas.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 font-medium mb-1.5 flex items-center gap-1.5">
                  <Layout className="w-3.5 h-3.5" /> Changed areas
                </p>
                <div className="flex flex-wrap gap-2">
                  {changedAreas.map(area => (
                    <span key={area} className="inline-block px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-xs">
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Modified files card — full width ─────────── */}
      {sortedFiles.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-2">
              <FileCode2 className="w-3.5 h-3.5" /> Modified files
            </h3>
          </div>
          <ul className="divide-y divide-slate-800/40">
            {sortedFiles.slice(0, 12).map(f => (
              <li key={f.filename} className="flex items-center gap-3 px-5 py-2 text-xs">
                <span className="text-slate-400 font-mono truncate flex-1 min-w-0">{f.filename}</span>
                <span className="text-emerald-400 flex-shrink-0 flex items-center gap-0.5"><Plus className="w-3 h-3" />{f.additions}</span>
                <span className="text-red-400 flex-shrink-0 flex items-center gap-0.5"><Minus className="w-3 h-3" />{f.deletions}</span>
              </li>
            ))}
          </ul>
        </div>
      )}


    </div>
  );
}

