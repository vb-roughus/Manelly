import { useId, useState, type FormEvent } from 'react';
import type { KnowledgeLink } from '@manelly/shared';
import { Link2, LoaderCircle, Trash2 } from 'lucide-react';
import { useDeleteKnowledgeLink, useSaveKnowledgeLink } from '../hooks/queries';
import { withScheme } from '../lib/links';
import { Message } from './ConnectionForm';
import { Modal } from './Modal';

/** Adds a link to the menu «Links», or changes or deletes `link`. */
export function LinkDialog({ open, link, onClose, onSaved }: { open: boolean; link: KnowledgeLink | null; onClose: () => void; onSaved?: () => void }) {
  return (
    <Modal open={open} onClose={onClose} icon={Link2} title={link ? 'Link bearbeiten' : 'Link hinzufügen'} description="Zu einer Wissenssammlung ausserhalb von Manelly; öffnet in einem neuen Tab.">
      {/* A new form each time, so it starts from the link or empty. */}
      {open && <LinkForm key={link?.id ?? 'new'} link={link} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function LinkForm({ link, onClose, onSaved }: { link: KnowledgeLink | null; onClose: () => void; onSaved?: () => void }) {
  const id = useId();
  const [name, setName] = useState(link?.name ?? '');
  const [description, setDescription] = useState(link?.description ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveKnowledgeLink();
  const remove = useDeleteKnowledgeLink();
  const busy = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { ...(link ? { id: link.id } : {}), name: name.trim(), description: description.trim(), url: withScheme(url) },
      {
        onSuccess: () => {
          onSaved?.();
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <label htmlFor={`${id}-name`} className="block">
        <span className="mb-1 block font-medium">Name</span>
        <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus placeholder="z. B. Jellyfin-Doku" className={fieldClass} />
      </label>
      <label htmlFor={`${id}-description`} className="block">
        <span className="mb-1 block font-medium">
          Beschreibung <span className="font-normal text-ink-3">– erscheint, wenn die Maus auf dem Link ruht</span>
        </span>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
          rows={2}
          placeholder="z. B. Offizielle Dokumentation zu Server, Clients und Transcoding"
          className={fieldClass}
        />
      </label>
      <label htmlFor={`${id}-url`} className="block">
        <span className="mb-1 block font-medium">Zieladresse</span>
        <input
          id={`${id}-url`}
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          maxLength={2000}
          required
          spellCheck={false}
          placeholder="https://jellyfin.org/docs/"
          className={`${fieldClass} font-mono`}
        />
      </label>
      {error && <Message tone="critical">{error.message}</Message>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {link &&
            (confirmDelete ? (
              <button type="button" disabled={busy} onClick={() => remove.mutate(link.id, { onSuccess: onClose })} className={dangerButton}>
                {remove.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} Wirklich löschen
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={button}>
                <Trash2 className="size-4" aria-hidden /> Löschen
              </button>
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClose} className={button}>
            Abbrechen
          </button>
          <button type="submit" disabled={busy || !name.trim() || !url.trim()} className={primaryButton}>
            {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {link ? 'Speichern' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </form>
  );
}

const fieldClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';
const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'bg-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-critical px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
