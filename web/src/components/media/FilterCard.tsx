import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface FilterCardProps {
  /** Used for element ids. */
  id: string;
  title: string;
  icon: LucideIcon;
  /** The active filters in a few words; shown while collapsed. Null when nothing is set. */
  summary: string | null;
  onClear: () => void;
  children: ReactNode;
}

/** A highlighted, collapsible group of filters. */
export function FilterCard({ id, title, icon: Icon, summary, onClear, children }: FilterCardProps) {
  const [open, setOpen] = useState(false);
  const headingId = `${id}-filter-heading`;
  const contentId = `${id}-filter-content`;

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-accent/30 bg-accent/5">
      <div className="flex items-center gap-3 px-4 py-3">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-2 text-left text-sm font-semibold"
          >
            <Icon className="size-4 shrink-0 text-accent" aria-hidden />
            {title}
            {summary && !open && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Filter aktiv" />}
          </button>
        </h2>
        {summary && (
          <button type="button" onClick={onClear} className="text-xs font-medium text-accent hover:underline">
            Entfernen
          </button>
        )}
        {/* Second click target for the same toggle; the title button is the one for keyboards and screen readers. */}
        <button type="button" tabIndex={-1} aria-hidden onClick={() => setOpen(!open)} className="text-ink-3 hover:text-ink">
          <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {!open && summary && (
        <p className="-mt-1 truncate px-4 pb-3 text-xs text-ink-2" title={summary}>
          {summary}
        </p>
      )}

      {/* Hidden rather than unmounted, so expanded chip lists keep their state. */}
      <div id={contentId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
