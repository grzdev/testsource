import Image from 'next/image';
import { Star, GitFork, Code2 } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { inferPreflightHints } from '@/lib/scoring';
import CheckRow from './CheckRow';
import type { SignalStatus } from './CheckRow';
import VerdictBadge from './VerdictBadge';
import RepoHealthSection from './RepoHealthSection';
import ContributorSection from './ContributorSection';
import TestSpriteSection from './TestSpriteSection';
import WorkflowSection from './WorkflowSection';
import PreflightChecklist from './PreflightChecklist';
import RecentIssuesSection from './RecentIssuesSection';
import FadeIn from './FadeIn';

function formatDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

export default function ReportCard({ result }: { result: AnalysisResult }) {
  const { meta, signals, health, contributorReadiness, score, maxScore, verdict, recommendation, workflow, recentIssues } = result;

  const preflightHints = inferPreflightHints(signals.buildFile, signals.projectType);

  const activityStatus: SignalStatus = signals.recentActivity ? 'pass' : 'warn';
  const activityValue = `Last pushed ${formatDays(signals.daysSinceLastPush)}`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

      {/* ── Left column ────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {/* Repo Summary */}
        <FadeIn delay={0}>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
            <div className="px-5 py-3 border-b border-slate-800">
              <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold">
                Repo Summary
              </h3>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center gap-4 mb-3">
                <Image
                  src={meta.avatarUrl}
                  alt={meta.owner}
                  width={44}
                  height={44}
                  className="rounded-full border border-slate-700 flex-shrink-0"
                  unoptimized
                />
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-bold text-base font-mono truncate">{meta.fullName}</h2>
                  {meta.description && (
                    <p className="text-slate-400 text-sm mt-0.5 line-clamp-1">{meta.description}</p>
                  )}
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-slate-500">
                    {meta.language && (
                      <span className="flex items-center gap-1">
                        <Code2 className="w-3.5 h-3.5" />
                        {meta.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5" />
                      {meta.stars.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitFork className="w-3.5 h-3.5" />
                      {meta.forks.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-1">
                <CheckRow label="README" value={signals.readme ? 'Found' : 'Missing'} status={signals.readme ? 'pass' : 'fail'} />
                <CheckRow label="License" value={signals.license ?? 'Missing'} status={signals.license ? 'pass' : 'warn'} />
                <CheckRow label="Build file" value={signals.buildFile ?? 'Not detected'} status={signals.buildFile ? 'pass' : 'warn'} />
                <CheckRow label="Tests" value={signals.testsFound ? signals.testDir ?? 'Detected via framework config' : 'Not detected'} status={signals.testsFound ? 'pass' : 'fail'} />
                <CheckRow label="Recent activity" value={activityValue} status={activityStatus} />
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Contributor Readiness */}
        <FadeIn delay={120}>
          <ContributorSection data={contributorReadiness} />
        </FadeIn>

        {/* Final Verdict */}
        <FadeIn delay={240}>
          <div className="bg-slate-900 border-[1.5px] border-slate-700 rounded-xl overflow-hidden card-hover">
            <div className="px-5 py-3 border-b border-slate-700 bg-slate-800/30">
              <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                Final Verdict
              </h3>
            </div>
            <div className="p-5">
              <VerdictBadge
                verdict={verdict}
                score={score}
                maxScore={maxScore}
                recommendation={recommendation}
              />
            </div>
          </div>
        </FadeIn>

        {/* Recommended TestSprite Workflow */}
        {workflow && (
          <FadeIn delay={360}>
            <WorkflowSection workflow={workflow} />
          </FadeIn>
        )}
      </div>

      {/* ── Right column ───────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {/* Repo Health */}
        <FadeIn delay={60}>
          <RepoHealthSection health={health} />
        </FadeIn>

        {/* Recent Open Issues */}
        <FadeIn delay={180}>
          <RecentIssuesSection issues={recentIssues} />
        </FadeIn>

        {/* TestSprite Readiness */}
        <FadeIn delay={300}>
          <TestSpriteSection signals={signals} />
        </FadeIn>

        {/* Pre-flight Checklist */}
        <FadeIn delay={420}>
          <PreflightChecklist hints={preflightHints} />
        </FadeIn>
      </div>

    </div>
  );
}
