import type { RepoSignals } from '@/lib/types';
import CheckRow from './CheckRow';
import type { SignalStatus } from './CheckRow';

function testspriteStatus(compatible: boolean, projectType: string | null): SignalStatus {
  if (!projectType) return 'neutral';
  return compatible ? 'pass' : 'warn';
}

function testspriteValue(compatible: boolean, projectType: string | null): string {
  if (!projectType) return 'Unknown — no build file detected';
  if (compatible) return `Likely compatible (${projectType} project)`;
  return `Limited support (${projectType} project)`;
}

interface Props {
  signals: RepoSignals;
}

export default function TestSpriteSection({ signals }: Props) {
  const { testspriteCompatibility, testFramework, testingMode, suggestedTestTargets } = signals;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold">
          TestSprite Readiness
        </h3>
      </div>

      <div className="px-5 py-1">
        <CheckRow
          label="Project type"
          value={testspriteCompatibility.projectType ?? 'Not detected'}
          status={testspriteCompatibility.projectType ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="TestSprite compatibility"
          value={testspriteValue(
            testspriteCompatibility.compatible,
            testspriteCompatibility.projectType,
          )}
          status={testspriteStatus(
            testspriteCompatibility.compatible,
            testspriteCompatibility.projectType,
          )}
        />
        <CheckRow
          label="Detected test framework"
          value={testFramework ?? 'None detected'}
          status={testFramework ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="Suggested testing mode"
          value={testingMode}
          status="neutral"
        />
      </div>

      {suggestedTestTargets.length > 0 && (
        <div className="mx-5 mb-4 mt-2 rounded-lg bg-slate-800/60 border border-slate-700/50 px-4 py-3">
          <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">
            Suggested Test Targets
          </p>
          <ul className="space-y-1.5">
            {suggestedTestTargets.map(target => (
              <li key={target} className="flex items-center gap-2 text-sm text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {target}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
