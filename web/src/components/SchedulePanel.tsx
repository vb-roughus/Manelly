import { useId, useState, type FormEvent } from 'react';
import type { AgentScheduleStatus, ConversionSchedule } from '@manelly/shared';
import { CalendarClock, LoaderCircle } from 'lucide-react';
import { useSaveSchedule } from '../hooks/queries';
import { foreignTimeZone } from '../lib/schedule';

const DEFAULT_WINDOW = { start: '01:00', end: '07:00' };

/** When scheduled conversions may run: a time window and/or only while nobody streams. Kept on the agent. */
export function SchedulePanel({ schedule }: { schedule: AgentScheduleStatus }) {
  const id = useId();
  const save = useSaveSchedule();
  const [useWindow, setUseWindow] = useState(schedule.window !== null);
  const [start, setStart] = useState(schedule.window?.start ?? DEFAULT_WINDOW.start);
  const [end, setEnd] = useState(schedule.window?.end ?? DEFAULT_WINDOW.end);
  const [idleOnly, setIdleOnly] = useState(schedule.idleOnly);

  const next: ConversionSchedule = { window: useWindow ? { start, end } : null, idleOnly };
  const changed = JSON.stringify(next) !== JSON.stringify({ window: schedule.window, idleOnly: schedule.idleOnly });
  const sameTimes = useWindow && start === end;
  const timeZone = foreignTimeZone(schedule.timeZone);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(next);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-4 text-sm" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold">
        <CalendarClock className="size-4 text-accent" aria-hidden />
        Zeitplan
      </h2>
      <p className="mt-1 text-ink-2">
        Umwandlungen «nach Zeitplan» startet der Agent selbst, sobald alles passt – auch nach einem Neustart des Servers und ohne dass
        Manelly läuft. «Sofort» gestartete laufen unabhängig davon.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={useWindow} onChange={(event) => setUseWindow(event.target.checked)} className="size-4 accent-accent" />
            <span className="font-medium">Nur in einem Zeitfenster starten</span>
          </label>
          {useWindow && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6.5">
              <label className="flex items-center gap-2">
                <span className="text-ink-2">von</span>
                <input type="time" required value={start} onChange={(event) => setStart(event.target.value)} className={timeClass} />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-ink-2">bis</span>
                <input type="time" required value={end} onChange={(event) => setEnd(event.target.value)} className={timeClass} />
              </label>
              <span className="text-xs text-ink-3">
                Uhrzeit des Jellyfin-Servers{timeZone ? ` (${timeZone})` : ''}. Eine laufende Umwandlung darf über das Ende hinaus fertig werden.
              </span>
            </div>
          )}
        </div>
        <div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={idleOnly} onChange={(event) => setIdleOnly(event.target.checked)} className="size-4 accent-accent" />
            <span className="font-medium">Nur wenn niemand streamt</span>
          </label>
          <p className="mt-1 pl-6.5 text-xs text-ink-2">
            Beginnt ein Stream, pausiert die Umwandlung und macht später beim zuletzt fertigen Schritt weiter. Nach einem Stream wartet
            der Agent noch 5 Minuten. Dafür gibt Manelly ihm die Jellyfin-Adresse und den API-Schlüssel.
          </p>
        </div>
      </div>

      {sameTimes && <p className="mt-3 text-xs text-critical">Anfang und Ende dürfen nicht gleich sein.</p>}
      {save.isError && <p className="mt-3 text-xs text-critical">{save.error.message}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!changed || sameTimes || save.isPending}
          className="bg-brand inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Zeitplan speichern
        </button>
        {save.isSuccess && !changed && <span className="text-xs text-good">Gespeichert.</span>}
      </div>
    </form>
  );
}

const timeClass = 'rounded-lg border border-line bg-card px-2 py-1 text-sm tabular-nums text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';
