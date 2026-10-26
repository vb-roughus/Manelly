import { useState, type ReactNode } from 'react';
import type { StreamSession } from '@manelly/shared';
import {
  AudioLines,
  Captions,
  Film,
  Globe,
  House,
  Laptop,
  Monitor,
  Music,
  Package,
  Smartphone,
  Tv,
  Video,
  VolumeX,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { itemImageUrl, userImageUrl } from '../lib/api';
import {
  channelsLabel,
  codecLabel,
  describeAudio,
  describeVideo,
  formatBitrate,
  initials,
  itemHeadline,
  joinParts,
  languageLabel,
  resolutionLabel,
} from '../lib/format';
import { PlayMethodBadge } from './PlayMethodBadge';
import { PlaybackProgress } from './PlaybackProgress';
import { StreamDiagnosis } from './StreamDiagnosis';
import { TranscodeReasons } from './TranscodeReasons';

export function StreamCard({ session, sampledAt }: { session: StreamSession; sampledAt: number }) {
  const { item, playback, transcoding } = session;
  const { title, subtitle } = itemHeadline(item);
  const backdrop = item.backdrop ?? item.poster;

  return (
    <article
      className={clsx(
        'relative isolate overflow-hidden rounded-2xl border bg-card shadow-sm shadow-black/5',
        session.health.severity === 'critical' ? 'border-critical/50' : 'border-line',
      )}
    >
      {backdrop && (
        <div aria-hidden className="absolute inset-0 -z-10">
          <img
            src={itemImageUrl(backdrop, { maxWidth: 960 })}
            alt=""
            className="size-full scale-110 object-cover blur-2xl"
            style={{ opacity: 'var(--backdrop-opacity)' }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/60 to-card" />
        </div>
      )}

      <div className="flex gap-4 p-4">
        {/* Keyed by image so a failed load resets when the next item starts. */}
        <Poster key={item.poster?.tag ?? item.id} session={session} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-base font-semibold" title={title}>
                {title}
              </h3>
              {subtitle && (
                <p className="line-clamp-2 text-sm text-ink-2" title={subtitle}>
                  {subtitle}
                </p>
              )}
            </div>
            <PlayMethodBadge
              method={playback.method}
              hardware={playback.method === 'Transcode' ? transcoding?.hardwareAcceleration : null}
            />
          </div>
          <UserLine session={session} />
          <div className="mt-auto">
            <PlaybackProgress
              positionMs={playback.positionMs}
              durationMs={item.durationMs}
              isPaused={playback.isPaused}
              sampledAt={sampledAt}
              transcodeCompletion={transcoding?.completionPercentage ?? null}
            />
          </div>
        </div>
      </div>

      <StreamDetails session={session} />

      <StreamDiagnosis session={session} />

      <TranscodeReasons session={session} />
    </article>
  );
}

const POSTER_SIZES = {
  portrait: 'w-20 aspect-[2/3] sm:w-24',
  square: 'w-24 aspect-square sm:w-28',
  landscape: 'w-28 aspect-video sm:w-36',
} as const;

function Poster({ session }: { session: StreamSession }) {
  const { poster, type } = session.item;
  const [failed, setFailed] = useState(false);
  const aspect = poster?.aspect ?? (type === 'Audio' ? 'square' : 'portrait');
  const FallbackIcon = type === 'Audio' ? Music : type === 'TvChannel' ? Tv : Film;

  return (
    <div className={clsx('relative shrink-0 self-start overflow-hidden rounded-xl bg-card-2 shadow-md ring-1 ring-line', POSTER_SIZES[aspect])}>
      {poster && !failed ? (
        <img
          src={itemImageUrl(poster, { maxHeight: 360 })}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-ink-3">
          <FallbackIcon className="size-8" aria-hidden />
        </div>
      )}
    </div>
  );
}

function deviceIcon(session: StreamSession): LucideIcon {
  const text = `${session.client} ${session.device}`.toLowerCase();
  if (/\btv\b|android tv|tizen|webos|roku|fire|shield|apple tv|kodi/.test(text)) return Tv;
  if (/iphone|ipad|android|pixel|galaxy|phone|swiftfin|finamp|streamyfin/.test(text)) return Smartphone;
  if (/web|chrome|firefox|safari|edge|opera/.test(text)) return Monitor;
  return Laptop;
}

/** Who is watching, and on which device. */
function UserLine({ session }: { session: StreamSession }) {
  const DeviceIcon = deviceIcon(session);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar key={session.user.imageTag} session={session} />
      <div className="min-w-0 text-sm">
        <p className="truncate font-semibold" title={`Benutzer: ${session.user.name}`}>
          <span className="sr-only">Benutzer: </span>
          {session.user.name}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-ink-2">
          <DeviceIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" title={joinParts([session.client, session.appVersion])}>
            {session.device} · {session.client}
          </span>
          {session.playback.isMuted && (
            <span className="flex shrink-0 items-center gap-1">
              · <VolumeX className="size-3.5" aria-hidden /> Stumm
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function Avatar({ session }: { session: StreamSession }) {
  const { id, name, imageTag } = session.user;
  const [failed, setFailed] = useState(false);
  if (id && imageTag && !failed) {
    return (
      <img
        src={userImageUrl(id, imageTag, 96)}
        alt=""
        onError={() => setFailed(true)}
        className="size-9 shrink-0 rounded-full object-cover ring-1 ring-line"
      />
    );
  }
  return (
    <span aria-hidden className="bg-brand grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white">
      {initials(name)}
    </span>
  );
}

function StreamDetails({ session }: { session: StreamSession }) {
  const { source, transcoding, item } = session;
  const tracks: Array<{ icon: LucideIcon; label: string; value: ReactNode }> = [];

  if (source.video) {
    const target =
      transcoding && !transcoding.isVideoDirect && item.type !== 'Audio'
        ? joinParts([resolutionLabel(transcoding.width, transcoding.height), codecLabel(transcoding.videoCodec)])
        : null;
    tracks.push({ icon: Video, label: 'Video', value: <Conversion from={describeVideo(source.video)} to={target} /> });
  }

  if (source.audio) {
    const target =
      transcoding && !transcoding.isAudioDirect
        ? joinParts([codecLabel(transcoding.audioCodec), channelsLabel(transcoding.audioChannels)])
        : null;
    tracks.push({ icon: AudioLines, label: 'Audio', value: <Conversion from={describeAudio(source.audio)} to={target} /> });
  }

  if (source.subtitle) {
    const burnedIn = transcoding?.reasons.includes('SubtitleCodecNotSupported') ?? false;
    const description = joinParts([
      languageLabel(source.subtitle.language),
      codecLabel(source.subtitle.codec),
      source.subtitle.isExternal && 'extern',
    ]);
    tracks.push({
      icon: Captions,
      label: 'Untertitel',
      value: <Conversion from={description} to={burnedIn ? 'eingebrannt' : null} />,
    });
  }

  const containerTarget =
    transcoding?.container && transcoding.container !== source.container ? transcoding.container.toUpperCase() : null;

  return (
    <>
      {tracks.length > 0 && (
        <dl className="space-y-1.5 border-t border-line px-4 py-3 text-sm">
          {tracks.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex min-w-0 items-baseline gap-2">
              <dt className="flex w-24 shrink-0 items-center gap-1.5 text-ink-2">
                <Icon className="size-3.5 translate-y-0.5 self-start" aria-hidden />
                {label}
              </dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl className="grid grid-cols-3 divide-x divide-line border-t border-line text-sm">
        <Fact icon={Package} label="Container">
          <Conversion from={source.container?.toUpperCase() ?? '–'} to={containerTarget} />
        </Fact>
        <Fact icon={Wifi} label="Bitrate" note={transcoding?.bitrate ? 'Transcoder' : session.estimatedBitrate ? 'Quelle' : null}>
          {session.estimatedBitrate ? formatBitrate(session.estimatedBitrate) : '–'}
        </Fact>
        <Fact
          icon={session.isLocalNetwork ? House : Globe}
          label="Netzwerk"
          note={session.remoteAddress}
        >
          {session.isLocalNetwork === null ? '–' : session.isLocalNetwork ? 'Lokal' : 'Extern'}
        </Fact>
      </dl>
    </>
  );
}

function Fact({ icon: Icon, label, note, children }: { icon: LucideIcon; label: string; note?: string | null; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5 sm:px-4">
      <dt className="flex items-center gap-1.5 text-xs text-ink-2">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 font-medium break-words">{children}</dd>
      {note && (
        <dd className="truncate text-xs text-ink-3 tabular-nums" title={note}>
          {note}
        </dd>
      )}
    </div>
  );
}

function Conversion({ from, to }: { from: string; to: string | null }) {
  if (!to) return <>{from || '–'}</>;
  return (
    <>
      <span className="text-ink-2">{from || '–'}</span>
      <span className="mx-1.5 text-warning" aria-label="wird umgewandelt zu">
        →
      </span>
      <span className="font-medium">{to}</span>
    </>
  );
}
