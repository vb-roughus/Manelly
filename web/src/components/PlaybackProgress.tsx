import { Pause } from 'lucide-react';
import { useNow } from '../hooks/useNow';
import { formatDuration } from '../lib/format';

interface PlaybackProgressProps {
  positionMs: number;
  durationMs: number | null;
  isPaused: boolean;
  /** When `positionMs` was sampled; used to advance the bar between refreshes. */
  sampledAt: number;
  /** How far the transcoder is, 0-100; drawn as a buffer behind the playhead. */
  transcodeCompletion: number | null;
}

export function PlaybackProgress({ positionMs, durationMs, isPaused, sampledAt, transcodeCompletion }: PlaybackProgressProps) {
  const now = useNow(1000);
  const elapsed = isPaused ? 0 : Math.max(0, now - sampledAt);
  const position = durationMs ? Math.min(durationMs, positionMs + elapsed) : positionMs + elapsed;
  const percent = durationMs ? (position / durationMs) * 100 : 0;
  const buffer = transcodeCompletion !== null ? Math.max(percent, Math.min(100, transcodeCompletion)) : null;

  return (
    <div>
      <div
        role="progressbar"
        aria-label="Wiedergabefortschritt"
        aria-valuemin={0}
        aria-valuemax={durationMs ?? undefined}
        aria-valuenow={Math.round(position)}
        aria-valuetext={durationMs ? `${formatDuration(position)} von ${formatDuration(durationMs)}` : formatDuration(position)}
        className="relative h-1.5 overflow-hidden rounded-full bg-accent/15"
      >
        {buffer !== null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent/30"
            style={{ width: `${buffer}%` }}
            title={`Transcodiert bis ${Math.round(buffer)} %`}
          />
        )}
        <div
          className={isPaused ? 'absolute inset-y-0 left-0 rounded-full bg-ink-3' : 'bg-brand absolute inset-y-0 left-0 rounded-full'}
          style={{ width: `${percent}%`, transition: 'width 1s linear' }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-ink-2 tabular-nums">
        <span className="flex items-center gap-1.5">
          {isPaused && (
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <Pause className="size-3" aria-hidden /> Pausiert ·
            </span>
          )}
          {formatDuration(position)}
        </span>
        {durationMs !== null && <span>−{formatDuration(durationMs - position)} · {formatDuration(durationMs)}</span>}
      </div>
    </div>
  );
}
