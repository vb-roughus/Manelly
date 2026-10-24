import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface StatTileProps {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  /** Tailwind classes coloring the icon chip. */
  tone: string;
  className?: string;
}

export function StatTile({ label, value, caption, icon: Icon, tone, className }: StatTileProps) {
  return (
    <div className={clsx('rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5', className)}>
      <div className="flex items-center justify-between gap-2">
        <dt className="truncate text-sm text-ink-2">{label}</dt>
        <span className={clsx('grid size-7 place-items-center rounded-lg', tone)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <dd className="mt-2 text-2xl font-semibold tracking-tight whitespace-nowrap sm:text-3xl">{value}</dd>
      <dd className="mt-1 line-clamp-2 text-xs text-ink-3">
        {caption}
      </dd>
    </div>
  );
}
