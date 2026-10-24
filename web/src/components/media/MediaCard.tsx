import { useState, type ReactNode } from 'react';
import type { MediaSummary } from '@manelly/shared';
import { Film, Star, Tv } from 'lucide-react';
import clsx from 'clsx';
import { itemImageUrl } from '../../lib/api';
import { DYNAMIC_RANGE_LABELS, RESOLUTION_ORDER } from '../../lib/media';
import { AudioBadgeList } from './AudioBadges';

export function MediaCard({ item, onOpen }: { item: MediaSummary; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const best = RESOLUTION_ORDER.find((resolution) => item.resolutions.includes(resolution));
  const hdr = item.dynamicRanges.find((range) => range !== 'SDR');
  const years = item.type === 'Series' && item.endYear && item.endYear !== item.year ? `${item.year}–${item.endYear}` : item.year;
  const Fallback = item.type === 'Series' ? Tv : Film;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-card-2 shadow-sm ring-1 ring-line transition group-hover:shadow-lg group-hover:ring-accent/40">
        {item.poster && !failed ? (
          <img
            src={itemImageUrl(item.poster, { maxHeight: 480 })}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-3">
            <Fallback className="size-10" aria-hidden />
          </div>
        )}
        <div className="absolute inset-x-1.5 top-1.5 flex justify-between gap-1">
          {item.type === 'Series' ? <PosterTag>Serie</PosterTag> : <span />}
          {best && <PosterTag>{[best, hdr && DYNAMIC_RANGE_LABELS[hdr].replace('Dolby Vision', 'DV')].filter(Boolean).join(' · ')}</PosterTag>}
        </div>
        {item.episodes?.matching != null && <Coverage matching={item.episodes.matching} total={item.episodes.total} />}
      </div>

      <div className="mt-2 min-w-0 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium">{item.name}</h3>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs whitespace-nowrap text-ink-2">
          {years && <span>{years}</span>}
          {item.communityRating !== null && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3 fill-current text-warning" aria-hidden />
              {item.communityRating.toFixed(1)}
            </span>
          )}
          {item.type === 'Series' && item.episodes && <span>{item.episodes.total} Folgen</span>}
        </p>
        <AudioBadgeList badges={item.audio} />
      </div>
    </button>
  );
}

function PosterTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-black/65 px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide text-white backdrop-blur-sm">
      {children}
    </span>
  );
}

function Coverage({ matching, total }: { matching: number; total: number }) {
  const complete = total > 0 && matching === total;
  return (
    <div
      className={clsx(
        'absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5 text-[0.6875rem] font-medium text-white',
        'bg-gradient-to-t from-black/80 to-transparent',
      )}
      title="Folgen mit passender Tonspur"
    >
      <span className={clsx('mr-1 inline-block size-1.5 rounded-full align-middle', complete ? 'bg-good' : matching > 0 ? 'bg-warning' : 'bg-critical')} />
      {matching} von {total} Folgen
    </div>
  );
}
