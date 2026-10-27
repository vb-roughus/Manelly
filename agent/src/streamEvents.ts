import type { PlayMethod, RecordedMedia, StreamEvent } from '@manelly/shared';
import type { JfSession } from './jellyfin.js';

type StreamInfo = Omit<StreamEvent, 't' | 'type'>;
type JfTranscodingInfo = NonNullable<JfSession['TranscodingInfo']>;

/** Jellyfin names a transcode a moment after it started; the start waits this long for the details. */
const DETAILS_WAIT_MS = 30_000;

const sameId = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const pad = (value: number) => String(value).padStart(2, '0');

/** Mirrors the play method of Jellyfin's dashboard, like Manelly's server does. */
function playMethodOf(session: JfSession, info: JfTranscodingInfo | undefined): PlayMethod {
  if (info?.IsVideoDirect) return info.IsAudioDirect ? 'Remux' : 'DirectStream';
  return session.PlayState?.PlayMethod === 'Transcode' ? 'Transcode' : 'DirectPlay';
}

function titleOf(item: NonNullable<JfSession['NowPlayingItem']>): string {
  const name = item.Name ?? 'Unbekannter Titel';
  if (item.Type === 'Episode' && item.SeriesName) {
    const code = item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined ? `S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}` : null;
    return [item.SeriesName, code, name].filter(Boolean).join(' · ');
  }
  if (item.Type === 'Audio' && item.Artists?.length) return `${item.Artists[0]} · ${name}`;
  return item.Type === 'Movie' && item.ProductionYear ? `${name} (${item.ProductionYear})` : name;
}

function infoOf(session: JfSession, transcodingInfo: JfTranscodingInfo | undefined, previous: StreamInfo | undefined): StreamInfo {
  const item = session.NowPlayingItem ?? {};
  const streams = item.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === 'Video');
  const audios = streams.filter((stream) => stream.Type === 'Audio');
  const audioIndex = session.PlayState?.AudioStreamIndex;
  const audio = (audioIndex !== undefined ? audios.find((stream) => stream.Index === audioIndex) : undefined) ?? audios.find((stream) => stream.IsDefault) ?? audios[0];
  const source: RecordedMedia = {
    container: item.Container ?? null,
    videoCodec: video?.Codec ?? null,
    height: video?.Height ?? null,
    videoRange: video?.VideoRangeType ?? null,
    audioCodec: audio?.Codec ?? null,
    audioChannels: audio?.Channels ?? null,
  };

  const method = playMethodOf(session, transcodingInfo);
  const hardware = transcodingInfo?.HardwareAccelerationType;
  // Without details in this answer, a transcode keeps the ones Jellyfin gave for it before.
  const keep = !transcodingInfo && method === 'Transcode' && previous?.method === 'Transcode';
  const transcoding: StreamInfo['transcoding'] = transcodingInfo
    ? {
        container: transcodingInfo.Container ?? null,
        videoCodec: transcodingInfo.VideoCodec ?? null,
        height: transcodingInfo.Height ?? null,
        videoRange: null,
        audioCodec: transcodingInfo.AudioCodec ?? null,
        audioChannels: transcodingInfo.AudioChannels ?? null,
        videoDirect: transcodingInfo.IsVideoDirect ?? false,
        audioDirect: transcodingInfo.IsAudioDirect ?? false,
        hardware: hardware && hardware.toLowerCase() !== 'none' ? hardware : null,
      }
    : keep
      ? previous.transcoding
      : null;
  const reasons = transcodingInfo ? (transcodingInfo.TranscodeReasons ?? []) : keep ? previous.reasons : [];
  const sourceBitrate = (video?.BitRate ?? 0) + (audio?.BitRate ?? 0);

  return {
    stream: `${session.Id ?? session.DeviceId ?? ''}|${item.Id ?? ''}`,
    user: session.UserName ?? 'Unbekannt',
    client: session.Client ?? 'Unbekannter Client',
    device: session.DeviceName ?? 'Unbekanntes Gerät',
    remoteAddress: session.RemoteEndPoint?.replace(/^::ffff:/i, '') ?? null,
    title: titleOf(item),
    itemType: item.Type ?? null,
    method,
    source,
    transcoding,
    reasons,
    bitrate: transcodingInfo?.Bitrate || (keep ? previous.bitrate : null) || (sourceBitrate > 0 ? sourceBitrate : null),
  };
}

/** What makes a change worth recording: how it plays, and why. Not the bitrate, which moves all the time. */
function signatureOf(info: StreamInfo): string {
  const t = info.transcoding;
  return JSON.stringify([
    info.method,
    [...info.reasons].sort(),
    t && [t.container, t.videoCodec, t.height, t.audioCodec, t.audioChannels, t.videoDirect, t.audioDirect, t.hardware],
  ]);
}

interface OpenStream {
  info: StreamInfo;
  signature: string;
  since: number;
  lastSeen: number;
  /** The start is on disk; until then it waits for Jellyfin's transcode details. */
  written: boolean;
}

export interface StreamCounts {
  streams: number;
  transcodes: number;
  /** Bits per second; null when no stream says. */
  bitrate: number | null;
}

/**
 * Turns Jellyfin's sessions, asked for again and again, into stream events: a start,
 * every change of how a stream plays, and its stop.
 */
export function createStreamTracker({ maxGapMs = 60_000 }: { maxGapMs?: number } = {}) {
  const open = new Map<string, OpenStream>();

  return {
    /** The events since the last call, and what plays right now. */
    update(sessions: JfSession[], t: number): { events: StreamEvent[]; counts: StreamCounts } {
      const events: StreamEvent[] = [];
      const playing = sessions.filter((session) => session.NowPlayingItem);
      const seen = new Set<string>();
      const counts: StreamCounts = { streams: playing.length, transcodes: 0, bitrate: null };

      for (const session of playing) {
        let transcodingInfo = session.TranscodingInfo;
        // Jellyfin reports a transcode to the first session of the same device; two tabs of Jellyfin Web share one.
        if (!transcodingInfo && session.PlayState?.PlayMethod === 'Transcode') {
          const siblings = sessions.filter((other) => other !== session && !other.NowPlayingItem && other.TranscodingInfo && sameId(other.DeviceId, session.DeviceId));
          if (siblings.length === 1) transcodingInfo = siblings[0]!.TranscodingInfo;
        }
        const id = `${session.Id ?? session.DeviceId ?? ''}|${session.NowPlayingItem?.Id ?? ''}`;
        const current = open.get(id);
        const info = infoOf(session, transcodingInfo, current?.info);
        const signature = signatureOf(info);
        seen.add(id);
        if (info.method === 'Transcode') counts.transcodes++;
        if (info.bitrate) counts.bitrate = (counts.bitrate ?? 0) + info.bitrate;

        const stream = current ?? { info, signature, since: t, lastSeen: t, written: false };
        if (current?.written && signature !== current.signature) events.push({ t, type: 'change', ...info });
        Object.assign(stream, { info, signature, lastSeen: t });
        open.set(id, stream);
        const details = info.method !== 'Transcode' || info.transcoding !== null;
        if (!stream.written && (details || t - stream.since >= DETAILS_WAIT_MS)) {
          events.push({ t: stream.since, type: 'start', ...info });
          stream.written = true;
        }
      }

      for (const [id, stream] of open) {
        if (seen.has(id)) continue;
        if (!stream.written) events.push({ t: stream.since, type: 'start', ...stream.info });
        // Gone after a long gap (the agent or Jellyfin was away): it was last seen then.
        events.push({ t: t - stream.lastSeen > maxGapMs ? stream.lastSeen : t, type: 'stop', ...stream.info });
        open.delete(id);
      }
      return { events, counts };
    },

    /** After a restart: the streams that had no stop yet, and when the agent last recorded anything. */
    restore(events: StreamEvent[], lastSeen: number) {
      open.clear();
      const sorted = [...events].sort((a, b) => a.t - b.t);
      for (const event of sorted) {
        if (event.type === 'stop') {
          open.delete(event.stream);
          continue;
        }
        const { t: _t, type: _type, ...info } = event;
        const since = open.get(event.stream)?.since ?? event.t;
        open.set(event.stream, { info, signature: signatureOf(info), since, lastSeen: Math.max(lastSeen, event.t), written: true });
      }
    },

    reset() {
      open.clear();
    },

    /** Streams playing as far as the tracker knows. */
    playing(): Set<string> {
      return new Set(open.keys());
    },
  };
}

export type StreamTracker = ReturnType<typeof createStreamTracker>;
