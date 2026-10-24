import { useEffect, useRef } from 'react';
import type { AudioTrack, MediaDetail, MediaVersion, SeasonDetail } from '@manelly/shared';
import { Check, ExternalLink, Star, X } from 'lucide-react';
import clsx from 'clsx';
import { useMediaDetail, useServerStatus } from '../../hooks/queries';
import { itemImageUrl } from '../../lib/api';
import { channelsLabel, codecLabel, joinParts } from '../../lib/format';
import { AUDIO_FORMAT_LABELS, AUDIO_FORMAT_SHORT, DYNAMIC_RANGE_LABELS, audioLanguageName, hasAudioCondition, type MediaFilters } from '../../lib/media';
import { ErrorPanel } from '../ErrorPanel';

interface MediaDetailDialogProps {
  id: string | null;
  filters: MediaFilters;
  onClose: () => void;
}

export function MediaDetailDialog({ id, filters, onClose }: MediaDetailDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, isPending } = useMediaDetail(id, filters);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (id && !element.open) element.showModal();
    if (!id && element.open) element.close();
  }, [id]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && onClose()}
      aria-label={data?.summary.name ?? 'Details'}
      className="m-auto max-h-[90dvh] w-[min(56rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="max-h-[90dvh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schliessen"
          className="absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
        >
          <X className="size-4" aria-hidden />
        </button>
        {data ? (
          <DetailContent detail={data} audioFilterActive={hasAudioCondition(filters)} />
        ) : isPending ? (
          <div aria-busy className="h-96 animate-pulse bg-card-2" />
        ) : (
          <div className="p-6">
            <ErrorPanel error={error} />
          </div>
        )}
      </div>
    </dialog>
  );
}

function DetailContent({ detail, audioFilterActive }: { detail: MediaDetail; audioFilterActive: boolean }) {
  const { summary } = detail;
  const { data: server } = useServerStatus();
  const backdrop = detail.backdrop ?? summary.poster;
  const jellyfinLink = server ? `${server.url}/web/#/details?id=${summary.id}&serverId=${server.id}` : null;
  const years = summary.type === 'Series' && summary.endYear && summary.endYear !== summary.year ? `${summary.year}–${summary.endYear}` : summary.year;

  return (
    <article>
      <header className="relative isolate overflow-hidden">
        {backdrop && (
          <img
            src={itemImageUrl(backdrop, { maxWidth: 1200 })}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 size-full scale-110 object-cover blur-xl"
            style={{ opacity: 'var(--backdrop-opacity)' }}
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent to-card" />
        <div className="flex gap-5 p-5 pt-8 sm:p-7">
          {summary.poster && (
            <img
              src={itemImageUrl(summary.poster, { maxHeight: 420 })}
              alt=""
              className="hidden aspect-[2/3] w-36 shrink-0 self-start rounded-xl object-cover shadow-lg ring-1 ring-line sm:block"
            />
          )}
          <div className="min-w-0 space-y-2 pr-8">
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">{summary.type === 'Series' ? 'Serie' : 'Film'}</p>
            <h2 className="text-2xl font-semibold tracking-tight">{summary.name}</h2>
            {detail.originalTitle && <p className="text-sm text-ink-2">{detail.originalTitle}</p>}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              {years && <span>{years}</span>}
              {summary.communityRating !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5 fill-current text-warning" aria-hidden />
                  {summary.communityRating.toFixed(1)}
                </span>
              )}
              {summary.officialRating && <span className="rounded px-1.5 ring-1 ring-line">{summary.officialRating}</span>}
              {summary.genres.length > 0 && <span>{summary.genres.join(', ')}</span>}
            </p>
            {detail.overview && <p className="line-clamp-5 text-sm leading-relaxed text-ink-2">{detail.overview}</p>}
            {jellyfinLink && (
              <a
                href={jellyfinLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-accent hover:underline"
              >
                In Jellyfin öffnen
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="space-y-6 px-5 pb-6 sm:px-7">
        {summary.type === 'Movie' ? (
          detail.versions.length ? (
            detail.versions.map((version, index) => <VersionTracks key={index} version={version} showName={detail.versions.length > 1} />)
          ) : (
            <p className="text-sm text-ink-2">Jellyfin hat für diesen Film keine Medieninformationen.</p>
          )
        ) : (
          <Seasons seasons={detail.seasons} audioFilterActive={audioFilterActive} />
        )}
      </div>
    </article>
  );
}

function VersionTracks({ version, showName }: { version: MediaVersion; showName: boolean }) {
  const video = joinParts([
    version.resolution,
    codecLabel(version.videoCodec),
    version.dynamicRange && DYNAMIC_RANGE_LABELS[version.dynamicRange],
    version.container?.toUpperCase(),
  ]);
  return (
    <section>
      <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        {showName ? version.name || 'Version' : 'Tonspuren'}
        {video && <span className="text-xs font-normal text-ink-2">{video}</span>}
      </h3>
      <TrackTable tracks={version.audio} />
    </section>
  );
}

function TrackTable({ tracks }: { tracks: AudioTrack[] }) {
  if (tracks.length === 0) return <p className="text-sm text-ink-2">Keine Tonspuren bekannt.</p>;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-card-2 text-xs text-ink-2">
          <tr>
            <th className="px-3 py-2 font-medium">Sprache</th>
            <th className="px-3 py-2 font-medium">Format</th>
            <th className="px-3 py-2 font-medium">Kanäle</th>
            <th className="px-3 py-2 font-medium">Titel</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tracks.map((track, index) => (
            <tr key={index} className={clsx(track.matches && 'bg-accent/10')}>
              <td className="px-3 py-2 whitespace-nowrap">
                {track.matches && (
                  <Check className="mr-1.5 inline size-3.5 text-accent" aria-label="Passt zum Filter" />
                )}
                {audioLanguageName(track.language)}
                {track.isDefault && <span className="ml-1.5 text-xs text-ink-3">Standard</span>}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {[...track.formats].reverse().map((format) => (
                    <span
                      key={format}
                      className={clsx(
                        'rounded px-1.5 py-0.5 text-xs whitespace-nowrap ring-1 ring-inset',
                        format === 'atmos' || format === 'dtsx' ? 'bg-accent/15 font-medium ring-accent/40' : 'ring-line',
                      )}
                    >
                      {AUDIO_FORMAT_LABELS[format]}
                    </span>
                  ))}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{track.channelLayout ?? channelsLabel(track.channels) ?? '–'}</td>
              <td className="max-w-[16rem] truncate px-3 py-2 text-ink-2" title={track.title ?? track.profile ?? undefined}>
                {track.title ?? '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Seasons({ seasons, audioFilterActive }: { seasons: SeasonDetail[]; audioFilterActive: boolean }) {
  if (seasons.length === 0) return <p className="text-sm text-ink-2">Keine Folgen mit Dateien gefunden.</p>;
  const totalEpisodes = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
  return (
    <div className="space-y-2">
      {audioFilterActive && <p className="text-xs text-ink-2">Markiert: Folgen mit einer Tonspur, die zum Filter passt.</p>}
      {seasons.map((season) => {
        const matching = season.episodes.filter((episode) => episode.matches).length;
        return (
          <details key={season.season ?? 'none'} open={totalEpisodes <= 30} className="group rounded-xl ring-1 ring-line">
            <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-card-2 px-3 py-2 text-sm font-medium">
              <span>{season.season === null ? 'Ohne Staffel' : season.season === 0 ? 'Specials' : `Staffel ${season.season}`}</span>
              <span className="text-xs font-normal text-ink-2">
                {audioFilterActive ? `${matching} von ${season.episodes.length} passen` : `${season.episodes.length} Folgen`}
              </span>
            </summary>
            <ul className="divide-y divide-line">
              {season.episodes.map((episode) => (
                <li key={episode.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  {audioFilterActive && (
                    <span
                      className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', episode.matches ? 'bg-good/15 text-good' : 'bg-critical/15 text-critical')}
                      title={episode.matches ? 'Passende Tonspur vorhanden' : 'Keine passende Tonspur'}
                    >
                      {episode.matches ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                    </span>
                  )}
                  <span className="w-10 shrink-0 text-ink-3 tabular-nums">{episode.episode !== null ? `E${String(episode.episode).padStart(2, '0')}` : '–'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{episode.name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {episode.audio.map((track, index) => (
                        <span
                          key={index}
                          className={clsx(
                            'rounded px-1.5 py-0.5 text-[0.6875rem] ring-1 ring-inset',
                            track.matches ? 'bg-accent/15 text-ink ring-accent/40' : 'bg-card-2 text-ink-2 ring-line',
                          )}
                        >
                          {joinParts([
                            track.language?.toUpperCase() ?? '?',
                            [...track.formats].reverse().map((format) => AUDIO_FORMAT_SHORT[format]).join(' '),
                            channelsLabel(track.channels),
                          ])}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{joinParts([episode.resolution, episode.dynamicRange !== 'SDR' && episode.dynamicRange])}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
