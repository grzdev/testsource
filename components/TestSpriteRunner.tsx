'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Circle, Terminal, GitPullRequest as GitPullRequestIcon, CircleDot, GitBranch as GitBranchIcon } from 'lucide-react';
import type { JobState } from '@/lib/jobs';

// Canonical pipeline stage order — must match setStage() calls in lib/jobs.ts + lib/testsprite-mcp.ts
const STAGE_LIST = [
  'Analyze URL',
  'Clone repository',
  'Install dependencies',
  'Start dev server',
  'Verify HTML target',
  'Initialize MCP',
  'Generate code summary',
  'Generate PRD',
  'Generate test plan',
  'Generate and execute tests',
  'Finalize results',
] as const;

type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

interface TestResult {
  // Raw TestSprite test_results.json fields
  testId?: string | number;
  title?: string;            // Real name: e.g. "TC007-PR mode: Analyze a valid PR URL..."
  description?: string;      // "Verifies that..."
  testStatus?: string;       // "PASSED" | "FAILED"
  testError?: string;        // Multi-line failure text with ASSERTIONS bullets
  testType?: string;         // "FRONTEND"
  testVisualization?: string;// URL to Playwright recording video
  priority?: string;         // "High" | "Medium" | "Low"
  // Legacy / alternate field names kept for backwards-compat
  id?: string | number;
  name?: string;
  testName?: string;
  testCaseTitle?: string;
  type?: string;
  status?: string;
  duration?: number;
  durationMs?: number;
  error?: string;
  errorMessage?: string;
  // Injected by backend normalizer (runner.ts)
  isPassed?: boolean;
}

function getStageStatuses(job: JobState): { name: string; status: StageStatus }[] {
  const currentIdx = (STAGE_LIST as readonly string[]).findIndex(s => s === job.stage);
  return (STAGE_LIST as readonly string[]).map((name, idx) => {
    if (job.status === 'completed') return { name, status: 'completed' };
    if (job.status === 'failed') {
      if (currentIdx < 0) return { name, status: 'pending' };
      if (idx < currentIdx) return { name, status: 'completed' };
      if (idx === currentIdx) return { name, status: 'failed' };
      return { name, status: 'pending' };
    }
    // running / pending
    if (currentIdx < 0) return { name, status: 'pending' };
    if (idx < currentIdx) return { name, status: 'completed' };
    if (idx === currentIdx) return { name, status: 'running' };
    return { name, status: 'pending' };
  });
}

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
    case 'running':   return <Loader2      className="w-3.5 h-3.5 text-sky-400 animate-spin flex-shrink-0" />;
    case 'failed':    return <XCircle      className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    default:          return <Circle       className="w-3.5 h-3.5 text-slate-700 flex-shrink-0" />;
  }
}

interface Props {
  githubUrl: string;
}

export default function TestSpriteRunner({ githubUrl }: Props) {
  const [jobId, setJobId]       = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  // Ref on the scrollable log panel div (not a child element) so scrollTop only
  // scrolls within the panel and never jumps the browser viewport.
  const logPanelRef = useRef<HTMLDivElement>(null);

  // Derive URL type from prop — no state needed for this check
  const invalidUrlType: 'issue' | 'pr' | null = (() => {
    try {
      const seg = new URL(githubUrl.startsWith('http') ? githubUrl : `https://${githubUrl}`)
        .pathname.split('/').filter(Boolean)[2];
      if (seg === 'issues') return 'issue';
      if (seg === 'pull') return 'pr';
    } catch {}
    return null;
  })();

  useEffect(() => {
    const el = logPanelRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [jobState?.logs]);

  // Reset state when URL changes to prevent stale errors showing for new submissions
  useEffect(() => {
    setJobId(null);
    setJobState(null);
  }, [githubUrl]);

  // Start job on mount — skip entirely for invalid URL types
  useEffect(() => {
    if (invalidUrlType) return;

    let active = true;
    (async () => {
      try {
        const res  = await fetch('/api/testsprite/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ githubUrl }),
        });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setJobState({ id: 'failed', status: 'failed', stage: '', error: data.error || 'TestSprite execution unavailable.', logs: [] });
          return;
        }
        setJobId(data.jobId);
        setJobState({ id: data.jobId, status: 'pending', stage: '', logs: [] });
      } catch {
        if (!active) return;
        setJobState({ id: 'failed', status: 'failed', stage: '', error: 'Failed to communicate with the TestSprite runner.', logs: [] });
      }
    })();
    return () => { active = false; };
  }, [githubUrl, invalidUrlType]);

  // Polling loop
  useEffect(() => {
    if (!jobId || jobState?.status === 'completed' || jobState?.status === 'failed') return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/testsprite/status?id=${jobId}`);
        if (!res.ok) {
          if (res.status === 404)
            setJobState(prev => prev ? { ...prev, status: 'failed', error: 'Job state lost on server.' } : null);
          return;
        }
        setJobState(await res.json());
      } catch { /* silent — will retry */ }
    };
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [jobId, jobState?.status]);

  if (!jobState) {
    return (
      <div className="mt-8 border-t border-slate-800/80 pt-8 flex items-center gap-3">
        <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
        <span className="text-sm text-slate-400">Initializing TestSprite...</span>
      </div>
    );
  }

  const isRunning   = jobState.status === 'running' || jobState.status === 'pending';
  const isCompleted = jobState.status === 'completed';
  const isFailed    = jobState.status === 'failed';

  // URL-type validation error — show a single inline notice, no pipeline UI
  if (invalidUrlType) {
    const isIssue = invalidUrlType === 'issue';
    const kind    = isIssue ? 'issue' : 'pull request';
    const color   = isIssue
      ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
      : 'text-violet-400 border-violet-500/30 bg-violet-500/10';
    const Icon    = isIssue ? CircleDot : GitPullRequestIcon;
    return (
      <div className="mt-8 border-t border-slate-800/80 pt-8">
        <div className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${color}`}>
          <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed space-y-1.5">
            <p>
              That looks like a {kind} URL — tests can only run against a repository, not a {kind}.
            </p>
            <p>
              Please submit the <span className="font-semibold">repo URL</span> directly (e.g.{' '}
              <span className="font-mono">https://github.com/owner/repo</span>) — the repo must contain
              a <span className="font-semibold">package.json</span> and use Next.js, Vite, or Create React App.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No package.json error — show a violet/PR-themed notice, no pipeline UI
  const isNoPackageJson = isFailed && !!jobState.error?.includes('No package.json found');
  if (isNoPackageJson) {
    return (
      <div className="mt-8 border-t border-slate-800/80 pt-8">
        <div className="flex items-start gap-3 rounded-xl border px-5 py-4 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
          <GitBranchIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed space-y-1.5">
            <p className="font-semibold">No <span className="font-mono">package.json</span> found — this doesn&apos;t appear to be a Node.js project.</p>
            <p>TestSprite requires a Node.js project with a <span className="font-mono">package.json</span> and a supported framework (Next.js, Vite, or Create React App) to run automated tests.</p>
            <p>Try a different repository that uses one of those frameworks instead.</p>
          </div>
        </div>
      </div>
    );
  }

  // Unsupported framework error — show a repo-themed notice, no pipeline UI
  const isUnsupportedFramework = isFailed && !!jobState.error?.includes('Could not identify a supported framework');
  if (isUnsupportedFramework) {
    return (
      <div className="mt-8 border-t border-slate-800/80 pt-8">
        <div className="flex items-start gap-3 rounded-xl border px-5 py-4 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
          <GitBranchIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed space-y-1.5">
            <p>This repo doesn&apos;t appear to use a supported framework. For tests to run, the repo needs one of:</p>
            <ul className="list-none space-y-1 mt-1">
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />Next.js</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />Vite (including SvelteKit)</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />Create React App</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const results  = jobState.results?.data;
  const passed   = results?.passed ?? 0;
  const failed   = results?.failed ?? 0;
  const total    = passed + failed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const stages = getStageStatuses(jobState);

  return (
    <div className="mt-8 border-t border-slate-800/80 pt-8 space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm font-semibold text-white">
            {isRunning ? 'Running TestSprite test…' : isCompleted ? 'Tests Completed' : 'Test Run Failed'}
          </span>
          {isRunning && jobState.stage && (STAGE_LIST as readonly string[]).includes(jobState.stage) && (
            <span className="text-xs text-slate-500 font-mono ml-1">{jobState.stage}</span>
          )}
        </div>
        {jobState.proxyUrl && (
          <a
            href={jobState.proxyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors"
          >
            Open TestSprite Dashboard ↗
          </a>
        )}
      </div>

      {/* ── Two panels ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">

        {/* Panel 1 — Stage checklist */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Pipeline Stages
          </p>
          <ol className="space-y-2.5">
            {stages.map(({ name, status }) => (
              <li key={name} className="flex items-center gap-2">
                <StageIcon status={status} />
                <span className={`text-xs leading-snug ${
                  status === 'running'   ? 'text-sky-300 font-semibold' :
                  status === 'completed' ? 'text-slate-300' :
                  status === 'failed'    ? 'text-red-400 font-semibold' :
                  'text-slate-600'
                }`}>
                  {name}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Panel 2 — Terminal log */}
        <div className="bg-[#0D1117] border border-slate-800 rounded-xl overflow-hidden">
          <div className="bg-slate-900/80 px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[10px] font-mono text-slate-500 font-semibold uppercase tracking-wider">
              Progress Log
            </span>
          </div>
          <div ref={logPanelRef} className="p-4 h-[340px] overflow-y-auto font-mono text-xs leading-relaxed">
            {jobState.logs.length === 0 ? (
              <span className="text-slate-600">Waiting for output…</span>
            ) : (
              jobState.logs.map((line, i) => (
                <div key={i} className={`mb-0.5 ${
                  /error|fail|exception/i.test(line) ? 'text-red-400' :
                  /warn/i.test(line)                 ? 'text-yellow-400' :
                  line.startsWith('>') || line.startsWith('  ') ? 'text-slate-300' :
                  line.startsWith('---') || line.startsWith('[stderr]') ? 'text-slate-500' :
                  'text-slate-500'
                }`}>
                  {line}
                </div>
              ))
            )}
            {isRunning && (
              <div className="mt-2 flex items-center gap-1.5 text-slate-600 animate-pulse">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-600" />
                processing…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Results summary (only when completed with real tests) ─────────── */}
      {isCompleted && total > 0 && (() => {
        const tests: TestResult[] = Array.isArray(results?.tests) ? (results.tests as TestResult[]) : [];
        const failedTests = tests.filter(t => !(t.isPassed ?? /^(PASS|PASSED|SUCCESS)$/i.test(t.testStatus ?? t.status ?? '')));

        // Backend verdict (preferred) — runner.ts computes this after normalizing results
        const resultsExt        = results as Record<string, unknown>;
        const backendVerdict    = resultsExt?.contributorVerdict as string | undefined;
        const backendReason     = resultsExt?.contributorReason  as string | undefined;
        const limitedCoverage   = resultsExt?.limitedCoverage    as boolean | undefined;

        const VERDICT_MAP: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
          strong_candidate:    { label: 'Strong Candidate',    color: 'text-orange-400', bg: 'bg-orange-950/20',  border: 'border-orange-900/30', dot: 'bg-orange-400'  },
          possible_candidate:  { label: 'Possible Candidate',  color: 'text-yellow-400', bg: 'bg-yellow-950/20',  border: 'border-yellow-900/30', dot: 'bg-yellow-400'  },
          weak_candidate:      { label: 'Weak Candidate',      color: 'text-emerald-400',bg: 'bg-emerald-950/20', border: 'border-emerald-900/30',dot: 'bg-emerald-400' },
          not_enough_evidence: { label: 'Not Enough Evidence', color: 'text-slate-400',  bg: 'bg-slate-800/40',   border: 'border-slate-700',     dot: 'bg-slate-500'   },
        };
        const resolvedVerdict = (backendVerdict && VERDICT_MAP[backendVerdict])
          ? backendVerdict
          : (limitedCoverage || total < 5) ? 'not_enough_evidence'
          : passRate === 100 ? 'weak_candidate'
          : passRate >= 70   ? 'possible_candidate'
          : 'strong_candidate';
        const worthiness = VERDICT_MAP[resolvedVerdict] ?? VERDICT_MAP.not_enough_evidence;

        // Suggested search terms derived from failed test names
        const searchTerms: string[] = failedTests
          .slice(0, 5)
          .map((t): string | null => {
            const n = (t.testName ?? t.title ?? t.name ?? '').toLowerCase();
            if (/nav|menu|route|link/.test(n))     return 'is:issue is:open navigation';
            if (/form|input|submit|valid/.test(n)) return 'is:issue is:open form';
            if (/button|cta|click/.test(n))        return 'is:issue is:open button';
            if (/load|empty|error|state/.test(n))  return 'is:issue is:open state';
            if (/modal|dialog|dropdown/.test(n))   return 'is:issue is:open modal';
            if (/mobile|responsive/.test(n))       return 'is:issue is:open responsive';
            if (/access|aria|keyboard/.test(n))    return 'is:issue is:open accessibility';
            return null;
          })
          .filter((s): s is string => s !== null)
          .filter((s, i, a) => a.indexOf(s) === i);

        return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Test Results</h3>
              <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${worthiness.bg} ${worthiness.border} ${worthiness.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${worthiness.dot}`} />
                {worthiness.label}
              </span>
            </div>
            {(jobState.proxyUrl ?? jobState.results?.dashboardUrl) && (
              <a
                href={jobState.proxyUrl ?? jobState.results.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors"
              >
                Open TestSprite Dashboard ↗
              </a>
            )}
          </div>

          {/* Contributor assessment line */}
          {(backendReason || limitedCoverage) && (
            <div className={`px-5 py-3 border-b border-slate-800 text-xs ${worthiness.bg} ${worthiness.color}`}>
              <span className="font-bold">Contribution assessment · </span>
              {backendReason ?? 'Not enough tests were generated to assess contribution potential.'}
            </div>
          )}

          {/* Stats bar */}
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-800">
            <div className={`rounded-lg p-4 border text-center ${
              passRate === 100 ? 'bg-emerald-950/20 border-emerald-900/30' :
              passRate >= 70   ? 'bg-yellow-950/20 border-yellow-900/30' :
                                 'bg-red-950/20 border-red-900/30'
            }`}>
              <div className={`text-2xl font-bold mb-1 ${
                passRate === 100 ? 'text-emerald-400' : passRate >= 70 ? 'text-yellow-400' : 'text-red-400'
              }`}>{passRate}%</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Pass Rate</div>
            </div>
            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800/80 text-center">
              <div className="text-2xl font-bold text-white mb-1">{total}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Total</div>
            </div>
            <div className="bg-emerald-950/20 rounded-lg p-4 border border-emerald-900/30 text-center">
              <div className="text-2xl font-bold text-emerald-400 mb-1">{passed}</div>
              <div className="text-[10px] text-emerald-500/70 uppercase tracking-wider font-semibold">Passed</div>
            </div>
            <div className="bg-red-950/20 rounded-lg p-4 border border-red-900/30 text-center">
              <div className="text-2xl font-bold text-red-400 mb-1">{failed}</div>
              <div className="text-[10px] text-red-500/70 uppercase tracking-wider font-semibold">Failed</div>
            </div>
          </div>

          {/* Test cards */}
          {tests.length > 0 && (
            <div className="divide-y divide-slate-800/50">
              {tests.map((t, i) => {
                // Prefer normalizer-injected canonical fields, then real field names, then legacy fallbacks
                const name     = t.testName ?? t.title ?? t.testCaseTitle ?? t.name ?? `Frontend Test ${i + 1}`;
                const desc     = t.description ?? null;
                const isPassed = t.isPassed ?? /^(PASS|PASSED|SUCCESS)$/i.test(t.testStatus ?? t.status ?? '');
                const dur      = t.duration ?? t.durationMs ?? null;
                // errorMessage set by backend normalizer from testError; testError is the real field
                const rawErr   = t.errorMessage ?? t.testError ?? t.error ?? null;
                const videoUrl = t.testVisualization ?? null;
                const tType    = t.testType ?? t.type ?? null;

                // Parse "TEST FAILURE\n\nASSERTIONS:\n- ..." into bullet list
                const assertionBullets: string[] = rawErr ? (() => {
                  const m = rawErr.match(/ASSERTIONS:\s*\n([\s\S]+)/);
                  if (m) {
                    return m[1].split('\n')
                      .filter((l: string) => l.trim().startsWith('-'))
                      .map((l: string) => l.replace(/^[\s-]+/, '').trim())
                      .filter(Boolean);
                  }
                  return [rawErr.replace(/^TEST FAILURE\s*/i, '').trim()].filter(Boolean);
                })() : [];

                return (
                  <div key={i} className={`px-5 py-4 ${isPassed ? '' : 'bg-red-950/5'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {isPassed
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          : <XCircle      className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <span className={`text-sm font-semibold leading-snug block ${isPassed ? 'text-slate-200' : 'text-red-200'}`}>
                            {name}
                          </span>
                          {desc && (
                            <span className="text-[11px] text-slate-500 leading-snug mt-0.5 block">{desc}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {tType && (
                          <span className="text-[10px] text-slate-600 hidden sm:inline">{tType}</span>
                        )}
                        {dur != null && (
                          <span className="text-[10px] text-slate-600 font-mono">{dur}ms</span>
                        )}
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isPassed
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>{isPassed ? 'PASS' : 'FAIL'}</span>
                      </div>
                    </div>

                    {/* Failure assertion bullets */}
                    {!isPassed && assertionBullets.length > 0 && (
                      <ul className="mt-3 ml-6 space-y-1.5">
                        {assertionBullets.map((bullet, bi) => (
                          <li key={bi} className="flex items-start gap-1.5 text-xs text-red-400/75">
                            <span className="text-red-600 mt-0.5 flex-shrink-0">•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Video replay */}
                    {videoUrl && (
                      <div className="mt-2.5 ml-6">
                        <a
                          href={videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          ▶ Watch test replay
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Suggested GitHub issue search terms */}
          {searchTerms.length > 0 && (
            <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/40">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Suggested GitHub Issue Searches</p>
              <div className="flex flex-wrap gap-2">
                {searchTerms.map(term => (
                  <span key={term} className="inline-block font-mono text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 select-all">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Full report */}
          {jobState.results?.report && (
            <div className="p-5 border-t border-slate-800">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Full Report</h4>
              <pre className="text-xs bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto whitespace-pre-wrap font-sans text-slate-300 leading-relaxed">
                {jobState.results.report}
              </pre>
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Failure details ───────────────────────────────────────────────── */}
      {isFailed && (
        <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-5">
          <div className="flex gap-3 items-start">
            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-red-400 mb-2">Execution Failed</h3>
              <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-words font-mono bg-red-950/30 rounded-lg p-3 border border-red-900/30 leading-relaxed">
                {jobState.error || 'An unknown error occurred.'}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
