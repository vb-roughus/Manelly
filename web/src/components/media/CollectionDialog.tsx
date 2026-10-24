import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleCheck, ExternalLink, FolderPlus, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useAddToCollection, useCollectionPreview, useCollections, useServerStatus } from '../../hooks/queries';
import { describeAudioFilter, describeVideoFilter, type MediaFilters } from '../../lib/media';

interface CollectionDialogProps {
  open: boolean;
  onClose: () => void;
  filters: MediaFilters;
  /** Number of titles matching the filters. */
  total: number;
}

/** Adds every title matching the current filters to a Jellyfin collection, skipping those already in it. */
export function CollectionDialog({ open, onClose, filters, total }: CollectionDialogProps) {
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
      aria-labelledby="collection-dialog-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {/* Mounted only while open, so every opening starts fresh. */}
      {open && <DialogBody filters={filters} total={total} onClose={onClose} />}
    </dialog>
  );
}

function suggestedName(filters: MediaFilters): string {
  return describeAudioFilter(filters) ?? describeVideoFilter(filters) ?? filters.q ?? '';
}

function DialogBody({ filters, total, onClose }: Omit<CollectionDialogProps, 'open'>) {
  const id = useId();
  const collections = useCollections(true);
  const add = useAddToCollection();
  const { data: server } = useServerStatus();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [collectionId, setCollectionId] = useState('');
  const [name, setName] = useState(() => suggestedName(filters));

  const list = collections.data?.collections ?? [];
  // Without any collection there is nothing to choose from.
  const effectiveMode = collections.data && list.length === 0 ? 'new' : mode;
  const selected = list.find((collection) => collection.id === collectionId);
  const previewTarget = effectiveMode === 'new' ? null : collectionId || undefined;
  const preview = useCollectionPreview(previewTarget ?? null, filters, previewTarget !== undefined);

  const toAdd = preview.data?.toAdd ?? 0;
  const canSubmit = !add.isPending && !preview.isFetching && toAdd > 0 && (effectiveMode === 'existing' ? Boolean(selected) : name.trim().length > 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    add.mutate(effectiveMode === 'existing' ? { collectionId, filters } : { name: name.trim(), filters });
  }

  if (add.data) {
    const { collection, added, alreadyIn, failed } = add.data;
    const link = server ? `${server.url}/web/#/details?id=${collection.id}&serverId=${server.id}` : null;
    return (
      <div className="p-6">
        <Header onClose={onClose} />
        <Message tone="good">
          <b>{added.toLocaleString('de-CH')}</b> Titel zu «{collection.name}» hinzugefügt.
          {alreadyIn > 0 && ` ${alreadyIn.toLocaleString('de-CH')} waren schon drin.`}
        </Message>
        {failed > 0 && (
          <div className="mt-3">
            <Message tone="warning">
              Jellyfin kennt {failed.toLocaleString('de-CH')} Titel nicht mehr – vermutlich seit dem letzten Einlesen gelöscht. «Neu
              einlesen» bringt den Index auf den aktuellen Stand.
            </Message>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}>
              In Jellyfin öffnen
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          <button type="button" onClick={onClose} className={primaryButton}>
            Fertig
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="p-6">
      <Header onClose={onClose} />
      <p className="text-sm text-ink-2">
        <b className="text-ink">{total.toLocaleString('de-CH')}</b> {total === 1 ? 'Titel entspricht' : 'Titel entsprechen'} den
        aktuellen Filtern. Titel, die schon in der Sammlung sind, werden übersprungen.
      </p>

      <fieldset className="mt-5 space-y-3">
        <legend className="sr-only">Ziel</legend>
        <Option
          id={`${id}-existing`}
          checked={effectiveMode === 'existing'}
          disabled={collections.data !== undefined && list.length === 0}
          onSelect={() => setMode('existing')}
          label="Bestehende Sammlung"
        >
          {collections.isPending ? (
            <div className="h-9 animate-pulse rounded-lg bg-card-2" />
          ) : list.length === 0 ? (
            <p className="text-xs text-ink-3">In Jellyfin gibt es noch keine Sammlung.</p>
          ) : (
            <select
              aria-label="Sammlung"
              value={collectionId}
              onChange={(event) => {
                setCollectionId(event.target.value);
                setMode('existing');
              }}
              className={inputClass}
            >
              <option value="">Sammlung wählen …</option>
              {list.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                  {collection.itemCount !== null && ` (${collection.itemCount.toLocaleString('de-CH')})`}
                </option>
              ))}
            </select>
          )}
        </Option>
        <Option id={`${id}-new`} checked={effectiveMode === 'new'} onSelect={() => setMode('new')} label="Neue Sammlung">
          <input
            type="text"
            aria-label="Name der neuen Sammlung"
            placeholder="Name der Sammlung"
            value={name}
            maxLength={200}
            onFocus={() => setMode('new')}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </Option>
      </fieldset>

      <div className="mt-5 min-h-11" aria-live="polite">
        {collections.error ? (
          <Message tone="critical">{collections.error.message}</Message>
        ) : previewTarget === undefined ? null : preview.isFetching ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Vergleiche mit der Sammlung …
          </p>
        ) : preview.error ? (
          <Message tone="critical">{preview.error.message}</Message>
        ) : preview.data ? (
          <PreviewMessage
            alreadyIn={preview.data.alreadyIn}
            toAdd={preview.data.toAdd}
            target={effectiveMode === 'new' ? `die neue Sammlung${name.trim() ? ` «${name.trim()}»` : ''}` : `«${selected?.name ?? ''}»`}
          />
        ) : null}
        {add.error && (
          <div className="mt-3">
            <Message tone="critical">{add.error.message}</Message>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className={secondaryButton}>
          Abbrechen
        </button>
        <button type="submit" disabled={!canSubmit} className={primaryButton}>
          {add.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {add.isPending ? 'Wird hinzugefügt …' : toAdd > 0 ? `${toAdd.toLocaleString('de-CH')} Titel hinzufügen` : 'Hinzufügen'}
        </button>
      </div>
    </form>
  );
}

function PreviewMessage({ alreadyIn, toAdd, target }: { alreadyIn: number; toAdd: number; target: string }) {
  if (toAdd === 0) {
    return <Message tone="good">Alle Treffer sind schon in {target}.</Message>;
  }
  return (
    <Message tone="info">
      <b>{toAdd.toLocaleString('de-CH')}</b> {toAdd === 1 ? 'Titel kommt' : 'Titel kommen'} in {target}
      {alreadyIn > 0 && <>, {alreadyIn.toLocaleString('de-CH')} {alreadyIn === 1 ? 'ist' : 'sind'} schon drin</>}.
    </Message>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <h2 id="collection-dialog-title" className="flex items-center gap-2.5 text-lg font-semibold">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
          <FolderPlus className="size-4" aria-hidden />
        </span>
        Zu einer Sammlung hinzufügen
      </h2>
      <button type="button" onClick={onClose} aria-label="Schliessen" className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-card-2 hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function Option(props: { id: string; checked: boolean; disabled?: boolean; onSelect: () => void; label: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'rounded-xl p-3 ring-1 transition ring-inset',
        props.checked ? 'bg-accent/8 ring-accent/50' : 'ring-line',
        props.disabled && 'opacity-60',
      )}
    >
      <label htmlFor={props.id} className="mb-2 flex items-center gap-2 text-sm font-medium">
        <input
          id={props.id}
          type="radio"
          name="collection-target"
          checked={props.checked}
          disabled={props.disabled}
          onChange={props.onSelect}
          className="size-4 accent-[var(--accent)]"
        />
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

const MESSAGE_TONES = {
  good: { icon: CircleCheck, className: 'bg-good/10 ring-good/25', iconClass: 'text-good' },
  info: { icon: Info, className: 'bg-info/10 ring-info/25', iconClass: 'text-info' },
  warning: { icon: TriangleAlert, className: 'bg-warning/12 ring-warning/30', iconClass: 'text-warning' },
  critical: { icon: TriangleAlert, className: 'bg-critical/10 ring-critical/25', iconClass: 'text-critical' },
} as const;

function Message({ tone, children }: { tone: keyof typeof MESSAGE_TONES; children: ReactNode }) {
  const { icon: Icon, className, iconClass } = MESSAGE_TONES[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${className}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

const inputClass =
  'block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';
const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2';
