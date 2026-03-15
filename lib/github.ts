const GITHUB_API = 'https://api.github.com';

function getHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface GithubRepo {
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  open_issues_count: number;
  default_branch: string;
}

export interface GithubContent {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  path: string;
}

export interface GithubRelease {
  tag_name: string;
  published_at: string;
}

export interface GithubPR {
  number: number;
  merged_at: string | null;
  state: string;
}

export interface GithubContributor {
  login: string;
}

export async function fetchRepo(owner: string, repo: string): Promise<GithubRepo> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error('Repository not found or is private.');
    if (res.status === 403) throw new Error('API rate limit exceeded. Try again later.');
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

export async function fetchReadme(owner: string, repo: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  return res.ok;
}

export async function fetchLicense(owner: string, repo: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/license`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.license?.spdx_id ?? data?.license?.name ?? 'Unknown';
}

export async function fetchContents(
  owner: string,
  repo: string,
  path = '',
): Promise<GithubContent[]> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Returns open PR count and recently merged PR count (last 30 days). */
export async function fetchPRStats(
  owner: string,
  repo: string,
): Promise<{ openPRs: number; recentlyMergedPRs: number }> {
  const [openRes, closedRes] = await Promise.all([
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=1`, {
      headers: getHeaders(),
      cache: 'no-store',
    }),
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls?state=closed&per_page=30&sort=updated&direction=desc`, {
      headers: getHeaders(),
      cache: 'no-store',
    }),
  ]);

  let openPRs = 0;
  if (openRes.ok) {
    // Use Link header to get total count, fall back to array length
    const linkHeader = openRes.headers.get('link') ?? '';
    const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
    if (lastMatch) {
      openPRs = parseInt(lastMatch[1], 10);
    } else {
      const arr = await openRes.json();
      openPRs = Array.isArray(arr) ? arr.length : 0;
    }
  }

  let recentlyMergedPRs = 0;
  if (closedRes.ok) {
    const prs: GithubPR[] = await closedRes.json();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    recentlyMergedPRs = Array.isArray(prs)
      ? prs.filter(
          pr => pr.merged_at && new Date(pr.merged_at).getTime() > cutoff,
        ).length
      : 0;
  }

  return { openPRs, recentlyMergedPRs };
}

/** Returns contributor count (capped at 500 by GitHub API). */
export async function fetchContributorCount(owner: string, repo: string): Promise<number> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=1&anon=false`,
    { headers: getHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return 0;
  const linkHeader = res.headers.get('link') ?? '';
  const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
  if (lastMatch) return parseInt(lastMatch[1], 10);
  const arr = await res.json();
  return Array.isArray(arr) ? arr.length : 0;
}

/** Returns the latest release tag + date, or null. */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
): Promise<{ tag: string; publishedAt: string } | null> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/latest`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data: GithubRelease = await res.json();
  return { tag: data.tag_name, publishedAt: data.published_at };
}

/** Returns count of issues with a given label. */
export async function fetchLabeledIssueCount(
  owner: string,
  repo: string,
  label: string,
): Promise<number> {
  const encoded = encodeURIComponent(label);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&labels=${encoded}&per_page=1`,
    { headers: getHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return 0;
  const linkHeader = res.headers.get('link') ?? '';
  const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
  if (lastMatch) return parseInt(lastMatch[1], 10);
  const arr = await res.json();
  return Array.isArray(arr) ? arr.length : 0;
}

export interface GithubPRDetail {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  base: { ref: string; repo: { full_name: string; owner: { avatar_url: string } } };
  head: { ref: string };
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GithubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

/** Fetch full PR details. */
export async function fetchPRDetail(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPRDetail> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error('Pull request not found or repository is private.');
    if (res.status === 403) throw new Error('API rate limit exceeded. Try again later.');
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

/** Fetch all changed files for a PR (up to 300). */
export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPRFile[]> {
  const results: GithubPRFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      { headers: getHeaders(), cache: 'no-store' },
    );
    if (!res.ok) break;
    const data: GithubPRFile[] = await res.json();
    results.push(...data);
    if (data.length < 100) break;
  }
  return results;
}

// ── Issue API ─────────────────────────────────────────────────────────

export interface GithubIssueLabel {
  name: string;
  color: string;
}

export interface GithubIssueDetail {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  labels: GithubIssueLabel[];
  assignees: { login: string }[];
  milestone: { title: string } | null;
  body: string | null;
  /** Populated when the issue is actually a pull_request */
  pull_request?: { merged_at: string | null };
}

export interface GithubIssueComment {
  body: string;
  user: { login: string };
  created_at: string;
}

export interface GithubTimelineEvent {
  event: string;
  /** source is set for "cross-referenced" events */
  source?: {
    type: string;
    issue?: { pull_request?: { merged_at: string | null; url: string } };
  };
  /** For "referenced" and "connected" events */
  commit_id?: string | null;
}

/** Fetch full issue details. Returns 404 error if it's a PR URL. */
export async function fetchIssueDetail(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueDetail> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error('Issue not found or repository is private.');
    if (res.status === 403) throw new Error('API rate limit exceeded. Try again later.');
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

/** Fetch up to 30 most recent comments on an issue. */
export async function fetchIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueComment[]> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=30&sort=created&direction=desc`,
    { headers: getHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Fetch timeline events to detect linked PRs. */
export async function fetchIssueTimeline(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubTimelineEvent[]> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`,
    {
      headers: {
        ...getHeaders(),
        // timeline API requires this preview header
        Accept: 'application/vnd.github.mockingbird-preview+json',
      },
      cache: 'no-store',
    },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Fetch the 5 most recently created open issues (excluding PRs). */
export async function fetchRecentIssues(
  owner: string,
  repo: string,
): Promise<Array<{ number: number; title: string; state: string; labels: GithubIssueLabel[]; created_at: string; html_url: string }>> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&per_page=50&sort=created&direction=desc`,
    { headers: getHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  // GitHub issues endpoint returns PRs too — filter them out
  return (data as GithubIssueDetail[])
    .filter(i => !i.pull_request)
    .slice(0, 10)
    .map(i => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels,
      created_at: i.created_at,
      html_url: `https://github.com/${owner}/${repo}/issues/${i.number}`,
    }));
}
