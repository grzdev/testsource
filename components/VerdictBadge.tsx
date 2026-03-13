import type { Verdict, ContributorRecommendation } from '@/lib/types';

interface Props {
  verdict: Verdict;
  score: number;
  maxScore: number;
  recommendation: ContributorRecommendation;
}

// Verdict → testing foundation label + colour
const testingLevel: Record<Verdict, { label: string; color: string; dot: string }> = {
  'Strongly test-ready':            { label: 'Strong',   color: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Moderately test-ready':          { label: 'Moderate', color: 'text-amber-300',   dot: 'bg-amber-400'   },
  'Needs setup before contribution':{ label: 'Weak',     color: 'text-red-300',     dot: 'bg-red-400'     },
};

// Recommendation → contributor readiness label + colour
const contributorLevel: Record<ContributorRecommendation, { label: string; color: string; dot: string }> = {
  'Good first contribution candidate':      { label: 'High',   color: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Active but requires onboarding effort':  { label: 'Medium', color: 'text-amber-300',   dot: 'bg-amber-400'   },
  'Low contributor readiness':              { label: 'Low',    color: 'text-red-300',      dot: 'bg-red-400'     },
  'Strong testing foundation':              { label: 'High',   color: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Good candidate for TestSprite onboarding':{ label: 'Medium', color: 'text-sky-300',    dot: 'bg-sky-400'     },
};

const verdictBg: Record<Verdict, { bg: string; border: string; scoreBg: string }> = {
  'Strongly test-ready':            { bg: 'bg-emerald-400/10', border: 'border-emerald-400/40', scoreBg: 'bg-emerald-500/10' },
  'Moderately test-ready':          { bg: 'bg-amber-400/10',   border: 'border-amber-400/40',   scoreBg: 'bg-amber-500/10'  },
  'Needs setup before contribution':{ bg: 'bg-red-400/10',     border: 'border-red-400/40',     scoreBg: 'bg-red-500/10'    },
};

export default function VerdictBadge({ verdict, score, maxScore, recommendation }: Props) {
  const tl = testingLevel[verdict];
  const cl = contributorLevel[recommendation];
  const { bg, border } = verdictBg[verdict];

  return (
    <div className="space-y-3">
      {/* Verdict label */}
      <p className={`text-xs uppercase tracking-widest font-bold ${tl.color} opacity-80`}>{verdict}</p>

      {/* Score + signals banner */}
      <div className={`rounded-lg px-5 py-4 ${bg} border ${border}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2.5">
            {/* Contributor readiness */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm w-44 leading-tight">Contributor readiness</span>
              <span className={`flex items-center gap-1.5 text-sm font-bold ${cl.color}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cl.dot}`} />
                {cl.label}
              </span>
            </div>
            {/* Testing foundation */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm w-44 leading-tight">Testing foundation</span>
              <span className={`flex items-center gap-1.5 text-sm font-bold ${tl.color}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tl.dot}`} />
                {tl.label}
              </span>
            </div>
          </div>
          <div className="text-right pl-4 flex-shrink-0">
            <p className="text-xs text-slate-500 mb-1 font-medium">Score</p>
            <p className={`text-4xl font-mono font-bold leading-none ${tl.color}`}>
              {score}
              <span className="text-base text-slate-500 font-normal">/{maxScore}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
