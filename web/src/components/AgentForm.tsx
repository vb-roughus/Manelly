import { useId, useState, type FormEvent } from 'react';
import type { AgentOverview, AgentSettingsView } from '@manelly/shared';
import { CircleCheck, CircleX, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useAgent, useAgentSettings, useSaveAgentSettings } from '../hooks/queries';
import { Code, Field, inputClass, Message } from './ConnectionForm';

/** Address and key of the agent on the Jellyfin server; saved only after the agent answered. */
export function AgentForm() {
  const settings = useAgentSettings();
  const overview = useAgent();
  if (settings.isPending) return <div aria-busy className="h-48 animate-pulse rounded-xl bg-card-2" />;
  if (!settings.data) return <Message tone="critical">{settings.error?.message ?? 'Einstellungen konnten nicht geladen werden.'}</Message>;
  return <AgentFields settings={settings.data} overview={overview.data} />;
}

const TOOL_LABELS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe (optional)', mkvmerge: 'mkvmerge (MKVToolNix)', doviTool: 'dovi_tool' } as const;

function AgentFields({ settings, overview }: { settings: AgentSettingsView; overview: AgentOverview | undefined }) {
  const id = useId();
  const save = useSaveAgentSettings();
  const [url, setUrl] = useState(settings.url ?? '');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ url, ...(token.trim() ? { token } : {}) }, { onSuccess: () => setToken('') });
  }

  const status = overview?.status;
  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        id={`${id}-url`}
        label="Agent-Adresse"
        hint={
          <>
            Der Agent zeigt sie beim Start an, z. B. <Code>http://jellyfin-pc:8790</Code>. Installiert wird er auf dem
            Jellyfin-Server mit <Code>scripts\start-agent.cmd</Code>.
          </>
        }
      >
        <input
          id={`${id}-url`}
          required
          spellCheck={false}
          placeholder="http://jellyfin-pc:8790"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field
        id={`${id}-token`}
        label="Agent-Schlüssel"
        hint={settings.hasToken ? 'Leer lassen, um den gespeicherten Schlüssel zu behalten.' : 'Steht in der Ausgabe des Agents beim Start.'}
      >
        <div className="relative">
          <input
            id={`${id}-token`}
            type={showToken ? 'text' : 'password'}
            required={!settings.hasToken}
            autoComplete="off"
            spellCheck={false}
            placeholder={settings.hasToken ? 'Gespeichert' : 'Schlüssel einfügen'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className={`${inputClass} pr-11 font-mono placeholder:font-sans`}
          />
          <button
            type="button"
            onClick={() => setShowToken((shown) => !shown)}
            aria-label={showToken ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-2 hover:text-ink"
          >
            {showToken ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>

      {save.isError && <Message tone="critical">{save.error.message}</Message>}
      {overview?.error && !save.isError && <Message tone="critical">{overview.error}</Message>}
      {status && (
        <div className="space-y-2">
          <Message tone={status.ready ? 'good' : 'critical'}>
            Verbunden mit dem Agent auf <b>{status.hostname}</b> (Version {status.version}).{' '}
            {status.ready ? 'Alle Werkzeuge sind da.' : 'Es fehlen Werkzeuge – starte das Installationsskript auf dem Jellyfin-Server erneut.'}
          </Message>
          <ul className="grid gap-1 rounded-lg bg-card-2 p-3 text-xs sm:grid-cols-2">
            {(Object.keys(TOOL_LABELS) as Array<keyof typeof TOOL_LABELS>).map((name) => {
              const tool = status.tools[name];
              return (
                <li key={name} className="flex min-w-0 items-center gap-1.5" title={tool?.path ?? undefined}>
                  {tool?.path ? <CircleCheck className="size-3.5 shrink-0 text-good" aria-label="gefunden" /> : <CircleX className="size-3.5 shrink-0 text-critical" aria-label="fehlt" />}
                  <span className="font-medium">{TOOL_LABELS[name]}</span>
                  <span className="truncate text-ink-3">{tool?.version ?? (tool?.path ? '' : 'fehlt')}</span>
                </li>
              );
            })}
          </ul>
        </div>
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
