import type { StreamFinding, StreamSession } from '@manelly/shared';
import { codecLabel, formatBitrate } from './format';

export interface FindingText {
  title: string;
  detail: string;
  /** What to do about it; null when there is nothing to do. */
  action: string | null;
}

const TRANSCODING_SETTINGS = 'Dashboard → Wiedergabe → Transkodierung';

const HARDWARE_LABELS: Record<string, string> = {
  qsv: 'Intel Quick Sync',
  vaapi: 'VA-API',
  nvenc: 'NVIDIA NVENC',
  amf: 'AMD AMF',
  videotoolbox: 'Apple VideoToolbox',
  v4l2m2m: 'V4L2',
  rkmpp: 'Rockchip MPP',
};

const RANGE_LABELS: Record<string, string> = {
  DOVI: 'Dolby-Vision',
  DOVIWithHDR10: 'Dolby-Vision',
  DOVIWithHDR10Plus: 'Dolby-Vision',
  DOVIWithHLG: 'Dolby-Vision',
  DOVIWithSDR: 'Dolby-Vision',
  HDR10: 'HDR10',
  HDR10Plus: 'HDR10+',
  HLG: 'HLG',
};

const decimal = (value: number, digits: number) =>
  value.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const hardwareLabel = (hardware: string) => HARDWARE_LABELS[hardware] ?? hardware.toUpperCase();
const fps = (value: number) => decimal(value, value < 10 ? 1 : 0);
const speedText = (speed: number) => `${decimal(speed, 1)}×`;

/** 8 000 ms → "8 s", 600 000 ms → "10 min". */
export function formatAhead(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Turns a finding of the server's stream diagnosis into German text. */
export function describeFinding(finding: StreamFinding, session: StreamSession): FindingText {
  switch (finding.kind) {
    case 'throughput': {
      const { speed, transcodeFps, sourceFps, bufferAheadMs } = finding;
      const frames = transcodeFps && sourceFps ? `${fps(transcodeFps)} von ${fps(sourceFps)} nötigen Bildern/s` : null;
      const ahead = bufferAheadMs !== null ? formatAhead(bufferAheadMs) : null;
      if (finding.severity === 'good') {
        const parts = [speed !== null && `${speedText(speed)} Echtzeit${frames ? ` (${frames})` : ''}`, ahead && `${ahead} Vorlauf`];
        return { title: 'Transcoding hält mit', detail: `${parts.filter(Boolean).join(', ')}.`, action: null };
      }
      if (speed === null) {
        return {
          title: 'Kaum Vorlauf',
          detail: `Das Transcoding ist der Wiedergabe nur ${ahead ?? 'wenige Sekunden'} voraus.`,
          action: 'Direkt nach dem Start oder Spulen ist das normal. Bleibt es so, kommt der Server nicht nach.',
        };
      }
      if (finding.severity === 'warning') {
        return {
          title: 'Transcoding knapp',
          detail: `Der Server schafft nur ${speedText(speed)} Echtzeit${frames ? ` (${frames})` : ''}${ahead ? ` bei ${ahead} Vorlauf` : ''} – es bleibt kaum Reserve.`,
          action: 'Ruckelt es, im Client eine tiefere Qualität wählen oder prüfen, was den Server sonst auslastet (z. B. ein Bibliotheksscan).',
        };
      }
      return {
        title: 'Server kommt nicht nach',
        detail: `Der Server schafft nur ${speedText(speed)} Echtzeit${frames ? ` (${frames})` : ''}${ahead ? `, Vorlauf ${ahead}` : ''}. Die Wiedergabe stockt oder puffert.`,
        action: 'Hardware-Beschleunigung prüfen, im Client eine tiefere Qualität wählen oder den Grund für das Transcoding beheben.',
      };
    }
    case 'softwareTranscoding':
      return {
        title: 'Transcoding in Software',
        detail: 'In Jellyfin ist keine Hardware-Beschleunigung eingerichtet – der Prozessor dekodiert und kodiert das Video allein.',
        action: `Hat der Server eine Grafikeinheit (z. B. Intel Quick Sync oder NVIDIA), unter ${TRANSCODING_SETTINGS} die Hardware-Beschleunigung einrichten.`,
      };
    case 'softwareDecoding': {
      const codec = `${codecLabel(finding.codec)}${finding.cause === 'tenBitDisabled' ? ' 10 bit' : ''}`;
      return {
        title: `${codec} wird in Software dekodiert`,
        detail: `${hardwareLabel(finding.hardware)} ist eingerichtet, aber die Hardware-Dekodierung für ${codec} ist ausgeschaltet – der Prozessor muss das Video entpacken.`,
        action: `Unter ${TRANSCODING_SETTINGS} bei der Hardware-Dekodierung «${codec}» einschalten, sofern die Grafikeinheit das unterstützt.`,
      };
    }
    case 'softwareEncoding':
      return {
        title: 'Kodierung in Software',
        detail: `${hardwareLabel(finding.hardware)} ist eingerichtet, die Hardware-Kodierung aber ausgeschaltet – der Prozessor kodiert das Video.`,
        action: `Unter ${TRANSCODING_SETTINGS} die Hardware-Kodierung einschalten.`,
      };
    case 'toneMapping': {
      const range = RANGE_LABELS[finding.videoRangeType ?? ''] ?? 'HDR';
      return finding.cause === 'disabled'
        ? {
            title: 'HDR ohne Tone-Mapping',
            detail: `Das ${range}-Video wird in SDR umgewandelt, aber Tone-Mapping ist ausgeschaltet – die Farben wirken blass${range === 'Dolby-Vision' ? ' oder grün-violett' : ''}.`,
            action: `Unter ${TRANSCODING_SETTINGS} Tone-Mapping einschalten.`,
          }
        : {
            title: 'Tone-Mapping in Software',
            detail: `Das ${range}-Video wird ohne Hardware-Beschleunigung in SDR umgewandelt – das ist sehr rechenintensiv.`,
            action: 'Hardware-Beschleunigung einrichten oder auf einem Gerät mit HDR-Unterstützung abspielen.',
          };
    }
    case 'bitrateLimit': {
      const file = finding.sourceBitrate ? ` (Datei: ${formatBitrate(finding.sourceBitrate)})` : '';
      const limit = finding.limit ? formatBitrate(finding.limit) : '';
      switch (finding.limitedBy) {
        case 'user':
          return {
            title: 'Bitrate durch Benutzer-Limit begrenzt',
            detail: `Für ${session.user.name} gilt ausserhalb des Heimnetzes ein Limit von ${limit}${file} – deshalb wird transcodiert.`,
            action: 'Das Limit lässt sich in Jellyfin beim Benutzer anpassen (Dashboard → Benutzer), falls die Leitung mehr hergibt.',
          };
        case 'server':
          return {
            title: 'Bitrate durch Server-Limit begrenzt',
            detail: `Ausserhalb des Heimnetzes gilt serverweit ein Limit von ${limit}${file} – deshalb wird transcodiert.`,
            action: 'Anpassbar unter Dashboard → Wiedergabe → Streaming; ein Limit beim Benutzer hat Vorrang.',
          };
        case 'client':
          return {
            title: 'Bitrate durch den Client begrenzt',
            detail: `Kein Limit von Jellyfin greift – die Qualitätseinstellung im Client begrenzt die Bitrate${file}.`,
            action: 'Im Client eine höhere Wiedergabequalität wählen, falls die Leitung es hergibt.',
          };
        default:
          return {
            title: 'Bitrate begrenzt',
            detail: `Die Datei überschreitet ein Bitraten-Limit – des Clients oder des Fernzugriffs${file}.`,
            action: null,
          };
      }
    }
    case 'remoteBitrate':
      return {
        title: 'Hohe Bitrate über das Internet',
        detail: `${formatBitrate(finding.bitrate)} gehen an ein Gerät ausserhalb des Heimnetzes.`,
        action: 'Ruckelt es, reicht vermutlich der Upload des Servers oder die Leitung des Geräts nicht – im Client eine tiefere Qualität wählen.',
      };
  }
}
