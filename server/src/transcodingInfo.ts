import type { TranscodingOrigin } from '@manelly/shared';
import type { JfSessionInfo, JfTranscodingInfo } from './jellyfin/types.js';

const sameId = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const isTranscoding = (session: JfSessionInfo) => Boolean(session.NowPlayingItem) && session.PlayState?.PlayMethod === 'Transcode';
const keyOf = (session: JfSessionInfo) => `${session.Id ?? ''}|${session.NowPlayingItem?.Id ?? ''}|${session.PlayState?.MediaSourceId ?? ''}`;

/**
 * Jellyfin shows some transcoding streams without their TranscodingInfo (and so without a reason):
 * it reports it to the first session with the same device id – two tabs of Jellyfin Web share one –
 * and the play method of the stream stays Transcode either way. This fills it in where Manelly can tell:
 * from another, idle session of the same device, or from what Jellyfin reported for this very stream before.
 */
export function createTranscodingInfoRecovery() {
  // Per session, item and version; dropped when the stream ends.
  const lastKnown = new Map<string, JfTranscodingInfo>();

  return function recover(sessions: JfSessionInfo[]): { sessions: JfSessionInfo[]; origins: Map<string, TranscodingOrigin> } {
    const origins = new Map<string, TranscodingOrigin>();
    const recovered = sessions.map((session): JfSessionInfo => {
      if (session.TranscodingInfo || !isTranscoding(session)) return session;
      const siblings = sessions.filter((other) => other !== session && !other.NowPlayingItem && other.TranscodingInfo && sameId(other.DeviceId, session.DeviceId));
      if (siblings.length === 1) {
        origins.set(session.Id ?? '', 'sameDevice');
        return { ...session, TranscodingInfo: siblings[0]!.TranscodingInfo };
      }
      const remembered = lastKnown.get(keyOf(session));
      if (remembered) {
        origins.set(session.Id ?? '', 'lastKnown');
        return { ...session, TranscodingInfo: remembered };
      }
      return session;
    });

    const playing = new Set<string>();
    for (const session of recovered) {
      if (!session.NowPlayingItem) continue;
      const key = keyOf(session);
      playing.add(key);
      // Live values would be stale later on.
      if (session.TranscodingInfo) lastKnown.set(key, { ...session.TranscodingInfo, Framerate: undefined, CompletionPercentage: undefined });
    }
    for (const key of lastKnown.keys()) if (!playing.has(key)) lastKnown.delete(key);
    return { sessions: recovered, origins };
  };
}
