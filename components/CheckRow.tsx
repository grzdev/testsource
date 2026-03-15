import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, ExternalLink } from 'lucide-react';

export type SignalStatus = 'pass' | 'warn' | 'fail' | 'neutral';

interface Props {
  label: string;
  value: string;
  status: SignalStatus;
  href?: string;
}

const icons: Record<SignalStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
  fail: <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
  neutral: <MinusCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />,
};

const valueColors: Record<SignalStatus, string> = {
  pass: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
  neutral: 'text-slate-500',
};

export default function CheckRow({ label, value, status, href }: Props) {
  const valueEl = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-sm font-semibold ${valueColors[status]} hover:underline underline-offset-2 text-right max-w-[55%] truncate`}
    >
      <span className="truncate">{value}</span>
      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />
    </a>
  ) : (
    <span className={`text-sm font-semibold ${valueColors[status]} text-right max-w-[55%] truncate`}>
      {value}
    </span>
  );

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-800/80 last:border-0">
      {icons[status]}
      <span className="text-slate-300 text-sm font-medium flex-1">{label}</span>
      {valueEl}
    </div>
  );
}
