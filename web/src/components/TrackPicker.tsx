import clsx from 'clsx';
import { suggested, trackFormat, trackLanguage, type PickTrack } from '../lib/tracks';

/** The positions of the audio and subtitle tracks that stay. */
export interface TrackChoice {
  audio: Set<number>;
  subtitles: Set<number>;
}

export const suggestedChoice = (audio: PickTrack[], subtitles: PickTrack[]): TrackChoice => ({ audio: suggested(audio), subtitles: suggested(subtitles) });

/** At least one audio track must stay, where there is sound at all. */
export const keepsSound = (audio: PickTrack[], choice: TrackChoice) => audio.length === 0 || choice.audio.size > 0;

/**
 * Which audio and subtitle tracks stay: ticked ones stay, the others go. Starts from the suggestion – the first
 * track's language and the preferred one, each in its best sound.
 */
export function TrackPicker({
  audio,
  subtitles,
  choice,
  onChange,
  label,
}: {
  audio: PickTrack[];
  subtitles: PickTrack[];
  choice: TrackChoice;
  onChange: (choice: TrackChoice) => void;
  /** E.g. which titles or files the choice is for. */
  label?: string | null;
}) {
  const toggle = (kind: keyof TrackChoice, index: number) => {
    const next = new Set(choice[kind]);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange({ ...choice, [kind]: next });
  };
  const removed = audio.length - choice.audio.size + subtitles.length - choice.subtitles.size;
  return (
    <div className="rounded-xl p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-ink">
          Spuren behalten
          {label && <span className="font-normal text-ink-2"> · {label}</span>}
        </p>
        <p className="flex gap-3 text-xs">
          <button type="button" onClick={() => onChange(suggestedChoice(audio, subtitles))} className="font-medium text-accent hover:underline">
            Vorschlag
          </button>
          <button
            type="button"
            onClick={() => onChange({ audio: new Set(audio.keys()), subtitles: new Set(subtitles.keys()) })}
            className="font-medium text-accent hover:underline"
          >
            Alle
          </button>
        </p>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <TrackList title="Ton" tracks={audio} chosen={choice.audio} onToggle={(index) => toggle('audio', index)} />
        <TrackList title="Untertitel" tracks={subtitles} chosen={choice.subtitles} onToggle={(index) => toggle('subtitles', index)} />
      </div>
      <p className={clsx('mt-2 text-xs', keepsSound(audio, choice) ? 'text-ink-3' : 'text-critical')}>
        {!keepsSound(audio, choice)
          ? 'Mindestens eine Tonspur behalten.'
          : removed === 0
            ? 'Alle Spuren bleiben.'
            : `${removed} ${removed === 1 ? 'Spur kommt' : 'Spuren kommen'} heraus – ohne etwas neu zu kodieren.`}
      </p>
    </div>
  );
}

function TrackList({ title, tracks, chosen, onToggle }: { title: string; tracks: PickTrack[]; chosen: Set<number>; onToggle: (index: number) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs text-ink-2">{title}</legend>
      {tracks.length === 0 ? (
        <p className="text-xs text-ink-3">keine</p>
      ) : (
        <ul className="space-y-0.5">
          {tracks.map((track, index) => {
            const kept = chosen.has(index);
            return (
              <li key={index}>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input type="checkbox" checked={kept} onChange={() => onToggle(index)} className="mt-px size-3.5 shrink-0 accent-accent" />
                  <span className={clsx('min-w-0 break-words', !kept && 'text-ink-3 line-through')}>
                    <span className={kept ? 'font-medium text-ink' : undefined}>{trackLanguage(track)}</span>
                    {trackFormat(track) && <span className={kept ? 'text-ink-2' : undefined}> {trackFormat(track)}</span>}
                    {track.forced && <span> · erzwungen</span>}
                    {track.name && <span> · «{track.name}»</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
