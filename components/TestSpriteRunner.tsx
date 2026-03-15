'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Circle, Terminal } from 'lucide-react';
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

  useEffect(() => {
    const el = logPanelRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [jobState?.logs]);

  // Start job on mount
  useEffect(() => {
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
  }, [githubUrl]);

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
            {isRunning ? 'Running TestSprite…' : isCompleted ? 'Tests Completed' : 'Test Run Failed'}
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
      {isCompleted && total > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Test Results</h3>
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
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-800">
            <div className={`rounded-lg p-4 border text-center ${
              passRate === 100 ? 'bg-emerald-950/20 border-emerald-900/30' :
              passRate >= 80   ? 'bg-yellow-950/20 border-yellow-900/30' :
                                 'bg-red-950/20 border-red-900/30'
            }`}>
              <div className={`text-2xl font-bold mb-1 ${
                passRate === 100 ? 'text-emerald-400' : passRate >= 80 ? 'text-yellow-400' : 'text-red-400'
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
          {Array.isArray(results?.tests) && results.tests.length > 0 && (
            <div className="border-b border-slate-800 overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr className="bg-slate-950/60">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-16">ID</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-24">Type</th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-16">Status</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-24">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {results.tests.map((t: any, i: number) => {
                    const id       = t.id ?? t.testId ?? `#${i + 1}`;
                    const name     = t.testCaseTitle ?? t.testName ?? t.name ?? `Generated Frontend Test ${i + 1}`;
                    const type     = t.type ?? t.testType ?? '—';
                    const rawStatus = (t.testStatus ?? t.status ?? '').toUpperCase();
                    const isPassed = /^(PASS|PASSED|SUCCESS)$/.test(rawStatus);
                    const dur      = t.duration ?? t.durationMs ?? null;
                    const error    = t.error ?? t.errorMessage ?? null;
                    return (
                      <tr key={i} className="hover:bg-slate-800/30 transition-colors align-top">
                        <td className="px-3 py-2.5 text-slate-600 font-mono text-[10px]">{id}</td>
                        <td className="px-3 py-2.5 text-slate-300">
                          <div>{name}</div>
                          {error && (
                            <div className="mt-0.5 text-[10px] text-red-400/70 font-mono leading-snug break-words max-w-sm">
                              {error}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{type}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            isPassed
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>{isPassed ? 'PASS' : 'FAIL'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-500 font-mono">
                          {dur != null ? `${dur}ms` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {jobState.results?.report && (
            <div className="p-5">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Report</h4>
              <pre className="text-xs bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto whitespace-pre-wrap font-sans text-slate-300 leading-relaxed">
                {jobState.results.report}
              </pre>
            </div>
          )}
        </div>
      )}

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
