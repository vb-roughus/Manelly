import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { MediaIndexStatus, MediaSummary, MediaType } from '@manelly/shared';
import { LoaderCircle, RefreshCw, Search, SearchX, SlidersHorizontal, X } from 'lucide-react';
import clsx from 'clsx';
import { ErrorPanel } from '../components/ErrorPanel';
import { FilterPanel, ResetFiltersButton } from '../components/media/FilterPanel';
import { MediaCard } from '../components/media/MediaCard';
import { MediaDetailDialog } from '../components/media/MediaDetailDialog';
import { isConfigured, useMediaFacets, useMediaSearch, useRefreshMedia, useSettings } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { useStickyError } from '../hooks/useStickyError';
import { ApiError } from '../lib/api';
import { formatAgo } from '../lib/format';
import { activeFilterCount, readFilters, SORT_OPTIONS, toSearchParams, type MediaFilters } from '../lib/media';

const TYPES: Array<{ value: MediaType | undefined; label: string }> = [
  { value: undefined, label: 'Alle' },
  { value: 'Movie', label: 'Filme' },
  { value: 'Series', label: 'Serien' },
];

export function MediaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const openItem = searchParams.get('item');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const settings = useSettings();
  const configured = settings.data ? isConfigured(settings.data) : undefined;
  const facets = useMediaFacets(configured === true);
  const search = useMediaSearch(filters, configured === true);
  const searchError = useStickyError(search.error, search.data !== undefined);

  useEffect(() => {
    document.title = 'Medien · Manelly';
  }, []);

  const setFilters = (next: MediaFilters) => {
    const params = toSearchParams(next);
    if (openItem) params.set('item', openItem);
    setSearchParams(params, { replace: true });
  };
  const openDetail = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('item', id);
    setSearchParams(params);
  };
  const closeDetail = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('item');
    setSearchParams(params, { replace: true });
  };

  const index = search.data?.pages[0]?.index ?? facets.data?.index;
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;
  const filterCount = activeFilterCount(filters);
  const sortValue = SORT_OPTIONS.findIndex((option) => option.sort === (filters.sort ?? 'name') && option.order === (filters.order ?? 'asc'));

  if (configured === false) {
    return (
      <PageFrame>
        <ErrorPanel error={settings.error ?? notConfigured} />
      </PageFrame>
    );
  }

  return (
    <PageFrame index={index}>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={filters.q ?? ''} onChange={(q) => setFilters({ ...filters, q: q || undefined })} />
        <div className="flex rounded-lg bg-card p-0.5 shadow-sm ring-1 ring-line" role="group" aria-label="Typ">
          {TYPES.map((type) => (
            <button
              key={type.label}
              type="button"
              aria-pressed={filters.type === type.value}
              onClick={() => setFilters({ ...filters, type: type.value })}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                filters.type === type.value ? 'bg-accent/15 text-ink' : 'text-ink-2 hover:text-ink',
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-line lg:hidden"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filter{filterCount > 0 && ` (${filterCount})`}
        </button>
      </div>

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className={clsx('mb-6 lg:mb-0 lg:block', !filtersOpen && 'hidden')} aria-label="Filter">
          <FilterPanel facets={facets.data?.facets ?? null} filters={filters} onChange={setFilters} />
        </aside>

        <section aria-label="Ergebnisse" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2" aria-live="polite">
              {search.data ? (
                <>
                  <span className="font-semibold text-ink">{total.toLocaleString('de-CH')}</span> {total === 1 ? 'Treffer' : 'Treffer'}
                </>
              ) : (
                ' '
              )}
              {search.isFetching && !search.isFetchingNextPage && <LoaderCircle className="ml-2 inline size-3.5 animate-spin" aria-hidden />}
            </p>
            <div className="flex items-center gap-3">
              {(filterCount > 0 || filters.q || filters.type) && <ResetFiltersButton onClick={() => setFilters({})} />}
              <select
                aria-label="Sortierung"
                value={Math.max(0, sortValue)}
                onChange={(event) => {
                  const { sort, order } = SORT_OPTIONS[Number(event.target.value)]!;
                  // The default (title A–Z) stays out of the URL.
                  const isDefault = sort === 'name' && order === 'asc';
                  setFilters({ ...filters, sort: isDefault ? undefined : sort, order: isDefault ? undefined : order });
                }}
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              >
                {SORT_OPTIONS.map((option, position) => (
                  <option key={option.label} value={position}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Results
            index={index}
            items={items}
            error={search.data ? null : searchError}
            onOpen={openDetail}
            hasFilters={filterCount > 0 || Boolean(filters.q)}
          />

          {search.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium shadow-sm ring-1 ring-line hover:bg-card-2 disabled:cursor-wait"
              >
                {search.isFetchingNextPage && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                Mehr laden ({(total - items.length).toLocaleString('de-CH')} weitere)
              </button>
            </div>
          )}
        </section>
      </div>

      <MediaDetailDialog id={openItem} filters={filters} onClose={closeDetail} />
    </PageFrame>
  );
}

const notConfigured = new ApiError('NOT_CONFIGURED', 'Manelly ist noch nicht mit Jellyfin verbunden.');

function PageFrame({ index, children }: { index?: MediaIndexStatus; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Medien</h1>
          <p className="mt-1 text-sm text-ink-2">Filme und Serien durchsuchen – auch nach Sprache und Format der Tonspuren.</p>
        </div>
        {index && <IndexStatus index={index} />}
      </header>
      {children}
    </div>
  );
}

function IndexStatus({ index }: { index: MediaIndexStatus }) {
  const refresh = useRefreshMedia();
  const now = useNow(30_000);
  const building = index.state === 'building';
  const counts = index.counts;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
      {building && index.progress ? (
        <div className="w-56" role="status">
          <div className="mb-1 flex justify-between">
            <span>Bibliothek wird eingelesen …</span>
            <span className="tabular-nums">
              {index.progress.loaded.toLocaleString('de-CH')} / {index.progress.total.toLocaleString('de-CH')}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent/15">
            <div
              className="bg-brand h-full rounded-full transition-[width]"
              style={{ width: `${index.progress.total ? (index.progress.loaded / index.progress.total) * 100 : 5}%` }}
            />
          </div>
        </div>
      ) : (
        counts && (
          <span title={index.builtAt ? new Date(index.builtAt).toLocaleString('de-CH') : undefined}>
            {counts.movies.toLocaleString('de-CH')} Filme · {counts.series.toLocaleString('de-CH')} Serien ·{' '}
            {counts.episodes.toLocaleString('de-CH')} Folgen
            {index.builtAt && ` · eingelesen ${formatAgo(Date.parse(index.builtAt), now)}`}
          </span>
        )
      )}
      {index.error && !building && (
        <span className="font-medium text-critical" title={index.error}>
          Letztes Einlesen fehlgeschlagen
        </span>
      )}
      <button
        type="button"
        onClick={() => refresh.mutate()}
        disabled={building || refresh.isPending}
        title="Bibliothek neu aus Jellyfin einlesen"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 font-medium whitespace-nowrap text-ink shadow-sm ring-1 ring-line hover:bg-card-2 disabled:opacity-60"
      >
        <RefreshCw className={clsx('size-3.5', building && 'animate-spin')} aria-hidden />
        Neu einlesen
      </button>
    </div>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  // The page re-renders while polling; a ref keeps that from restarting the timer below.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => setText(value), [value]);
  // Update the URL (and thus the search) once typing pauses.
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = window.setTimeout(() => onChangeRef.current(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text, value]);

  return (
    <label className="relative min-w-[12rem] flex-1">
      <span className="sr-only">Titel suchen</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Titel suchen …"
        className="block w-full rounded-lg border border-line bg-card py-2 pr-9 pl-9 text-sm shadow-sm outline-none placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          onClick={() => setText('')}
          aria-label="Suche leeren"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </label>
  );
}

interface ResultsProps {
  index: MediaIndexStatus | undefined;
  items: MediaSummary[];
  error: Error | null;
  onOpen: (id: string) => void;
  hasFilters: boolean;
}

function Results({ index, items, error, onOpen, hasFilters }: ResultsProps) {
  if (error) return <ErrorPanel error={error} />;
  if (!index || (index.state === 'building' && !index.counts)) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
        <LoaderCircle className="mx-auto size-8 animate-spin text-accent" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold">Bibliothek wird eingelesen</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
          Manelly liest einmal alle Filme, Serien und Folgen samt Tonspuren aus Jellyfin. Danach ist die Suche sofort da und
          wird alle 15 Minuten im Hintergrund aufgefrischt.
        </p>
      </div>
    );
  }
  if (index.state === 'error' && !index.counts) {
    return <ErrorPanel error={new Error(`Die Bibliothek konnte nicht eingelesen werden: ${index.error}`)} />;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
        <SearchX className="mx-auto size-8 text-ink-3" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold">Nichts gefunden</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
          {hasFilters ? 'Kein Titel erfüllt alle gewählten Filter.' : 'In deinen Jellyfin-Bibliotheken gibt es noch keine Filme oder Serien.'}
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} onOpen={() => onOpen(item.id)} />
      ))}
    </div>
  );
}
