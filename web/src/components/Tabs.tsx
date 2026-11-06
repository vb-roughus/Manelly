import { addTransitionType, startTransition, useEffect, useId, useRef, ViewTransition, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

/** One tab: `short` stands in for the label on a phone; `count`, when known, shows next to it. */
export interface TabEntry<T extends string> {
  id: T;
  label: string;
  short?: string;
  icon: LucideIcon;
  count?: number | null;
}

const TAB_ENTER = { 'tab-next': 'tab-in-next', 'tab-previous': 'tab-in-previous', default: 'none' };
const TAB_EXIT = { 'tab-next': 'tab-out-next', 'tab-previous': 'tab-out-previous', default: 'none' };

/**
 * The open tab, kept in the address under `param` so links can open it; the first tab needs no parameter. Selecting
 * one replaces the address (no new history entry) and slides it in from the side it sits on.
 */
export function useTab<T extends string>(tabs: ReadonlyArray<{ id: T }>, param = 'tab'): [T, (id: T) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get(param);
  const tab = tabs.find((entry) => entry.id === requested)?.id ?? tabs[0]!.id;
  const select = (id: T) => {
    if (id === tab) return;
    startTransition(() => {
      const order = (entry: T) => tabs.findIndex((candidate) => candidate.id === entry);
      addTransitionType(order(id) > order(tab) ? 'tab-next' : 'tab-previous');
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id === tabs[0]!.id) next.delete(param);
          else next.set(param, id);
          return next;
        },
        { replace: true },
      );
    });
  };
  return [tab, select];
}

/** Tabs and the panel of the open one; `children` is that panel's content. */
export function Tabs<T extends string>({
  label,
  tabs,
  tab,
  onSelect,
  children,
}: {
  label: string;
  tabs: ReadonlyArray<TabEntry<T>>;
  tab: T;
  onSelect: (id: T) => void;
  children: ReactNode;
}) {
  const base = useId();
  return (
    <>
      <TabList base={base} label={label} tabs={tabs} tab={tab} onSelect={onSelect} />
      {/* The new tab slides in from the side it sits on (see index.css); other updates of the panel stay still. */}
      <ViewTransition key={tab} enter={TAB_ENTER} exit={TAB_EXIT} default="none">
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className="mt-4">
          {children}
        </div>
      </ViewTransition>
    </>
  );
}

/** The usual content of a tab: a card with a line about what the tab is for. */
export function TabCard({ description, children }: { description?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5 text-sm shadow-sm shadow-black/5 sm:p-6">
      {description && <p className="mb-5 text-ink-2">{description}</p>}
      {children}
    </div>
  );
}

function TabList<T extends string>({ base, label, tabs, tab, onSelect }: { base: string; label: string; tabs: ReadonlyArray<TabEntry<T>>; tab: T; onSelect: (id: T) => void }) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  // Where the tabs do not fit, the open one is scrolled into sight.
  useEffect(() => {
    refs.current.get(tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  // Arrow keys, Home and End move between the tabs, as in any tab list.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((entry) => entry.id === tab);
    const target =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target]!.id;
    onSelect(next);
    refs.current.get(next)?.focus();
  }

  return (
    // Scrolls sideways only where the tabs do not fit; the line below is drawn inside, so nothing sticks out to scroll.
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]">
      {tabs.map(({ id, label: name, short, icon: Icon, count }) => (
        <button
          key={id}
          ref={(element) => {
            if (element) refs.current.set(id, element);
            else refs.current.delete(id);
          }}
          type="button"
          role="tab"
          id={`${base}-tab-${id}`}
          aria-selected={tab === id}
          aria-controls={tab === id ? `${base}-panel` : undefined}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onSelect(id)}
          className={clsx(
            'flex shrink-0 items-center gap-2 border-b-2 px-2 py-2 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:px-3 sm:text-sm',
            tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          <Icon className="hidden size-4 sm:block" aria-hidden />
          {short ? (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{name}</span>
            </>
          ) : (
            name
          )}
          {/* On a phone only the open tab shows its count, so all tabs fit in one line. */}
          {count !== undefined && count !== null && (
            <span className={clsx('rounded-full bg-card-2 px-1.5 text-xs tabular-nums text-ink-2', tab !== id && 'hidden sm:inline')}>{count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
