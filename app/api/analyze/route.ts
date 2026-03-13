import { NextRequest, NextResponse } from 'next/server';
import {
  fetchRepo,
  fetchReadme,
  fetchLicense,
  fetchContents,
  fetchPRStats,
  fetchContributorCount,
  fetchLatestRelease,
  fetchLabeledIssueCount,
  fetchRecentIssues,
} from '@/lib/github';
import {
  analyzeContents,
  analyzeContributorFiles,
  computeScore,
  computeRecommendation,
  buildRepoWorkflow,
} from '@/lib/scoring';
import type {
  AnalysisResult,
  RepoSignals,
  RepoHealth,
  ContributorReadiness,
} from '@/lib/types';

function parseGithubUrl(raw: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(raw);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const repoName = parts[1].replace(/\.git$/, '');
    return { owner: parts[0], repo: repoName };
  } catch {
    return null;
  }
}

function daysSince(dateString: string): number {
  const pushed = new Date(dateString).getTime();
  return Math.floor((Date.now() - pushed) / (1000 * 60 * 60 * 24));
}

export async function POST(req: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json(
      { error: 'A GitHub repository URL is required.' },
      { status: 400 },
    );
  }

  const parsed = parseGithubUrl(url.trim());
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid GitHub URL. Expected format: https://github.com/owner/repo' },
      { status: 400 },
    );
  }

  const { owner, repo } = parsed;

  try {
    // First wave: all independent fetches
    const [repoData, hasReadme, license, rootContents, prStats, contributorsCount, latestRelease] =
      await Promise.all([
        fetchRepo(owner, repo),
        fetchReadme(owner, repo),
        fetchLicense(owner, repo),
        fetchContents(owner, repo),
        fetchPRStats(owner, repo),
        fetchContributorCount(owner, repo),
        fetchLatestRelease(owner, repo),
      ]);

    const days = daysSince(repoData.pushed_at);

    // Second wave: depends on rootContents
    const hasSrc = rootContents.some(c => c.type === 'dir' && c.name === 'src');
    const hasGithubDir = rootContents.some(c => c.type === 'dir' && c.name === '.github');

    const [srcContents, githubDirContents, goodFirstIssues, helpWantedIssues, recentIssuesRaw] =
      await Promise.all([
        hasSrc ? fetchContents(owner, repo, 'src') : Promise.resolve([]),
        hasGithubDir ? fetchContents(owner, repo, '.github') : Promise.resolve([]),
        fetchLabeledIssueCount(owner, repo, 'good first issue'),
        fetchLabeledIssueCount(owner, repo, 'help wanted'),
        fetchRecentIssues(owner, repo),
      ]);

    // Content signals
    const contentSignals = analyzeContents(rootContents, srcContents, days);

    const signals: RepoSignals = {
      readme: hasReadme,
      license,
      ...contentSignals,
    };

    // Contributor readiness
    const contributorFiles = analyzeContributorFiles(rootContents, githubDirContents);
    const contributorReadiness: ContributorReadiness = {
      ...contributorFiles,
      goodFirstIssues,
      helpWantedIssues,
    };

    // Repo health
    const health: RepoHealth = {
      openIssues: repoData.open_issues_count,
      openPullRequests: prStats.openPRs,
      recentlyMergedPRs: prStats.recentlyMergedPRs,
      contributorsCount,
      latestRelease,
      defaultBranch: repoData.default_branch,
    };

    const { score, maxScore, verdict } = computeScore(signals);
    const recommendation = computeRecommendation(signals, health, contributorReadiness);
    const workflow = buildRepoWorkflow(signals, repoData.full_name);

    const recentIssues = recentIssuesRaw.map(i => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels.map(l => ({ name: l.name, color: l.color })),
      createdAt: i.created_at,
      url: i.html_url,
    }));

    const result: AnalysisResult = {
      meta: {
        name: repoData.name,
        owner: repoData.owner.login,
        fullName: repoData.full_name,
        description: repoData.description,
        language: repoData.language,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        avatarUrl: repoData.owner.avatar_url,
        pushedAt: repoData.pushed_at,
      },
      signals,
      health,
      contributorReadiness,
      score,
      maxScore,
      verdict,
      recommendation,
      workflow,
      recentIssues,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
