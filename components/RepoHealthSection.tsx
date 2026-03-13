import type { RepoHealth } from '@/lib/types';
import CheckRow from './CheckRow';
import type { SignalStatus } from './CheckRow';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function activityLabel(openIssues: number, mergedPRs: number): string {
  if (mergedPRs >= 10) return 'Very active';
  if (mergedPRs >= 3) return 'Moderately active';
  if (mergedPRs >= 1) return 'Low recent activity';
  if (openIssues > 0) return 'Issues open, no recent merges';
  return 'Appears dormant';
}

function activityStatus(mergedPRs: number): SignalStatus {
  if (mergedPRs >= 3) return 'pass';
  if (mergedPRs >= 1) return 'warn';
  return 'fail';
}

interface Props {
  health: RepoHealth;
}

export default function RepoHealthSection({ health }: Props) {
  const {
    openIssues,
    openPullRequests,
    recentlyMergedPRs,
    contributorsCount,
    latestRelease,
    defaultBranch,
  } = health;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold">
          Repo Health
        </h3>
      </div>
      <div className="px-5 py-1">
        <CheckRow
          label="Open issues"
          value={openIssues.toLocaleString()}
          status={openIssues < 100 ? 'pass' : openIssues < 500 ? 'warn' : 'fail'}
        />
        <CheckRow
          label="Open pull requests"
          value={openPullRequests.toLocaleString()}
          status={openPullRequests <= 50 ? 'pass' : 'warn'}
        />
        <CheckRow
          label="PRs merged (last 30 days)"
          value={recentlyMergedPRs.toString()}
          status={activityStatus(recentlyMergedPRs)}
        />
        <CheckRow
          label="Activity signal"
          value={activityLabel(openIssues, recentlyMergedPRs)}
          status={activityStatus(recentlyMergedPRs)}
        />
        <CheckRow
          label="Contributors"
          value={contributorsCount > 0 ? contributorsCount.toLocaleString() : 'Unknown'}
          status={contributorsCount >= 5 ? 'pass' : contributorsCount >= 1 ? 'warn' : 'neutral'}
        />
        <CheckRow
          label="Latest release"
          value={
            latestRelease
              ? `${latestRelease.tag} — ${formatDate(latestRelease.publishedAt)}`
              : 'No releases published'
          }
          status={latestRelease ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="Default branch"
          value={defaultBranch}
          status="neutral"
        />
      </div>
    </div>
  );
}
