/** The languages the agent can put first in MKV files, as the agent stores them (ISO 639-2/B). */
export const AUDIO_LANGUAGES = [
  { code: 'ger', bcp47: 'de', label: 'Deutsch', adjective: 'deutsche' },
  { code: 'eng', bcp47: 'en', label: 'Englisch', adjective: 'englische' },
  { code: 'fre', bcp47: 'fr', label: 'Französisch', adjective: 'französische' },
  { code: 'ita', bcp47: 'it', label: 'Italienisch', adjective: 'italienische' },
  { code: 'spa', bcp47: 'es', label: 'Spanisch', adjective: 'spanische' },
] as const;

const byCode = (code: string | null | undefined) => AUDIO_LANGUAGES.find((language) => language.code === code);

/** «Deutsch» for ger; the code itself for one Manelly does not know. */
export const audioLanguageLabel = (code: string | null | undefined): string => byCode(code)?.label ?? code ?? '–';

/** «deutsche» for ger, as in «die deutsche Tonspur». */
export const audioLanguageAdjective = (code: string | null | undefined): string => byCode(code)?.adjective ?? `«${code ?? '?'}»-`;

/**
 * Whether the agent would change these tracks (in file order, languages as BCP 47 from the index): the first track
 * in the language is not the only default – or, with `first`, not the first track. Without such a track, nothing to do.
 */
export function needsPreferredAudio(tracks: Array<{ language: string | null; isDefault: boolean }>, code: string, first: boolean): boolean {
  const wanted = byCode(code)?.bcp47 ?? code;
  const index = tracks.findIndex((track) => track.language?.toLowerCase().split('-')[0] === wanted);
  if (index < 0) return false;
  if (!tracks[index]!.isDefault || tracks.some((track, other) => other !== index && track.isDefault)) return true;
  return first && index > 0;
}
