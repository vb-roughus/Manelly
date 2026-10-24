import { useEffect, useState, type ReactNode } from 'react';
import type { AudioFormat, MediaFacets } from '@manelly/shared';
import { AudioLines, RotateCcw, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import {
  AUDIO_FORMAT_LABELS,
  AUDIO_FORMAT_ORDER,
  DYNAMIC_RANGE_LABELS,
  RESOLUTION_ORDER,
  audioLanguageName,
  hasAudioCondition,
  type MediaFilters,
} from '../../lib/media';
import { ChipGroup } from './ChipGroup';

interface FilterPanelProps {
  facets: MediaFacets | null;
  filters: MediaFilters;
  onChange: (next: MediaFilters) => void;
}

const AUDIO_KEYS = ['audioLanguage', 'audioFormat', 'audioMinChannels', 'audioMode', 'audioCoverage'] as const;

const AUDIO_PRESETS: Array<{ label: string; hint: string; filters: Partial<MediaFilters> }> = [
  {
    label: 'Deutsch in Dolby Atmos',
    hint: 'Titel mit einer deutschen Tonspur in Dolby Atmos (TrueHD oder Dolby Digital Plus)',
    filters: { audioLanguage: ['de'], audioFormat: ['atmos'] },
  },
  {
    label: 'Ohne deutsche Tonspur',
    hint: 'Titel, denen eine deutsche Tonspur fehlt (bei Serien: in mindestens einer Folge)',
    filters: { audioLanguage: ['de'], audioMode: 'lacks' },
  },
];

export function FilterPanel({ facets, filters, onChange }: FilterPanelProps) {
  const update = (patch: Partial<MediaFilters>) => onChange({ ...filters, ...patch });
  const facetOptions = (values: MediaFacets['genres'] | undefined, label: (value: string) => string = (value) => value) =>
    (values ?? []).map((facet) => ({ value: facet.value, label: label(facet.value), count: facet.count }));

  const resolutions = [...(facets?.resolutions ?? [])].sort(
    (a, b) => RESOLUTION_ORDER.indexOf(a.value as never) - RESOLUTION_ORDER.indexOf(b.value as never),
  );

  return (
    <div className="space-y-6">
      <AudioFilter facets={facets} filters={filters} onChange={onChange} />

      <Section title="Genre">
        <ChipGroup options={facetOptions(facets?.genres)} selected={filters.genre ?? []} onChange={(genre) => update({ genre })} initialVisible={10} />
      </Section>

      <Section title="Erscheinungsjahr">
        <YearRange
          from={filters.yearFrom}
          to={filters.yearTo}
          min={facets?.years.min ?? null}
          max={facets?.years.max ?? null}
          onChange={(yearFrom, yearTo) => update({ yearFrom, yearTo })}
        />
      </Section>

      <Section title="Bewertung">
        <select
          value={filters.minRating ?? ''}
          onChange={(event) => update({ minRating: event.target.value ? Number(event.target.value) : undefined })}
          className={selectClass}
        >
          <option value="">Beliebig</option>
          {[5, 6, 7, 8, 9].map((rating) => (
            <option key={rating} value={rating}>
              ab {rating},0 Sternen
            </option>
          ))}
        </select>
      </Section>

      {(facets?.officialRatings.length ?? 0) > 0 && (
        <Section title="Altersfreigabe">
          <ChipGroup
            options={facetOptions(facets?.officialRatings)}
            selected={filters.officialRating ?? []}
            onChange={(officialRating) => update({ officialRating })}
            initialVisible={8}
          />
        </Section>
      )}

      <Section title="Auflösung">
        <ChipGroup options={facetOptions(resolutions)} selected={filters.resolution ?? []} onChange={(value) => update({ resolution: value as MediaFilters['resolution'] })} />
      </Section>

      <Section title="Dynamikumfang">
        <ChipGroup
          options={facetOptions(facets?.dynamicRanges, (value) => DYNAMIC_RANGE_LABELS[value as keyof typeof DYNAMIC_RANGE_LABELS] ?? value)}
          selected={filters.dynamicRange ?? []}
          onChange={(value) => update({ dynamicRange: value as MediaFilters['dynamicRange'] })}
        />
      </Section>

      {(facets?.libraries.length ?? 0) > 1 && (
        <Section title="Bibliothek">
          <ChipGroup
            options={(facets?.libraries ?? []).map((library) => ({ value: library.value, label: library.name, count: library.count }))}
            selected={filters.library ?? []}
            onChange={(library) => update({ library })}
          />
        </Section>
      )}
    </div>
  );
}

function AudioFilter({ facets, filters, onChange }: FilterPanelProps) {
  const active = hasAudioCondition(filters);
  const update = (patch: Partial<MediaFilters>) => onChange({ ...filters, ...patch });
  const clearAudio = () => onChange(Object.fromEntries(Object.entries(filters).filter(([key]) => !(AUDIO_KEYS as readonly string[]).includes(key))));
  const applyPreset = (preset: Partial<MediaFilters>) => {
    const base = Object.fromEntries(Object.entries(filters).filter(([key]) => !(AUDIO_KEYS as readonly string[]).includes(key)));
    onChange({ ...base, ...preset });
  };
  const presetActive = (preset: Partial<MediaFilters>) =>
    AUDIO_KEYS.every((key) => JSON.stringify(filters[key] ?? null) === JSON.stringify(preset[key] ?? null));

  const formats = [...(facets?.audioFormats ?? [])]
    .sort((a, b) => AUDIO_FORMAT_ORDER.indexOf(a.value as AudioFormat) - AUDIO_FORMAT_ORDER.indexOf(b.value as AudioFormat))
    .map((facet) => ({ value: facet.value, label: AUDIO_FORMAT_LABELS[facet.value as AudioFormat] ?? facet.value, count: facet.count }));

  return (
    <section aria-labelledby="audio-filter-heading" className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="audio-filter-heading" className="flex items-center gap-2 text-sm font-semibold">
          <AudioLines className="size-4 text-accent" aria-hidden />
          Tonspur
        </h2>
        {active && (
          <button type="button" onClick={clearAudio} className="text-xs font-medium text-accent hover:underline">
            Entfernen
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {AUDIO_PRESETS.map((preset) => {
          const on = presetActive(preset.filters);
          return (
            <button
              key={preset.label}
              type="button"
              title={preset.hint}
              aria-pressed={on}
              onClick={() => (on ? clearAudio() : applyPreset(preset.filters))}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ring-inset',
                on ? 'bg-brand text-white ring-transparent' : 'bg-card text-ink ring-line hover:ring-accent/50',
              )}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Sprache">
          <select
            value={filters.audioLanguage?.[0] ?? ''}
            onChange={(event) => update({ audioLanguage: event.target.value ? [event.target.value] : undefined })}
            className={selectClass}
          >
            <option value="">Beliebig</option>
            {(facets?.audioLanguages ?? []).map((facet) => (
              <option key={facet.value} value={facet.value}>
                {audioLanguageName(facet.value)} ({facet.count.toLocaleString('de-CH')})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Format">
          <ChipGroup
            options={formats}
            selected={filters.audioFormat ?? []}
            onChange={(value) => update({ audioFormat: value.length ? (value as AudioFormat[]) : undefined })}
            initialVisible={6}
          />
        </Field>

        <Field label="Kanäle">
          <select
            value={filters.audioMinChannels ?? ''}
            onChange={(event) => update({ audioMinChannels: event.target.value ? Number(event.target.value) : undefined })}
            className={selectClass}
          >
            <option value="">Beliebig</option>
            <option value="2">mindestens Stereo</option>
            <option value="6">mindestens 5.1</option>
            <option value="8">mindestens 7.1</option>
          </select>
        </Field>

        <div className={clsx('space-y-2', !active && 'pointer-events-none opacity-50')} aria-disabled={!active}>
          <div className="grid grid-cols-2 rounded-lg bg-card p-0.5 ring-1 ring-line" role="group" aria-label="Tonspur vorhanden oder fehlend">
            {(['has', 'lacks'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!active}
                aria-pressed={(filters.audioMode ?? 'has') === mode}
                onClick={() => update({ audioMode: mode === 'has' ? undefined : mode })}
                className={clsx(
                  'rounded-md px-2 py-1 text-xs font-medium transition',
                  (filters.audioMode ?? 'has') === mode ? 'bg-accent/15 text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                {mode === 'has' ? 'Vorhanden' : 'Fehlt'}
              </button>
            ))}
          </div>
          <label className={clsx('flex items-center gap-2 text-xs text-ink-2', filters.type === 'Movie' && 'opacity-50')}>
            <input
              type="checkbox"
              disabled={!active || filters.type === 'Movie'}
              checked={filters.audioCoverage === 'all'}
              onChange={(event) => update({ audioCoverage: event.target.checked ? 'all' : undefined })}
              className="size-3.5 accent-[var(--accent)]"
            />
            Serien: in allen Folgen
          </label>
        </div>

        <p className="text-[0.6875rem] leading-relaxed text-ink-3">
          Sprache, Format und Kanäle müssen auf derselben Tonspur zutreffen. Atmos erkennt Jellyfin am Codec-Profil – fehlt
          es, hilft ein neuer Medien-Scan in Jellyfin.
        </p>
      </div>
    </section>
  );
}

function YearRange(props: { from?: number; to?: number; min: number | null; max: number | null; onChange: (from?: number, to?: number) => void }) {
  const [from, setFrom] = useState(props.from?.toString() ?? '');
  const [to, setTo] = useState(props.to?.toString() ?? '');
  // Follow outside changes, e.g. "Alle Filter zurücksetzen".
  useEffect(() => setFrom(props.from?.toString() ?? ''), [props.from]);
  useEffect(() => setTo(props.to?.toString() ?? ''), [props.to]);

  const commit = () => {
    const parse = (value: string) => (/^\d{4}$/.test(value) ? Number(value) : undefined);
    props.onChange(parse(from), parse(to));
  };

  const input = (value: string, set: (value: string) => void, placeholder: number | null, label: string) => (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder?.toString() ?? ''}
      value={value}
      onChange={(event) => set(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
      className={`${selectClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
    />
  );

  return (
    <div className="flex items-center gap-2">
      {input(from, setFrom, props.min, 'Jahr von')}
      <span className="text-ink-3">–</span>
      {input(to, setTo, props.max, 'Jahr bis')}
    </div>
  );
}

const selectClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-ink-2">{label}</div>
      {children}
    </div>
  );
}

export function ResetFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
      <RotateCcw className="size-3.5" aria-hidden />
      Alle Filter zurücksetzen
    </button>
  );
}
