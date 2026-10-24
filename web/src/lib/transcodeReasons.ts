// Human-readable explanations for Jellyfin's TranscodeReason values.
// The client's device profile decides what it can play; each reason names
// the property of the source file that the client rejected.

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
    hint: 'Der Client unterstützt das HDR-Format (z. B. Dolby Vision) nicht; es wird Tone-Mapping nötig.',
  },
  VideoCodecTagNotSupported: { label: 'Codec-Tag nicht unterstützt', hint: 'Der Codec-Tag (z. B. hev1 statt hvc1) wird vom Client nicht akzeptiert.' },
  StreamCountExceedsLimit: { label: 'Zu viele Spuren', hint: 'Die Datei enthält mehr Spuren, als der Client verarbeiten kann.' },
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
