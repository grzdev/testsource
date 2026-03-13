'use client';

import { MessageSquare, User, Tag, Calendar, Target, AlertCircle, CheckCircle2, XCircle, Clock, Milestone } from 'lucide-react';
import type { IssueAnalysis, IssueWorkStatus, IssueRecommendation } from '@/lib/types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function labelTextColor(hex: string): string {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1e293b' : '#f1f5f9';
}

const workStatusConfig: Record<
  IssueWorkStatus,
  { icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  'Likely still open for contribution': {
    icon: <CheckCircle2 className="w-5 h-5" />,
    color: 'text-emerald-300',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
  },
  'Someone is likely already working on this': {
    icon: <Clock className="w-5 h-5" />,
    color: 'text-amber-300',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
  },
  'Probably already fixed / addressed': {
    icon: <CheckCircle2 className="w-5 h-5" />,
    color: 'text-sky-300',
    bg: 'bg-sky-400/10',
    border: 'border-sky-400/30',
  },
  'Closed issue': {
    icon: <XCircle className="w-5 h-5" />,
    color: 'text-slate-400',
    bg: 'bg-slate-400/10',
    border: 'border-slate-400/30',
  },
};

const recommendationConfig: Record<
  IssueRecommendation,
  { color: string; bg: string; border: string }
> = {
  'Good first contribution candidate': {
    color: 'text-emerald-300',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
  },
  'Open but likely in progress': {
    color: 'text-amber-300',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
  },
  'Needs clarification before contributing': {
    color: 'text-orange-300',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/30',
  },
  'Probably already addressed': {
    color: 'text-slate-400',
    bg: 'bg-slate-400/10',
    border: 'border-slate-400/30',
  },
};

const qualityColors: Record<string, string> = {
  Excellent: 'text-emerald-300',
  Good: 'text-sky-300',
  Fair: 'text-amber-300',
  Poor: 'text-red-300',
};

function QualityRow({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {present ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-slate-600 flex-shrink-0" />
      )}
      <span className={present ? 'text-slate-300' : 'text-slate-600'}>{label}</span>
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 px-5 py-2.5 text-sm">
      <span className="text-slate-500 font-medium">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function IssueReportCard({ result }: { result: IssueAnalysis }) {
  const { meta, repoMeta, workStatus, quality, recommendation } = result;
  const wsConf = workStatusConfig[workStatus.status];
  const recConf = recommendationConfig[recommendation];

  const stateColor = meta.state === 'open' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
    : 'text-slate-400 border-slate-500/40 bg-slate-500/10';

  return (
    <div className="space-y-4">
      {/* â”€â”€ Row 1: Issue Summary + Work Status (2-col grid) â”€â”€â”€ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Issue Summary card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-xs text-slate-500 font-mono mb-0.5">{repoMeta.fullName}</p>
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
              Issue Summary
            </h3>
          </div>
          <div className="divide-y divide-slate-800/60">
            <Row label="Title">
              <span className="text-white leading-snug">#{meta.number} {meta.title}</span>
            </Row>
            <Row label="State">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stateColor}`}>
                {meta.state === 'open' ? <AlertCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {meta.state}
              </span>
            </Row>
            <Row label={<span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Author</span>}>
              <span className="text-slate-300">@{meta.author}</span>
            </Row>
            <Row label={<span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Created</span>}>
              <span className="text-slate-300">{formatDate(meta.createdAt)}</span>
            </Row>
            <Row label={<span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Comments</span>}>
              <span className="text-slate-300">{meta.comments}</span>
            </Row>
            {meta.assignees.length > 0 && (
              <Row label={<span className="flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Assignees</span>}>
                <span className="text-slate-300">{meta.assignees.map(a => `@${a}`).join(', ')}</span>
              </Row>
            )}
            {meta.milestone && (
              <Row label={<span className="flex items-center gap-1.5"><Milestone className="w-3.5 h-3.5" /> Milestone</span>}>
                <span className="text-slate-300">{meta.milestone}</span>
              </Row>
            )}
            {meta.labels.length > 0 && (
              <div className="px-5 py-3">
                <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mb-2">
                  <Tag className="w-3.5 h-3.5" /> Labels
                </p>
                <div className="flex flex-wrap gap-2">
                  {meta.labels.map(label => (
                    <span
                      key={label.name}
                      className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: `#${label.color}`, color: labelTextColor(label.color) }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Work Status card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Work Status</h3>
          </div>
          <div className="p-5 space-y-3">
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${wsConf.bg} border ${wsConf.border} ${wsConf.color}`}>
              {wsConf.icon}
              <span className="font-semibold text-sm">{workStatus.status}</span>
            </div>
            {workStatus.signals.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {workStatus.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 flex-shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* â”€â”€ Row 2: Issue Quality + Final Recommendation (2-col grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Issue Quality card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Issue Quality</h3>
            <span className={`text-sm font-bold ${qualityColors[quality.qualityLabel]}`}>
              {quality.qualityLabel}
              <span className="text-slate-500 font-normal text-xs">&nbsp;({quality.qualityScore}/5)</span>
            </span>
          </div>
          <div className="p-5 space-y-2">
            <QualityRow label="Reproduction steps described" present={quality.hasReproductionSteps} />
            <QualityRow label="Expected vs. actual behavior" present={quality.hasExpectedVsActual} />
            <QualityRow label="Screenshots or logs included" present={quality.hasScreenshotsOrLogs} />
            <QualityRow label="Environment details provided" present={quality.hasEnvironmentDetails} />
            <QualityRow label="good first issue / help wanted" present={quality.isGoodFirstIssue || quality.isHelpWanted} />
          </div>
          <div className="px-5 pb-4 flex flex-wrap gap-2">
            {quality.isGoodFirstIssue && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                good first issue
              </span>
            )}
            {quality.isHelpWanted && (
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold">
                help wanted
              </span>
            )}
            {quality.isBug && (
              <span className="px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold">
                bug
              </span>
            )}
            {quality.isEnhancement && (
              <span className="px-2.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-semibold">
                enhancement
              </span>
            )}
          </div>
        </div>

        {/* Final Recommendation card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h3 className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Final Recommendation</h3>
          </div>
          <div className="p-5">
            <div className={`rounded-lg px-5 py-4 ${recConf.bg} border ${recConf.border}`}>
              <p className={`text-base font-bold ${recConf.color}`}>{recommendation}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
