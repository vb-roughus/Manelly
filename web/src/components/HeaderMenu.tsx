import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

/**
 * A button at the top right that opens a panel below it – the bell, the streams. On a phone the panel spans the
 * screen below the top bar. A click elsewhere or Escape closes it.
 */
export function HeaderMenu({
  icon: Icon,
  label,
  badge,
  heading,
  action,
  open,
  onOpenChange,
  children,
}: {
  icon: LucideIcon;
  /** For screen readers and the tooltip, e.g. «Streams – 2 aktiv». */
  label: string;
  /** The small sign on the button: a count or a spinner. */
  badge?: ReactNode;
  heading: string;
  /** Next to the heading, e.g. a link. */
  action?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        className={clsx(
          'relative grid size-9 place-items-center rounded-lg text-ink-2 ring-1 ring-line transition hover:bg-card hover:text-ink',
          open && 'bg-card text-ink',
        )}
      >
        <Icon className="size-4" aria-hidden />
        {badge}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={heading}
          className={clsx(
            'z-40 overflow-hidden rounded-2xl border border-line bg-card text-sm shadow-xl shadow-black/15',
            'max-lg:fixed max-lg:inset-x-4 max-lg:top-16 lg:absolute lg:top-full lg:right-0 lg:mt-2 lg:w-96',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="font-semibold">{heading}</p>
            {action}
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

/** The count on a header button; red for something that needs a look. */
export function CountBadge({ count, tone = 'accent' }: { count: number; tone?: 'accent' | 'critical' }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx(
        'absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums',
        tone === 'critical' ? 'bg-critical' : 'bg-accent',
      )}
      aria-hidden
    >
      {count}
    </span>
  );
}
