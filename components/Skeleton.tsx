function SkeletonCard({ rows = 5, header = true, className = '' }: { rows?: number; header?: boolean; className?: string }) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${className}`}>
      {header && (
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-3">
          <div className="skeleton-shimmer h-2.5 rounded w-28" />
        </div>
      )}
      <div className="px-5 py-2 space-y-0.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5 border-b border-slate-800/70 last:border-0">
            <div className="skeleton-shimmer w-4 h-4 rounded-full flex-shrink-0" />
            <div className="skeleton-shimmer flex-1 h-2.5 rounded" style={{ width: `${55 + (i % 3) * 15}%` }} />
            <div className="skeleton-shimmer h-2.5 rounded w-16 flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonVerdict() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-3">
        <div className="skeleton-shimmer h-2.5 rounded w-24" />
      </div>
      <div className="p-5 space-y-3">
        <div className="skeleton-shimmer rounded-lg h-20 w-full" />
        <div className="skeleton-shimmer rounded-lg h-14 w-full" />
      </div>
    </div>
  );
}

function SkeletonRepoSummary() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <div className="skeleton-shimmer h-2.5 rounded w-24" />
      </div>
      <div className="p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="skeleton-shimmer rounded-full flex-shrink-0" style={{ width: 52, height: 52 }} />
          <div className="flex-1 space-y-2.5">
            <div className="skeleton-shimmer h-4 rounded w-2/5" />
            <div className="skeleton-shimmer h-3 rounded w-3/5" />
            <div className="skeleton-shimmer h-3 rounded w-1/4" />
          </div>
        </div>
        <div className="border-t border-slate-800 pt-1 space-y-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-slate-800/70 last:border-0">
              <div className="skeleton-shimmer w-4 h-4 rounded-full flex-shrink-0" />
              <div className="skeleton-shimmer flex-1 h-2.5 rounded" />
              <div className="skeleton-shimmer h-2.5 rounded w-16 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Skeleton() {
  return (
    <div className="space-y-4 card-in">
      {/* Repo Summary — full width */}
      <SkeletonRepoSummary />

      {/* Masonry grid */}
      <div className="columns-1 md:columns-2 gap-4">
        <div className="break-inside-avoid mb-4">
          <SkeletonCard rows={7} />
        </div>
        <div className="break-inside-avoid mb-4">
          <SkeletonCard rows={6} />
        </div>
        <div className="break-inside-avoid mb-4">
          <SkeletonCard rows={4} />
        </div>
        <div className="break-inside-avoid mb-4">
          <SkeletonVerdict />
        </div>
        <div className="break-inside-avoid mb-4">
          <SkeletonCard rows={5} />
        </div>
        <div className="break-inside-avoid mb-4">
          <SkeletonCard rows={7} />
        </div>
      </div>

      {/* Recent issues — full width */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <div className="skeleton-shimmer h-2.5 rounded w-32" />
        </div>
        <div className="divide-y divide-slate-800/60">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-5 py-3 flex items-center gap-3">
              <div className="skeleton-shimmer w-4 h-4 rounded-full flex-shrink-0" />
              <div className="skeleton-shimmer flex-1 h-3 rounded" />
              <div className="skeleton-shimmer h-3 rounded w-20 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

