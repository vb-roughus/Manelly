import type { HardwareTestId, TranscodingCheck } from '@manelly/shared';
import { codecLabel } from './format';
import { hardwareLabel } from './streamFindings';

export interface CheckText {
  title: string;
  detail: string;
  action: string | null;
}

const SETTINGS = 'Dashboard → Wiedergabe → Transkodierung';
const SYSTEM_LABELS: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };
const PLATFORM_HINTS: Record<string, string> = {
  windows: 'Intel Quick Sync (QSV), NVIDIA NVENC oder AMD AMF',
  linux: 'VA-API (Intel und AMD), Intel Quick Sync oder NVIDIA NVENC',
  macos: 'Apple VideoToolbox',
};

/** Turns a check of Jellyfin's transcoding settings into German text. */
export function describeCheck(check: TranscodingCheck): CheckText {
  switch (check.kind) {
    case 'ok':
      return {
        title: `${hardwareLabel(check.hardware)} ist eingerichtet`,
        detail: 'Hardware-Kodierung ist eingeschaltet, H.264 und HEVC werden in Hardware dekodiert, und die letzten Transcodes liefen ohne Hardware-Fehler.',
        action: 'Ob die Grafikeinheit wirklich arbeitet, zeigt «Hardware testen».',
      };
    case 'noAcceleration':
      return {
        title: 'Keine Hardware-Beschleunigung eingerichtet',
        detail: 'Jedes Transcoding läuft auf dem Prozessor – bei 4K oder mehreren Streams reicht das oft nicht.',
        action: `Hat der Server eine Grafikeinheit, unter ${SETTINGS} die passende Beschleunigung wählen.`,
      };
    case 'platformMismatch':
      return {
        title: 'Beschleunigung passt nicht zum System',
        detail: `${hardwareLabel(check.hardware)} gibt es unter ${SYSTEM_LABELS[check.operatingSystem] ?? check.operatingSystem} nicht – Jellyfin kodiert deshalb in Software.`,
        action: `Unter ${SETTINGS} ${PLATFORM_HINTS[check.operatingSystem] ?? 'eine passende Beschleunigung'} wählen.`,
      };
    case 'encodingDisabled':
      return {
        title: 'Hardware-Kodierung ausgeschaltet',
        detail: `${hardwareLabel(check.hardware)} dekodiert nur; kodiert wird auf dem Prozessor.`,
        action: `Unter ${SETTINGS} «Hardware-Kodierung aktivieren» einschalten.`,
      };
    case 'decodingCodecsMissing': {
      const codecs = check.codecs.map((codec) => codecLabel(codec)).join(' und ');
      return {
        title: `${codecs} wird nicht in Hardware dekodiert`,
        detail: `Für ${codecs} ist die Hardware-Dekodierung ausgeschaltet; Jellyfin schaltet ab Werk nur H.264 und VC-1 ein.`,
        action: `Unter ${SETTINGS} bei der Hardware-Dekodierung ${codecs} einschalten, sofern die Grafikeinheit es kann.`,
      };
    }
    case 'hevc10BitDisabled':
      return {
        title: 'HEVC 10 bit wird nicht in Hardware dekodiert',
        detail: '4K- und HDR-Filme sind fast immer HEVC 10 bit; ohne diese Einstellung entpackt sie der Prozessor.',
        action: `Unter ${SETTINGS} «HEVC 10 bit» bei der Hardware-Dekodierung einschalten.`,
      };
    case 'toneMappingDisabled':
      return {
        title: 'Tone-Mapping ausgeschaltet',
        detail: 'HDR-Filme wirken nach dem Transcoding in SDR blass (Dolby Vision oft grün-violett).',
        action: `Unter ${SETTINGS} Tone-Mapping einschalten.`,
      };
    case 'recentErrors':
      return {
        title: `${check.count} von ${check.total} letzten Transcodes mit FFmpeg-Fehlern`,
        detail: 'FFmpeg hat Probleme mit der Hardware oder dem Encoder gemeldet – Details in der Liste unten.',
        action: '«Hardware testen» zeigt, ob die Grafikeinheit grundsätzlich funktioniert.',
      };
    case 'recentSoftware':
      return {
        title: `${check.count} von ${check.total} letzten Transcodes in Software kodiert`,
        detail: 'Obwohl die Hardware-Kodierung eingeschaltet ist, hat Jellyfin dafür einen Software-Encoder genommen.',
        action: 'Jellyfin nimmt den Hardware-Encoder nur, wenn sein FFmpeg ihn beim Start anbietet: Grafiktreiber prüfen, Jellyfin neu starten, «Hardware testen».',
      };
  }
}

export const HARDWARE_TEST_LABELS: Record<HardwareTestId, string> = {
  'encode-h264': 'H.264 kodieren',
  'encode-hevc': 'HEVC kodieren',
  'decode-h264': 'H.264 dekodieren',
  'decode-hevc': 'HEVC dekodieren',
  'decode-hevc10': 'HEVC 10 bit dekodieren',
};
