import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { ConnectionSettings } from '@manelly/shared';
import { CircleCheck, Eye, EyeOff, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useSaveSettings, useSettings } from '../hooks/queries';
import { ApiError } from '../lib/api';

/** Form for the Jellyfin address and API key; saves only after a successful connection test. */
export function ConnectionForm() {
  const { data: settings, error, isPending } = useSettings();
  if (isPending) {
    return <div aria-busy className="h-64 animate-pulse rounded-xl bg-card-2" />;
  }
  if (!settings) {
    return <Message tone="critical">{error instanceof Error ? error.message : 'Einstellungen konnten nicht geladen werden.'}</Message>;
  }
  return <ConnectionFields settings={settings} />;
}

const HINTS: Partial<Record<string, string>> = {
  UNAUTHORIZED: 'Prüfe, ob du den Schlüssel vollständig kopiert hast und ob er in Jellyfin noch existiert.',
  UNREACHABLE:
    'Stimmt die Adresse, und läuft Jellyfin? Die Adresse muss vom Manelly-Server aus erreichbar sein – in Docker zeigt «localhost» auf den Container selbst.',
  TIMEOUT: 'Jellyfin ist erreichbar, antwortet aber nicht rechtzeitig.',
  UPSTREAM_ERROR: 'Unter dieser Adresse antwortet etwas anderes als Jellyfin. Prüfe Port und Pfad.',
};

function ConnectionFields({ settings }: { settings: ConnectionSettings }) {
  const id = useId();
  const save = useSaveSettings();
  const [url, setUrl] = useState(settings.jellyfinUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ jellyfinUrl: url, apiKey }, { onSuccess: () => setApiKey('') });
  }

  const keyPlaceholder = settings.apiKeyConfigured
    ? `Gespeichert${settings.apiKeyHint ? ` (…${settings.apiKeyHint})` : ''}`
    : 'API-Schlüssel einfügen';
  const saveError = save.error instanceof ApiError ? save.error : null;

  return (
    <form onSubmit={submit} className="space-y-5">
      {settings.source === 'env' && (
        <Message tone="info">
          Die aktuelle Verbindung stammt aus den Umgebungsvariablen. Was du hier speicherst, hat Vorrang.
        </Message>
      )}

      <Field
        id={`${id}-url`}
        label="Server-Adresse"
        hint={
          <>
            So, wie der Manelly-Server Jellyfin erreicht, z. B. <Code>http://192.168.1.10:8096</Code>. Die Adresse aus
            der Browser-Zeile funktioniert auch.
          </>
        }
      >
        <input
          id={`${id}-url`}
          type="url"
          required
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="http://192.168.1.10:8096"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        id={`${id}-key`}
        label="API-Schlüssel"
        hint={
          <>
            {settings.apiKeyConfigured && 'Leer lassen, um den gespeicherten Schlüssel zu behalten. '}
            In Jellyfin unter <b>Dashboard → API-Schlüssel</b> mit «+» erstellen, z. B. mit dem Namen «Manelly».
          </>
        }
      >
        <div className="relative">
          <input
            id={`${id}-key`}
            type={showKey ? 'text' : 'password'}
            required={!settings.apiKeyConfigured}
            autoComplete="off"
            spellCheck={false}
            placeholder={keyPlaceholder}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className={`${inputClass} pr-11 font-mono placeholder:font-sans`}
          />
          <button
            type="button"
            onClick={() => setShowKey((shown) => !shown)}
            aria-label={showKey ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
            title={showKey ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-2 hover:text-ink"
          >
            {showKey ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>

      {save.isSuccess && (
        <Message tone="good">
          Verbunden mit <b>{save.data.server.name}</b> · Jellyfin {save.data.server.version}. Die Einstellungen sind
          gespeichert.
        </Message>
      )}
      {save.isError && (
        <Message tone="critical">
          <span className="font-medium">{save.error.message}</span>
          {saveError && HINTS[saveError.code] && <span className="mt-1 block text-ink-2">{HINTS[saveError.code]}</span>}
        </Message>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-80"
        >
          {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {save.isPending ? 'Verbinde …' : 'Verbinden & speichern'}
        </button>
        <p className="text-xs text-ink-3">Manelly prüft die Verbindung, bevor es speichert.</p>
      </div>
    </form>
  );
}

export const inputClass =
  'block w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink shadow-xs outline-none transition ' +
  'placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/20';

export function Field({ id, label, hint, children }: { id: string; label: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      <p className="mt-1.5 text-xs text-ink-2">{hint}</p>
    </div>
  );
}

const MESSAGE_TONES = {
  good: { icon: CircleCheck, className: 'bg-good/10 ring-good/25', iconClass: 'text-good' },
  info: { icon: Info, className: 'bg-info/10 ring-info/25', iconClass: 'text-info' },
  critical: { icon: TriangleAlert, className: 'bg-critical/10 ring-critical/25', iconClass: 'text-critical' },
} as const;

export function Message({ tone, children }: { tone: keyof typeof MESSAGE_TONES; children: ReactNode }) {
  const { icon: Icon, className, iconClass } = MESSAGE_TONES[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${className}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-card-2 px-1 py-0.5 ring-1 ring-line ring-inset">{children}</code>;
}
