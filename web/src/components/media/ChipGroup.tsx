import { useState } from 'react';
import clsx from 'clsx';

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
  title?: string;
}

interface ChipGroupProps {
  options: ChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Show this many chips until "Alle anzeigen" is clicked. */
  initialVisible?: number;
}

/** Multi-select chips; selecting several means "any of them". */
export function ChipGroup({ options, selected, onChange, initialVisible = Infinity }: ChipGroupProps) {
  const [expanded, setExpanded] = useState(false);
  // Selected chips stay visible even when they are beyond the cut-off.
  const visible = expanded
    ? options
    : options.filter((option, index) => index < initialVisible || selected.includes(option.value));
  const hiddenCount = options.length - visible.length;

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => toggle(option.value)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 transition ring-inset',
              active ? 'bg-accent/15 font-medium text-ink ring-accent/50' : 'bg-card text-ink-2 ring-line hover:text-ink hover:ring-ink-3',
            )}
          >
            {option.label}
            {option.count !== undefined && <span className={active ? 'text-ink-2' : 'text-ink-3'}>{option.count.toLocaleString('de-CH')}</span>}
          </button>
        );
      })}
      {(hiddenCount > 0 || expanded) && options.length > initialVisible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-full px-2 py-1 text-xs font-medium text-accent hover:underline"
        >
          {expanded ? 'Weniger anzeigen' : `Alle anzeigen (+${hiddenCount})`}
        </button>
      )}
    </div>
  );
}
