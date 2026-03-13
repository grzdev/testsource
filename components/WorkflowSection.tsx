'use client';

import type { TestSpriteWorkflow } from '@/lib/types';
import { Clipboard, Check } from 'lucide-react';
import { useState } from 'react';

interface Props {
  workflow: TestSpriteWorkflow;
}

const scopeColors = {
  'Full codebase onboarding': { badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  'Diff-based validation': { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

export default function WorkflowSection({ workflow }: Props) {
  const { scope, focusAreas, reason, suggestedPrompt } = workflow;
  const colors = scopeColors[scope];
  const [copied, setCopied] = useState(false);

  function copyPrompt() {
    navigator.clipboard.writeText(suggestedPrompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold">
          Recommended TestSprite Workflow
        </h3>
      </div>

      <div className="p-5 space-y-4">
        {/* Scope badge */}
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${colors.badge}`}
          >
            {scope}
          </span>
        </div>

        {/* Reason */}
        <p className="text-slate-400 text-sm leading-relaxed">{reason}</p>

        {/* Focus areas */}
        {focusAreas.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2">
              Testing Focus Areas
            </p>
            <div className="flex flex-wrap gap-2">
              {focusAreas.map(area => (
                <span
                  key={area}
                  className="inline-block px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-xs"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Suggested prompt */}
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2">
            Suggested TestSprite Prompt
          </p>
          <div className="relative group bg-slate-800/70 border border-slate-700 rounded-lg px-4 py-3 pr-12">
            <p className="text-emerald-300 text-sm font-mono leading-relaxed">
              &ldquo;{suggestedPrompt}&rdquo;
            </p>
            <button
              onClick={copyPrompt}
              title="Copy prompt"
              className={`absolute top-3 right-3 flex items-center gap-1 transition-all duration-150 cursor-pointer ${
                copied ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Clipboard className="w-4 h-4" />
              )}
            </button>
            {copied && (
              <span className="absolute top-3 right-8 text-xs font-medium text-emerald-400 copy-pop pointer-events-none select-none">
                Copied!
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Paste this into your IDE chat after installing the TestSprite MCP extension.
          </p>
        </div>
      </div>
    </div>
  );
}

