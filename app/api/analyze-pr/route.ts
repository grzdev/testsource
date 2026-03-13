import { NextRequest, NextResponse } from 'next/server';
import { fetchPRDetail, fetchPRFiles } from '@/lib/github';
import { classifyPR, buildPRWorkflow, generatePRDescription, inferPreflightHints } from '@/lib/scoring';
import type { PRAnalysis } from '@/lib/types';

function parseGithubPRUrl(
  raw: string,
): { owner: string; repo: string; prNumber: number } | null {
  try {
    const u = new URL(raw);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    // Expected: owner / repo / pull / number
    if (parts.length < 4 || parts[2] !== 'pull') return null;
    const prNumber = parseInt(parts[3], 10);
    if (!parts[0] || !parts[1] || isNaN(prNumber)) return null;
    return { owner: parts[0], repo: parts[1], prNumber };
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
      { error: 'A GitHub pull request URL is required.' },
      { status: 400 },
    );
  }

  const parsed = parseGithubPRUrl(url.trim());
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123',
      },
      { status: 400 },
    );
  }

  const { owner, repo, prNumber } = parsed;

  try {
    const [prDetail, prFiles] = await Promise.all([
      fetchPRDetail(owner, repo, prNumber),
      fetchPRFiles(owner, repo, prNumber),
    ]);

    const filenames = prFiles.map(f => f.filename);
    const { focusType, changedAreas } = classifyPR(prFiles);
    const workflow = buildPRWorkflow(focusType, changedAreas, prDetail.title);
    const description = generatePRDescription(prDetail.title, focusType, filenames);
    const preflightHints = inferPreflightHints(null, null, filenames);

    const result: PRAnalysis = {
      meta: {
        number: prDetail.number,
        title: prDetail.title,
        author: prDetail.user.login,
        baseBranch: prDetail.base.ref,
        headBranch: prDetail.head.ref,
        state: prDetail.state,
        createdAt: prDetail.created_at,
        updatedAt: prDetail.updated_at,
        additions: prDetail.additions,
        deletions: prDetail.deletions,
        changedFiles: prDetail.changed_files,
      },
      repoMeta: {
        fullName: prDetail.base.repo.full_name,
        avatarUrl: prDetail.base.repo.owner.avatar_url,
      },
      focusType,
      changedAreas,
      files: prFiles.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      workflow,
      description,
      preflightHints,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
