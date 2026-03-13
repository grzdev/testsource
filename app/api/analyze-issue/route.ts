import { NextRequest, NextResponse } from 'next/server';
import { fetchIssueDetail, fetchIssueComments, fetchIssueTimeline } from '@/lib/github';
import {
  analyzeIssueWorkStatus,
  analyzeIssueQuality,
  computeIssueRecommendation,
} from '@/lib/scoring';
import type { IssueAnalysis } from '@/lib/types';

function parseGithubIssueUrl(
  raw: string,
): { owner: string; repo: string; issueNumber: number } | null {
  try {
    const u = new URL(raw);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    // Expected: owner / repo / issues / number
    if (parts.length < 4 || parts[2] !== 'issues') return null;
    const issueNumber = parseInt(parts[3], 10);
    if (!parts[0] || !parts[1] || isNaN(issueNumber)) return null;
    return { owner: parts[0], repo: parts[1], issueNumber };
  } catch {
    return null;
  }
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
      { error: 'A GitHub issue URL is required.' },
      { status: 400 },
    );
  }

  const parsed = parseGithubIssueUrl(url.trim());
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Invalid GitHub issue URL. Expected format: https://github.com/owner/repo/issues/123',
      },
      { status: 400 },
    );
  }

  const { owner, repo, issueNumber } = parsed;

  try {
    // Fetch issue details + comments + timeline in parallel
    const [issueDetail, comments, timeline] = await Promise.all([
      fetchIssueDetail(owner, repo, issueNumber),
      fetchIssueComments(owner, repo, issueNumber),
      fetchIssueTimeline(owner, repo, issueNumber),
    ]);

    // Guard: if the "issue" is actually a PR, reject it
    if (issueDetail.pull_request !== undefined) {
      return NextResponse.json(
        {
          error:
            'That URL points to a pull request, not an issue. Use PR mode to analyze it.',
        },
        { status: 400 },
      );
    }

    const workStatus = analyzeIssueWorkStatus(issueDetail, comments, timeline);
    const quality = analyzeIssueQuality(issueDetail);
    const recommendation = computeIssueRecommendation(workStatus, quality, issueDetail);

    const result: IssueAnalysis = {
      meta: {
        number: issueDetail.number,
        title: issueDetail.title,
        state: issueDetail.state,
        author: issueDetail.user.login,
        createdAt: issueDetail.created_at,
        updatedAt: issueDetail.updated_at,
        comments: issueDetail.comments,
        labels: issueDetail.labels.map(l => ({ name: l.name, color: l.color })),
        assignees: issueDetail.assignees.map(a => a.login),
        milestone: issueDetail.milestone?.title ?? null,
        body: issueDetail.body ?? null,
      },
      repoMeta: {
        fullName: `${owner}/${repo}`,
        avatarUrl: `https://avatars.githubusercontent.com/${owner}`,
      },
      workStatus,
      quality,
      recommendation,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
