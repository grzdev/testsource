'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import RepoInput, { type AnalysisMode, detectMode } from '@/components/RepoInput';
import ReportCard from '@/components/ReportCard';
import PRReportCard from '@/components/PRReportCard';
import IssueReportCard from '@/components/IssueReportCard';
import TestSpriteRunner from '@/components/TestSpriteRunner';
import Skeleton from '@/components/Skeleton';
import type { AnalysisResult, PRAnalysis, IssueAnalysis } from '@/lib/types';

const ENDPOINTS: Record<AnalysisMode, string> = {
  repo: '/api/analyze',
  pr: '/api/analyze-pr',
  issue: '/api/analyze-issue',
};

function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<AnalysisMode>('repo');
  const [activeUrl, setActiveUrl] = useState<string>(searchParams.get('url') ?? '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [prResult, setPrResult] = useState<PRAnalysis | null>(null);
  const [issueResult, setIssueResult] = useState<IssueAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analyzedUrlRef = useRef<string | null>(null);

  const handleAnalyze = useCallback(async (url: string, detectedMode: AnalysisMode) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMode(detectedMode);
    setActiveUrl(url);
    setLoading(true);
    setResult(null);
    setPrResult(null);
    setIssueResult(null);
    setError(null);

    try {
      const res = await fetch(ENDPOINTS[detectedMode], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'An unexpected error occurred.');
      } else if (detectedMode === 'pr') {
        setPrResult(data as PRAnalysis);
      } else if (detectedMode === 'issue') {
        setIssueResult(data as IssueAnalysis);
      } else {
        setResult(data as AnalysisResult);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError('Failed to connect to the server. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      abortRef.current = null;
    }
  }, []);

  // Auto-analyze from URL query param on mount / when param changes
  useEffect(() => {
    const urlParam = searchParams.get('url');
    if (urlParam && urlParam !== analyzedUrlRef.current) {
      analyzedUrlRef.current = urlParam;
      handleAnalyze(urlParam, detectMode(urlParam));
    }
  }, [searchParams, handleAnalyze]);

  return (
    <main className="min-h-screen bg-slate-950 bg-grid text-white overflow-x-hidden">
      {/* ── Sticky top bar: back (far-left) + centered input ── */}
      <div className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800/60">
        <div className="relative flex items-center px-6 py-4">
          {/* Back button — pinned to the far left */}
          <button
            onClick={() => router.push('/')}
            className="absolute left-6 flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          {/* Input — centered */}
          <div className="mx-auto w-full max-w-2xl">
            <RepoInput
              onAnalyze={handleAnalyze}
              loading={loading}
              initialUrl={searchParams.get('url') ?? ''}
            />
          </div>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────── */}
      <div className="max-w-[1320px] mx-auto px-6 py-8 pb-24">
        <div className="space-y-5">
          {loading && <Skeleton />}

          {error && (
            <div className="max-w-2xl mx-auto bg-red-950/40 border border-red-800/60 rounded-xl p-5 card-in">
              <p className="text-red-400 text-sm font-medium">{error}</p>
            </div>
          )}

          {mode === 'repo' && result && <ReportCard result={result} />}
          {mode === 'pr' && prResult && <PRReportCard result={prResult} />}
          {mode === 'issue' && issueResult && <IssueReportCard result={issueResult} />}

          {/* TestSprite Execution Dashboard */}
          {mode === 'repo' && result && (
            result.signals.testspriteCompatibility.compatible
              ? <TestSpriteRunner githubUrl={activeUrl} />
              : (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
                  <div className="flex gap-3 items-start">
                    <Info className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-slate-300 mb-1">
                        Automatic TestSprite execution is unavailable for this repository.
                      </p>
                      <p className="text-sm text-slate-500">
                        This repository appears to be a library, CLI tool, or non-runnable monorepo.
                        GitHub intelligence is still available, but automated UI testing is skipped.
                      </p>
                    </div>
                  </div>
                </div>
              )
          )}
          {mode === 'pr' && prResult && (
            <TestSpriteRunner githubUrl={activeUrl} />
          )}
        </div>
      </div>
    </main>
  );
}

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          <div className="text-slate-500 text-sm">Loading…</div>
        </main>
      }
    >
      <ResultsContent />
    </Suspense>
  );
}
