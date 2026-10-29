import type { MouseEvent } from 'react';
import clsx from 'clsx';
import type { TickState } from '../lib/packageSelection';

/** A checkbox that also shows "in part"; tells whether shift was held, to tick a whole range. */
export function Tick({ state, label, onChange, className }: { state: TickState; label: string; onChange: (shift: boolean) => void; className?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      ref={(element) => {
        if (element) element.indeterminate = state === 'some';
      }}
      // A checkbox changes on a click, so the event says whether shift was held.
      onChange={(event) => onChange((event.nativeEvent as globalThis.MouseEvent).shiftKey === true)}
      className={clsx('size-4 shrink-0 cursor-pointer accent-accent', className)}
    />
  );
}

/** For a list with ticks: a shift-click ticks a range there, instead of selecting text. */
export function keepTextOnShift(event: MouseEvent) {
  if (event.shiftKey) event.preventDefault();
}
