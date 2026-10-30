import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import clsx from 'clsx';
import { filterByWords } from '../lib/search';

export interface SearchOption {
  value: string;
  label: string;
}

interface SearchSelectProps {
  id: string;
  options: readonly SearchOption[];
  /** Always on top of the list, whatever is typed – e.g. «Neue Serie …». */
  pinned?: SearchOption;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Takes the focus once it can be used – not on a touch screen, where that would bring up the keyboard. */
  autoFocus?: boolean;
}

/**
 * A dropdown to type in: the list shows the options with every word typed; arrows and Enter pick, Escape closes the
 * list (and only the list, also in a dialog). The list opens in the flow below the field, so no dialog cuts it off.
 */
export function SearchSelect({ id, options, pinned, value, onChange, placeholder, disabled = false, autoFocus = false }: SearchSelectProps) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  // What was typed; null while nothing was, so the field shows the choice and the list all options.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const all = pinned ? [pinned, ...options] : options;
  const selected = all.find((option) => option.value === value) ?? null;
  const matches = query === null ? options : filterByWords(options, query);
  const shown = pinned ? [pinned, ...matches] : matches;

  useEffect(() => {
    if (autoFocus && !disabled && !window.matchMedia('(pointer: coarse)').matches) input.current?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function openList() {
    setOpen(true);
    setActive(Math.max(0, all.findIndex((option) => option.value === value)));
  }

  function close() {
    setOpen(false);
    setQuery(null);
  }

  function choose(option: SearchOption) {
    onChange(option.value);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else if (shown.length > 0) setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (event.key === 'Enter' && open) {
      // Picks; with the list closed, Enter sends the form as usual.
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          value={query ?? selected?.label ?? ''}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            // The first match, not the pinned option, is what Enter takes.
            setActive(pinned && filterByWords(options, event.target.value).length > 0 ? 1 : 0);
            setOpen(true);
          }}
          onClick={() => {
            if (open) return;
            openList();
            // Typing replaces the choice shown.
            input.current?.select();
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
          className="block w-full rounded-lg border border-line bg-card py-1.5 pr-8 pl-8 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60"
        />
        <ChevronDown className={clsx('pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3 transition', open && 'rotate-180')} aria-hidden />
      </div>
      {open && (
        <div className="mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-sm">
          {query !== null && matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-3">Nichts gefunden für «{query}».</p>}
          <ul ref={list} id={listId} role="listbox" aria-label={placeholder} className="max-h-60 overflow-y-auto py-1">
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                // The field keeps the focus, so the click still finds the list open.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseMove={() => setActive(index)}
                className={clsx(
                  'cursor-pointer px-3 py-1.5 text-sm',
                  index === active && 'bg-card-2',
                  option.value === value ? 'font-medium text-accent' : 'text-ink',
                  pinned && index === 0 && 'border-b border-line italic',
                )}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
