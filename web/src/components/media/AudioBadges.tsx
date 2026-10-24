import type { AudioBadge as AudioBadgeData } from '@manelly/shared';
import clsx from 'clsx';
import { channelsLabel } from '../../lib/format';
import { AUDIO_FORMAT_LABELS, AUDIO_FORMAT_SHORT, audioLanguageName, languageShort } from '../../lib/media';

export function AudioBadge({ badge, compact = false }: { badge: AudioBadgeData; compact?: boolean }) {
  const channels = channelsLabel(badge.channels);
  const title = [audioLanguageName(badge.language), AUDIO_FORMAT_LABELS[badge.format], channels].filter(Boolean).join(' · ');
  return (
    <span
      title={badge.matches ? `${title} – passt zum Filter` : title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] leading-4 font-medium ring-1 ring-inset whitespace-nowrap',
        badge.matches ? 'bg-accent/15 text-ink ring-accent/40' : 'bg-card-2 text-ink-2 ring-line',
      )}
    >
      <span className="font-semibold">{languageShort(badge.language)}</span>
      {AUDIO_FORMAT_SHORT[badge.format]}
      {!compact && channels && <span className="text-ink-3">{channels}</span>}
    </span>
  );
}

/** Up to `max` badges plus a "+N" counter. */
export function AudioBadgeList({ badges, max = 3 }: { badges: AudioBadgeData[]; max?: number }) {
  if (badges.length === 0) return <span className="text-[0.6875rem] text-ink-3">Keine Tonspur-Infos</span>;
  const shown = badges.slice(0, max);
  const hidden = badges.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((badge) => (
        <AudioBadge key={`${badge.language}-${badge.format}`} badge={badge} compact />
      ))}
      {hidden > 0 && (
        <span
          className="rounded-md px-1 py-0.5 text-[0.6875rem] leading-4 text-ink-3"
          title={badges
            .slice(max)
            .map((badge) => `${audioLanguageName(badge.language)} ${AUDIO_FORMAT_LABELS[badge.format]}`)
            .join(', ')}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
