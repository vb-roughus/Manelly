// Human-readable explanations for Jellyfin's TranscodeReason values.
// The client's device profile decides what it can play; each reason names
// the property of the source file that the client rejected.
import type { StreamSession } from '@manelly/shared';
import { channelsLabel, codecLabel, formatBitrate, videoRangeLabel } from './format';

interface ReasonText {
  label: string;
  hint: string;
}

const REASONS: Record<string, ReasonText> = {
  ContainerNotSupported: {
    label: 'Container nicht unterstützt',
    hint: 'Der Client kann das Dateiformat (z. B. MKV) nicht öffnen. Meist wird nur remuxt.',
  },
  VideoCodecNotSupported: {
    label: 'Video-Codec nicht unterstützt',
    hint: 'Der Client kann den Video-Codec (z. B. HEVC oder AV1) nicht dekodieren.',
  },
  AudioCodecNotSupported: {
    label: 'Audio-Codec nicht unterstützt',
    hint: 'Der Client kann die Tonspur (z. B. DTS oder TrueHD) nicht abspielen.',
  },
  SubtitleCodecNotSupported: {
    label: 'Untertitel werden eingebrannt',
    hint: 'Bildbasierte Untertitel (PGS, VobSub) muss der Server ins Video einbrennen. Textuntertitel (SRT) vermeiden das.',
  },
  AudioIsExternal: { label: 'Externe Tonspur', hint: 'Die Tonspur liegt als separate Datei vor.' },
  SecondaryAudioNotSupported: {
    label: 'Zweite Tonspur nicht unterstützt',
    hint: 'Der Client kann nur die erste Tonspur einer Datei abspielen.',
  },
  VideoProfileNotSupported: {
    label: 'Video-Profil nicht unterstützt',
    hint: 'Das Codec-Profil (z. B. Main 10) übersteigt die Fähigkeiten des Clients.',
  },
  VideoLevelNotSupported: { label: 'Video-Level nicht unterstützt', hint: 'Das Codec-Level ist für den Client zu hoch.' },
  VideoResolutionNotSupported: {
    label: 'Auflösung zu hoch',
    hint: 'Der Client unterstützt die Auflösung des Videos nicht.',
  },
  VideoBitDepthNotSupported: {
    label: 'Farbtiefe nicht unterstützt',
    hint: 'Der Client kann z. B. 10-Bit-Video nicht darstellen.',
  },
  VideoFramerateNotSupported: { label: 'Bildrate nicht unterstützt', hint: 'Die Bildrate ist für den Client zu hoch.' },
  RefFramesNotSupported: {
    label: 'Zu viele Referenzbilder',
    hint: 'Das Video nutzt mehr Referenzbilder, als der Client verarbeiten kann.',
  },
  AnamorphicVideoNotSupported: {
    label: 'Anamorphes Video',
    hint: 'Der Client kann anamorphe Pixelseitenverhältnisse nicht darstellen.',
  },
  InterlacedVideoNotSupported: {
    label: 'Interlaced-Video',
    hint: 'Das Video ist im Zeilensprungverfahren codiert und muss deinterlaced werden.',
  },
  AudioChannelsNotSupported: {
    label: 'Zu viele Audiokanäle',
    hint: 'Der Client unterstützt die Anzahl Kanäle (z. B. 5.1) nicht und erhält einen Downmix.',
  },
  AudioProfileNotSupported: { label: 'Audio-Profil nicht unterstützt', hint: 'Das Audio-Profil wird vom Client nicht unterstützt.' },
  AudioSampleRateNotSupported: { label: 'Abtastrate nicht unterstützt', hint: 'Die Audio-Abtastrate wird vom Client nicht unterstützt.' },
  AudioBitDepthNotSupported: { label: 'Audio-Bittiefe nicht unterstützt', hint: 'Die Audio-Bittiefe wird vom Client nicht unterstützt.' },
  ContainerBitrateExceedsLimit: {
    label: 'Bitrate über dem Limit',
    hint: 'Die Datei überschreitet das Bitraten-Limit des Clients oder des Benutzers. Prüfe die Qualitätseinstellung im Client und die Fernzugriff-Limits in Jellyfin.',
  },
  VideoBitrateNotSupported: { label: 'Video-Bitrate zu hoch', hint: 'Die Video-Bitrate übersteigt das Limit des Clients.' },
  AudioBitrateNotSupported: { label: 'Audio-Bitrate zu hoch', hint: 'Die Audio-Bitrate übersteigt das Limit des Clients.' },
  UnknownVideoStreamInfo: {
    label: 'Unbekannte Videodaten',
    hint: 'Jellyfin kennt die Video-Eigenschaften nicht. Ein Medien-Scan kann helfen.',
  },
  UnknownAudioStreamInfo: {
    label: 'Unbekannte Audiodaten',
    hint: 'Jellyfin kennt die Audio-Eigenschaften nicht. Ein Medien-Scan kann helfen.',
  },
  DirectPlayError: {
    label: 'Direct Play fehlgeschlagen',
    hint: 'Der Client konnte die Datei nicht direkt abspielen und ist auf Transcoding ausgewichen.',
  },
  VideoRangeTypeNotSupported: {
    label: 'HDR-Format nicht unterstützt',
    hint: 'Der Client unterstützt das HDR-Format (z. B. Dolby Vision) nicht. Je nach Format schickt Jellyfin eine Rückfallebene wie HDR10 oder wandelt das Video um.',
  },
  VideoCodecTagNotSupported: { label: 'Codec-Tag nicht unterstützt', hint: 'Der Codec-Tag (z. B. hev1 statt hvc1) wird vom Client nicht akzeptiert.' },
  StreamCountExceedsLimit: { label: 'Zu viele Spuren', hint: 'Die Datei enthält mehr Spuren, als der Client verarbeiten kann.' },
  VideoRotationNotSupported: {
    label: 'Gedrehtes Video',
    hint: 'Das Video ist gedreht gespeichert (z. B. eine Handy-Aufnahme), und der Client kann die Drehung nicht selbst anwenden.',
  },
};

export function describeTranscodeReason(reason: string): ReasonText {
  return (
    REASONS[reason] ?? {
      // Unknown future reasons: "SomeNewReason" → "Some new reason".
      label: reason.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()),
      hint: reason,
    }
  );
}

const AUDIO_REASONS = new Set([
  'AudioCodecNotSupported',
  'AudioChannelsNotSupported',
  'AudioProfileNotSupported',
  'AudioSampleRateNotSupported',
  'AudioBitDepthNotSupported',
  'AudioBitrateNotSupported',
  'AudioIsExternal',
  'SecondaryAudioNotSupported',
  'UnknownAudioStreamInfo',
]);

/** A reason, explained for the stream at hand. */
export interface ReasonDetails {
  label: string;
  /** What this file has that the client rejects, e.g. "Dolby Vision Profil 7 …". */
  facts: string | null;
  /** What the reason means in general. */
  explanation: string;
  /** What Jellyfin does about it in this stream. */
  outcome: string | null;
  tip: string | null;
}

const number = (value: number, digits = 0) => value.toLocaleString('de-CH', { maximumFractionDigits: digits });

/** ffprobe reports HEVC levels times 30 (153 = 5.1) and H.264 levels times 10 (41 = 4.1). */
function levelLabel(codec: string | null, level: number): string {
  if (codec === 'hevc') return number(level / 30, 1);
  if (codec === 'h264') return number(level / 10, 1);
  return String(level);
}

function sourceFacts(reason: string, { source }: StreamSession): string | null {
  const { video, audio, subtitle } = source;
  const sum = (video?.bitrate ?? 0) + (audio?.bitrate ?? 0);
  switch (reason) {
    case 'ContainerNotSupported':
      return source.container ? `Container ${source.container.toUpperCase()}` : null;
    case 'VideoCodecNotSupported':
      return video?.codec ? `Video-Codec ${codecLabel(video.codec)}${video.profile ? ` (${video.profile})` : ''}` : null;
    case 'VideoProfileNotSupported':
      return video?.profile ? `Profil ${video.profile}` : null;
    case 'VideoLevelNotSupported':
      return video?.level ? `Level ${levelLabel(video.codec, video.level)}` : null;
    case 'VideoResolutionNotSupported':
      return video?.width && video.height ? `${video.width}×${video.height} Pixel` : null;
    case 'VideoBitDepthNotSupported':
      return video?.bitDepth ? `${video.bitDepth} bit Farbtiefe` : null;
    case 'VideoFramerateNotSupported':
      return video?.frameRate ? `${number(video.frameRate, 3)} Bilder/s` : null;
    case 'RefFramesNotSupported':
      return video?.refFrames ? `${video.refFrames} Referenzbilder` : null;
    case 'InterlacedVideoNotSupported':
      return video?.isInterlaced ? 'Video im Zeilensprungverfahren (interlaced)' : null;
    case 'VideoRangeTypeNotSupported': {
      const range = video ? videoRangeLabel(video, 'long') : null;
      return range ? `${range} (${video!.videoRangeType})` : null;
    }
    case 'VideoCodecTagNotSupported':
      return video?.codecTag ? `Codec-Tag ${video.codecTag}` : null;
    case 'VideoBitrateNotSupported':
      return video?.bitrate ? `Video-Bitrate ${formatBitrate(video.bitrate)}` : null;
    case 'ContainerBitrateExceedsLimit':
      return sum ? `Bitrate ${formatBitrate(sum)}` : null;
    case 'AudioCodecNotSupported':
      return audio?.codec ? `Tonspur ${codecLabel(audio.codec)}${audio.profile ? ` (${audio.profile})` : ''}` : null;
    case 'AudioChannelsNotSupported':
      return audio?.channels ? `Tonspur mit ${channelsLabel(audio.channels)}` : null;
    case 'AudioProfileNotSupported':
      return audio?.profile ? `Audio-Profil ${audio.profile}` : null;
    case 'AudioSampleRateNotSupported':
      return audio?.sampleRate ? `Abtastrate ${number(audio.sampleRate / 1000, 1)} kHz` : null;
    case 'AudioBitDepthNotSupported':
      return audio?.bitDepth ? `Audio mit ${audio.bitDepth} bit` : null;
    case 'AudioBitrateNotSupported':
      return audio?.bitrate ? `Audio-Bitrate ${formatBitrate(audio.bitrate)}` : null;
    case 'SubtitleCodecNotSupported':
      return subtitle?.codec ? `Untertitel ${codecLabel(subtitle.codec)}` : null;
    default:
      return null;
  }
}

// Dolby Vision variants and the base layer an HDR10/HLG/SDR player gets instead.
const DOVI_BASE: Record<string, string> = {
  DOVIWithHDR10: 'HDR10',
  DOVIWithEL: 'HDR10',
  DOVIWithHDR10Plus: 'HDR10',
  DOVIWithELHDR10Plus: 'HDR10',
  DOVIWithHLG: 'HLG',
  DOVIWithSDR: 'SDR',
};

function rangeOutcome(session: StreamSession): { outcome: string | null; tip: string | null } {
  const type = session.source.video?.videoRangeType ?? '';
  const copied = session.transcoding?.isVideoDirect ?? false;
  const base = DOVI_BASE[type] ?? (type === 'HDR10Plus' ? 'HDR10' : null);
  let outcome: string | null = null;
  if (copied && base) {
    const removed = type === 'HDR10Plus' ? 'die HDR10+-Metadaten' : 'die Dolby-Vision-Daten';
    outcome = `Jellyfin entfernt deshalb ${removed} und schickt die ${base}-Basis. Das Video wird dabei nur umgepackt, nicht neu kodiert – das Gerät zeigt ${base} statt ${type === 'HDR10Plus' ? 'HDR10+' : 'Dolby Vision'}.`;
  } else if (copied) {
    outcome = 'Das Video wird trotzdem nur umgepackt, nicht neu kodiert.';
  } else if (session.transcoding) {
    outcome = 'Jellyfin kodiert das Video deshalb neu – bei der Umwandlung in SDR mit Tone-Mapping, sofern es eingeschaltet ist.';
  }
  const tip = type.startsWith('DOVIWithEL')
    ? 'Viele Geräte spielen Dolby Vision Profil 8.1, aber nicht Profil 7. Mit dovi_tool lässt sich die Datei in Profil 8.1 umwandeln (der Enhancement Layer fällt dabei weg); dann kann sie direkt abgespielt werden.'
    : type === 'DOVI'
      ? 'Profil 5 hat keine HDR10-Basis: Geräte ohne Dolby Vision zeigen es nur mit Tone-Mapping richtig an.'
      : null;
  return { outcome, tip };
}

/** Explains a transcode reason with the properties of the file that is playing. */
export function explainReason(reason: string, session: StreamSession): ReasonDetails {
  const { label, hint } = describeTranscodeReason(reason);
  const details: ReasonDetails = { label, facts: sourceFacts(reason, session), explanation: hint, outcome: null, tip: null };
  if (reason === 'VideoRangeTypeNotSupported') Object.assign(details, rangeOutcome(session));
  if (reason === 'ContainerBitrateExceedsLimit' && session.transcoding?.bitrate) {
    details.outcome = `Jellyfin schickt deshalb ${formatBitrate(session.transcoding.bitrate)}.`;
  }
  return details;
}

/**
 * Jellyfin often converts the audio without naming a reason for it: the
 * stream has to be repackaged (e.g. into TS for HLS) for another reason, and
 * the client does not accept the original audio codec in that container.
 */
export function explainAudioConversion(session: StreamSession): ReasonDetails | null {
  const { transcoding, source } = session;
  const audio = source.audio;
  if (!transcoding || transcoding.isAudioDirect || !audio || transcoding.reasons.some((reason) => AUDIO_REASONS.has(reason))) {
    return null;
  }
  const from = [codecLabel(audio.codec), channelsLabel(audio.channels)].filter(Boolean).join(' ');
  const to = [codecLabel(transcoding.audioCodec), channelsLabel(transcoding.audioChannels)].filter(Boolean).join(' ');
  const original = codecLabel(audio.codec) ?? 'die Tonspur';
  const target = codecLabel(transcoding.audioCodec) ?? 'ein anderes Format';
  const container = transcoding.container && transcoding.container !== source.container ? transcoding.container.toUpperCase() : null;

  const into = container ? `in einen Streaming-Container (${container}) ` : '';
  const cause = transcoding.reasons.length
    ? `Weil die Datei nicht direkt abgespielt werden kann, packt Jellyfin sie ${into}um`
    : `Für die Wiedergabe packt Jellyfin die Datei ${into}um`;
  const explanation =
    `Für den Ton nennt Jellyfin keinen eigenen Grund – die Umwandlung ist eine Folge. ${cause}, und darin nimmt der ` +
    `Client ${original} nicht an. Also wird der Ton in ${target} umgewandelt.`;
  const fewerChannels = audio.channels && transcoding.audioChannels && transcoding.audioChannels < audio.channels;
  const outcome = fewerChannels
    ? `Statt ${channelsLabel(audio.channels)} gibt es ${channelsLabel(transcoding.audioChannels)}: So viele Kanäle hat der Client für umgewandelten Ton höchstens angefordert.`
    : null;
  const androidTv = /android tv/i.test(session.client) ? ' (in Jellyfin Android TV muss dafür die Bitstream-Ausgabe für AC3/E-AC3 aktiv sein)' : '';
  const tip =
    `Im Client eine Tonspur wählen, die er im Stream annimmt, meist AC3 oder E-AC3${androidTv}. Oder den Grund oben ` +
    `beheben: Läuft die Datei direkt, geht auch der Ton unverändert durch, sofern das Gerät ${original} kann.`;
  return { label: `Warum ${from} → ${to}?`, facts: null, explanation, outcome, tip };
}
