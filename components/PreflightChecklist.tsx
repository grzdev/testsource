import { CheckCircle2 } from 'lucide-react';

const GENERIC_CHECKLIST = [
  { label: 'Clone the repository locally', detail: 'git clone https://github.com/owner/repo' },
  { label: 'Install project dependencies', detail: 'npm install / pip install / go mod download / etc.' },
  { label: 'Configure environment variables', detail: 'Copy .env.example to .env and fill in required values' },
  { label: 'Start the application or API server', detail: 'Ensure the app runs successfully before testing' },
  { label: 'Install the TestSprite MCP extension', detail: 'Available in VS Code and Cursor via the marketplace' },
  { label: 'Open the repository in your IDE', detail: 'TestSprite MCP operates on your local working directory' },
  { label: 'Paste the suggested prompt into IDE chat', detail: 'Use the prompt from the workflow section above' },
];

interface Props {
  hints?: string[];
}

export default function PreflightChecklist({ hints }: Props) {
  const isSpecific = hints && hints.length > 0;

  // When we have specific hints, append the fixed TestSprite steps
  const items = isSpecific
    ? [
        ...hints.map(h => ({ label: h, detail: '' })),
        { label: 'Install the TestSprite MCP extension', detail: 'Available in VS Code and Cursor via the marketplace' },
        { label: 'Open the repository in your IDE', detail: 'TestSprite MCP operates on your local working directory' },
        { label: 'Paste the suggested prompt into IDE chat', detail: 'Use the prompt from the workflow section above' },
      ]
    : GENERIC_CHECKLIST;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden card-hover">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h3 className="text-xs uppercase tracking-widest font-bold">
          <a
            href="https://docs.testsprite.com/mcp/getting-started/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative inline-block text-slate-400 hover:text-emerald-400 transition-colors duration-300"
          >
            Test-Run a site with TestSprite
            <span className="absolute left-0 bottom-[-2px] right-0 h-px bg-gradient-to-r from-slate-500/0 via-slate-400/50 to-slate-500/0 group-hover:via-emerald-400/70 transition-all duration-300" />
          </a>
        </h3>
        <p className="text-xs text-slate-500 mt-0.5 font-medium">
          {isSpecific
            ? 'Repo-specific setup steps before running TestSprite.'
            : 'Complete these steps before running TestSprite on this repo.'}
        </p>
      </div>

      <ul className="divide-y divide-slate-800">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 px-5 py-3">
            <CheckCircle2 className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-slate-300 text-sm font-medium">{item.label}</p>
              {item.detail && (
                <p className="text-slate-500 text-xs mt-0.5">{item.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
