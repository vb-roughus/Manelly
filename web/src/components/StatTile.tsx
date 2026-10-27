import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface StatTileProps {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  /** Tailwind classes coloring the icon chip. */
  tone: string;
  className?: string;
  /** Makes the whole tile a button that opens a panel with details. */
  toggle?: { expanded: boolean; controls: string; label: string; onToggle: () => void };
}

export function StatTile({ label, value, caption, icon: Icon, tone, className, toggle }: StatTileProps) {
  return (
    <div
      className={clsx(
        'relative rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5',
        toggle && 'transition hover:bg-card-2',
        toggle?.expanded && 'ring-2 ring-accent/40',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <dt className="truncate text-sm text-ink-2">{label}</dt>
        <span className={clsx('grid size-7 place-items-center rounded-lg', tone)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <dd className="mt-2 text-2xl font-semibold tracking-tight whitespace-nowrap sm:text-3xl">{value}</dd>
      <dd className="mt-1 flex items-start justify-between gap-2 text-xs text-ink-3">
        <span className="line-clamp-2">{caption}</span>
        {toggle && <ChevronDown className={clsx('size-4 shrink-0 transition', toggle.expanded && 'rotate-180')} aria-hidden />}
      </dd>
      {toggle && (
        // Covers the tile, so a click anywhere opens the details; the tile's text stays a description list.
        <button
          type="button"
          aria-expanded={toggle.expanded}
          aria-controls={toggle.controls}
          aria-label={toggle.label}
          onClick={toggle.onToggle}
          className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      )}
    </div>
  );
}
