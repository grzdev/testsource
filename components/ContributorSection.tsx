import type { ContributorReadiness } from '@/lib/types';
import CheckRow from './CheckRow';

interface Props {
  data: ContributorReadiness;
}

export default function ContributorSection({ data }: Props) {
  const {
    hasContributing,
    hasCodeOfConduct,
    hasIssueTemplates,
    hasPRTemplate,
    goodFirstIssues,
    helpWantedIssues,
  } = data;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold">
          Contributor Readiness
        </h3>
      </div>
      <div className="px-5 py-1">
        <CheckRow
          label="CONTRIBUTING.md"
          value={hasContributing ? 'Found' : 'Missing'}
          status={hasContributing ? 'pass' : 'warn'}
        />
        <CheckRow
          label="CODE_OF_CONDUCT.md"
          value={hasCodeOfConduct ? 'Found' : 'Missing'}
          status={hasCodeOfConduct ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="Issue templates"
          value={hasIssueTemplates ? 'Found' : 'None detected'}
          status={hasIssueTemplates ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="Pull request template"
          value={hasPRTemplate ? 'Found' : 'None detected'}
          status={hasPRTemplate ? 'pass' : 'neutral'}
        />
        <CheckRow
          label="Good first issues"
          value={goodFirstIssues > 0 ? `${goodFirstIssues} open` : 'None'}
          status={goodFirstIssues >= 3 ? 'pass' : goodFirstIssues >= 1 ? 'warn' : 'neutral'}
        />
        <CheckRow
          label="Help wanted issues"
          value={helpWantedIssues > 0 ? `${helpWantedIssues} open` : 'None'}
          status={helpWantedIssues >= 3 ? 'pass' : helpWantedIssues >= 1 ? 'warn' : 'neutral'}
        />
      </div>
    </div>
  );
}
