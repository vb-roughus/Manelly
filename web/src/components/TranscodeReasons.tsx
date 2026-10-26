import { useId, useState } from 'react';
import type { StreamSession } from '@manelly/shared';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import {
  describeTranscodeReason,
  explainAudioConversion,
  explainInferredReason,
  explainReason,
  inferReasons,
  transcodingNote,
  type ReasonDetails,
} from '../lib/transcodeReasons';

/** The transcode reasons of a stream; a click on one explains it for the file that is playing. */
export function TranscodeReasons({ session }: { session: StreamSession }) {
  const [open, setOpen] = useState<string | null>(null);
  const panelId = useId();
  const reasons = session.transcoding?.reasons ?? [];
  const inferred = inferReasons(session);
  const audio = explainAudioConversion(session);
  const note = transcodingNote(session);
  if (reasons.length === 0 && inferred.length === 0 && !audio && !note) return null;

  const entries: Array<{ key: string; label: string; hint: string; details: () => ReasonDetails }> = [
    ...reasons.map((reason) => {
      const text = describeTranscodeReason(reason);
      return { key: reason, label: text.label, hint: text.hint, details: () => explainReason(reason, session) };
    }),
    ...inferred.map((reason) => {
      const details = () => explainInferredReason(reason, session);
      return { key: reason, label: details().label, hint: 'Von Manelly abgeleitet – Jellyfin nennt keinen Grund', details };
    }),
    ...(audio ? [{ key: 'audio', label: audio.label, hint: 'Warum der Ton umgewandelt wird', details: () => audio }] : []),
  ];
  const selected = entries.find((entry) => entry.key === open);

  return (
    <div className="border-t border-line px-4 py-3">
      <p className="mb-2 text-xs font-medium text-ink-2">
        {session.playback.method === 'Transcode' ? 'Warum transcodiert wird' : 'Warum nicht Direct Play'}
      </p>
      {note && <p className={clsx('text-xs text-ink-3', entries.length > 0 && 'mb-2')}>{note}</p>}
      <ul className="flex flex-wrap gap-1.5 empty:hidden">
        {entries.map((entry) => {
          const expanded = entry.key === open;
          return (
            <li key={entry.key}>
              <button
                type="button"
                title={entry.hint}
                aria-expanded={expanded}
                aria-controls={expanded ? panelId : undefined}
                onClick={() => setOpen(expanded ? null : entry.key)}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ring-1 ring-inset transition',
                  expanded ? 'bg-accent/12 text-ink ring-accent/40' : 'bg-card-2 text-ink ring-line hover:ring-ink-3',
                )}
              >
                {entry.label}
                <ChevronDown className={clsx('size-3 text-ink-3 transition', expanded && 'rotate-180')} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {selected && <Details id={panelId} details={selected.details()} />}
    </div>
  );
}

function Details({ id, details }: { id: string; details: ReasonDetails }) {
  return (
    <div id={id} className="mt-2 space-y-1.5 rounded-lg bg-card-2 p-3 text-sm ring-1 ring-line ring-inset">
      {details.facts && (
        <p>
          <span className="text-ink-2">Diese Datei: </span>
          <span className="font-medium">{details.facts}</span>
        </p>
      )}
      <p className="text-ink-2">{details.explanation}</p>
      {details.outcome && <p>{details.outcome}</p>}
      {details.tip && <p className="text-xs text-ink-3">→ {details.tip}</p>}
    </div>
  );
}
