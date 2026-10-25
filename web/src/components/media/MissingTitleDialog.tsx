import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { TitleDiagnosis } from '@manelly/shared';
import { CircleCheck, ExternalLink, Info, LoaderCircle, Search, SearchCheck, TriangleAlert, X } from 'lucide-react';
import { useMediaDiagnosis, useRefreshMedia, useServerStatus } from '../../hooks/queries';
import { FILTER_LABELS, ITEM_TYPE_LABELS, LIBRARY_TYPE_LABELS, type MediaFilters } from '../../lib/media';

interface MissingTitleDialogProps {
  open: boolean;
  onClose: () => void;
  filters: MediaFilters;
  onResetFilters: () => void;
  onShow: (id: string) => void;
}

/** Looks a title up in Jellyfin and explains why it is (not) in the media search. */
export function MissingTitleDialog({ open, onClose, ...props }: MissingTitleDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && onClose()}
      aria-labelledby="missing-title-heading"
      className="m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {open && <DialogBody onClose={onClose} {...props} />}
    </dialog>
  );
}

function DialogBody({ onClose, filters, onResetFilters, onShow }: Omit<MissingTitleDialogProps, 'open'>) {
  const [text, setText] = useState(filters.q ?? '');
  const [title, setTitle] = useState(filters.q ?? '');
  const diagnosis = useMediaDiagnosis(title, filters);
  const refresh = useRefreshMedia();
  const { data: server } = useServerStatus();
  const index = diagnosis.data?.index;
  // The index version "Neu einlesen" was clicked on; once a newer one is ready, the refresh is done.
  const [refreshedFrom, setRefreshedFrom] = useState<string | null>();
  const refreshed = refreshedFrom !== undefined && index?.state === 'ready' && index.builtAt !== refreshedFrom;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTitle(text.trim());
    setRefreshedFrom(undefined);
  }

  const actions = {
    show: (id: string) => {
      onClose();
      onShow(id);
    },
    resetFilters: onResetFilters,
    refresh: () => {
      setRefreshedFrom(index?.builtAt ?? null);
      refresh.mutate();
    },
    refreshing: refresh.isPending || index?.state === 'building',
    refreshed,
    progress: index?.state === 'building' ? index.progress : null,
    jellyfinLink: (id: string) => (server ? `${server.url}/web/#/details?id=${id}&serverId=${server.id}` : null),
  };

  return (
    <div className="p-6">
      <div className="mb-3 flex items-start justify-between gap-4">
        <h2 id="missing-title-heading" className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
            <SearchCheck className="size-4" aria-hidden />
          </span>
          Warum fehlt ein Titel?
        </h2>
        <button type="button" onClick={onClose} aria-label="Schliessen" className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-card-2 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-sm text-ink-2">
        Manelly sucht den Titel direkt in Jellyfin und prüft, ob er im Medien-Index ist und ob die aktiven Filter ihn
        ausblenden.
      </p>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Titel</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Titel, wie er in Jellyfin heisst"
            className="block w-full rounded-lg border border-line bg-card py-2 pr-3 pl-9 text-sm outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
          />
        </label>
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-brand rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          Prüfen
        </button>
      </form>

      <div className="mt-5 space-y-3" aria-live="polite">
        {index?.error && (
          <Message tone="critical">
            <b>Das letzte Einlesen ist fehlgeschlagen</b> – Manelly zeigt noch den Stand davor. {index.error}
          </Message>
        )}
        {diagnosis.isFetching && !diagnosis.data && (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Frage Jellyfin …
          </p>
        )}
        {diagnosis.error && <Message tone="critical">{diagnosis.error.message}</Message>}
        {diagnosis.data && diagnosis.data.results.length === 0 && (
          <Message tone="info">
            Auch Jellyfin findet zu «{diagnosis.data.title}» keinen Film und keine Serie. Prüfe die Schreibweise – gesucht
            wird mit Jellyfins eigener Suche.
          </Message>
        )}
        {diagnosis.data?.results.map((result) => (
          <ResultCard key={result.id} result={result} actions={actions} />
        ))}
      </div>
    </div>
  );
}

interface Actions {
  show: (id: string) => void;
  resetFilters: () => void;
  refresh: () => void;
  refreshing: boolean;
  /** "Neu einlesen" was clicked in this dialog and the new index is ready. */
  refreshed: boolean;
  progress: { loaded: number; total: number } | null;
  jellyfinLink: (id: string) => string | null;
}

function ResultCard({ result, actions }: { result: TitleDiagnosis; actions: Actions }) {
  const library = result.library;
  const libraryText = library
    ? `Bibliothek «${library.name}» (${LIBRARY_TYPE_LABELS[library.collectionType ?? 'mixed'] ?? library.collectionType})`
    : 'keine Bibliothek';
  const link = actions.jellyfinLink(result.id);
  const { tone, text, action, details } = explain(result, libraryText, actions);

  return (
    <article className="rounded-xl p-4 ring-1 ring-line">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          {result.name}
          {result.year && <span className="font-normal text-ink-2"> ({result.year})</span>}
        </h3>
        <span className="text-xs text-ink-2">
          {ITEM_TYPE_LABELS[result.type] ?? result.type} · {libraryText}
        </span>
      </header>
      <div className="mt-3">
        <Message tone={tone}>{text}</Message>
      </div>
      {result.dateCreatedInFuture && result.dateCreated && (
        <p className="mt-2 text-xs text-ink-2">
          Jellyfin meldet als «hinzugefügt» den {formatDate(result.dateCreated)} – das liegt in der Zukunft. Vermutlich stimmt
          die Uhrzeit oder Zeitzone des Jellyfin-Servers nicht, oder Jellyfin hat ein falsches Dateidatum übernommen. In Jellyfin
          kann das die Sortierung «Zuletzt hinzugefügt» durcheinanderbringen; für Manelly spielt es keine Rolle.
        </p>
      )}
      {result.incompleteMedia && (
        <p className="mt-2 text-xs text-ink-2">
          Jellyfin konnte die Medieninfos dieses Titels nicht liefern – er steht ohne Tonspuren im Index und fehlt deshalb bei
          Tonspur- und Video-Filtern.
        </p>
      )}
      {(action || link) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {action}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}>
              In Jellyfin öffnen <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      )}
      {details && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-card-2 p-3 text-xs">
          <dt className="text-ink-3">ID</dt>
          <dd className="font-mono break-all">{result.id}</dd>
          <dt className="text-ink-3">Pfad</dt>
          <dd className="font-mono break-all">{result.path ?? '–'}</dd>
          <dt className="text-ink-3">Hinzugefügt</dt>
          <dd>{result.dateCreated ? formatDate(result.dateCreated) : '–'}</dd>
          {result.listing && (
            <>
              <dt className="text-ink-3">Bibliothek liefert</dt>
              <dd>{countOf(result.listing.libraryTotal, result.type)}</dd>
            </>
          )}
        </dl>
      )}
    </article>
  );
}

interface Explanation {
  tone: Tone;
  text: ReactNode;
  action?: ReactNode;
  /** Show ID, path and the like, e.g. to look into it in Jellyfin or to report a bug. */
  details?: boolean;
}

function explain(result: TitleDiagnosis, libraryText: string, actions: Actions): Explanation {
  const progress = actions.progress?.total ? ` ${Math.round((actions.progress.loaded / actions.progress.total) * 100)} %` : '';
  const refreshButton = (
    <button type="button" onClick={actions.refresh} disabled={actions.refreshing} className={primaryButton}>
      {actions.refreshing && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {actions.refreshing ? `Wird eingelesen …${progress}` : 'Neu einlesen'}
    </button>
  );

  switch (result.verdict) {
    case 'visible':
      return {
        tone: 'good',
        text: 'Der Titel ist im Index und erscheint mit den aktuellen Filtern in der Suche.',
        action: (
          <button type="button" onClick={() => actions.show(result.id)} className={primaryButton}>
            Anzeigen
          </button>
        ),
      };
    case 'filtered':
      return {
        tone: 'info',
        text: (
          <>
            Der Titel ist im Index, wird aber ausgeblendet durch:{' '}
            <b>{result.failingFilters.map((key) => FILTER_LABELS[key]).join(', ')}</b>.
          </>
        ),
        action: (
          <button type="button" onClick={actions.resetFilters} className={primaryButton}>
            Filter zurücksetzen
          </button>
        ),
      };
    case 'notIndexed':
      return actions.refreshed
        ? {
            tone: 'critical',
            text: (
              <>
                <b>Fehler in Manelly:</b> Jellyfin liefert den Titel in seiner {libraryText} aus, doch auch nach dem erneuten
                Einlesen fehlt er im Index. Bitte melde die Angaben unten.
              </>
            ),
            details: true,
          }
        : {
            tone: 'info',
            text: 'Jellyfin liefert den Titel in seiner Bibliothek aus, im Index von Manelly ist er aber noch nicht – meist, weil er nach dem letzten Einlesen dazugekommen ist. «Neu einlesen» holt ihn; die Prüfung läuft danach von selbst noch einmal.',
            action: refreshButton,
            details: true,
          };
    case 'indexNotReady':
      return {
        tone: 'info',
        text: `Der Medien-Index wird gerade aufgebaut${progress ? ` (${progress.trim()})` : ''}. Die Prüfung läuft danach von selbst noch einmal.`,
      };
    case 'unsupportedType':
      return {
        tone: 'warning',
        text: (
          <>
            Jellyfin führt den Titel als «{ITEM_TYPE_LABELS[result.type] ?? result.type}», nicht als Film oder Serie – Manelly zeigt
            nur Filme und Serien. Das passiert typischerweise in Bibliotheken vom Typ «Heimvideos und Fotos» oder «Gemischte
            Inhalte». In einer Bibliothek vom Typ «Filme» erkennt Jellyfin die Datei als Film.
          </>
        ),
      };
    case 'unsupportedLibrary':
      return {
        tone: 'warning',
        text: (
          <>
            Der Titel liegt in der {libraryText}. Manelly liest nur Bibliotheken vom Typ Filme, Serien und Gemischte Inhalte.
            Verschiebe die Datei in eine solche Bibliothek oder ändere in Jellyfin den Inhaltstyp der Bibliothek.
          </>
        ),
      };
    case 'noLibrary':
      return {
        tone: 'warning',
        text: 'Der Pfad des Titels gehört zu keinem Ordner einer Jellyfin-Bibliothek. Prüfe in Jellyfin unter Dashboard → Bibliotheken, ob der Ordner eingebunden ist.',
        details: true,
      };
    case 'notInLibraryQuery':
      return {
        tone: 'warning',
        text: (
          <>
            Jellyfin findet den Titel, liefert ihn aber nicht aus, wenn man seine {libraryText} abfragt – genau so liest Manelly
            ein
            {result.listing && <> (die Bibliothek liefert {countOf(result.listing.libraryTotal, result.type)}, dieser ist nicht dabei)</>}
            . Meist ist der Bibliotheksscan in Jellyfin nicht sauber durchgelaufen. Starte in Jellyfin unter Dashboard →
            Bibliotheken einen Scan dieser Bibliothek und danach hier «Neu einlesen».
          </>
        ),
        action: refreshButton,
        details: true,
      };
  }
}

const formatDate = (iso: string) => new Date(iso).toLocaleString('de-CH');

function countOf(count: number, type: string) {
  const [one, many] = type === 'Series' ? ['Serie', 'Serien'] : ['Film', 'Filme'];
  return `${count.toLocaleString('de-CH')} ${count === 1 ? one : many}`;
}

type Tone = keyof typeof MESSAGE_TONES;

const MESSAGE_TONES = {
  good: { icon: CircleCheck, className: 'bg-good/10 ring-good/25', iconClass: 'text-good' },
  info: { icon: Info, className: 'bg-info/10 ring-info/25', iconClass: 'text-info' },
  warning: { icon: TriangleAlert, className: 'bg-warning/12 ring-warning/30', iconClass: 'text-warning' },
  critical: { icon: TriangleAlert, className: 'bg-critical/10 ring-critical/25', iconClass: 'text-critical' },
} as const;

function Message({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { icon: Icon, className, iconClass } = MESSAGE_TONES[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${className}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60';
const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2';
