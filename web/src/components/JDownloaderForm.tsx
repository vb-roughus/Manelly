import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { JDownloaderSettings, JDownloaderStatus, JDownloaderThrottleMode } from '@manelly/shared';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useJDownloader, useSaveJDownloaderSettings } from '../hooks/queries';
import { Code, Field, inputClass, Message } from './ConnectionForm';
import { kibToMbit, mbitField, mbitToKib } from '../lib/format';

/** JDownloader on the Jellyfin server: whether Manelly shows it, where the agent reaches it, and what happens while somebody streams. */
export function JDownloaderForm() {
  const agent = useAgent({ refreshTools: true });
  const status = agent.data?.status;
  const supported = Boolean(status?.jdownloader);
  const jdownloader = useJDownloader(supported, false);

  if (agent.isPending) return <div aria-busy className="h-40 animate-pulse rounded-xl bg-card-2" />;
  if (agent.data?.error) return <Message tone="critical">{agent.data.error}</Message>;
  if (!status) {
    return (
      <p className="text-sm text-ink-2">
        Zuerst den Agent unter{' '}
        <Link to="/server/agent" className="font-medium text-accent hover:underline">
          Server → Agent
        </Link>{' '}
        verbinden.
      </p>
    );
  }
  if (!supported) {
    return (
      <Message tone="critical">
        Der Agent auf {status.hostname} ist zu alt dafür (Version {status.version}). Auf dem Jellyfin-Server <Code>git pull</Code> und{' '}
        <Code>scripts\start-agent.cmd -Install</Code> ausführen.
      </Message>
    );
  }
  if (!jdownloader.data) {
    return jdownloader.error ? <Message tone="critical">{jdownloader.error.message}</Message> : <div aria-busy className="h-40 animate-pulse rounded-xl bg-card-2" />;
  }
  return <Fields key={JSON.stringify(jdownloader.data.settings)} status={jdownloader.data} />;
}

const MODES: Array<{ mode: JDownloaderThrottleMode; title: string; description: string }> = [
  { mode: 'off', title: 'Nichts tun', description: 'JDownloader lädt weiter wie eingestellt.' },
  { mode: 'limit', title: 'Tempo begrenzen', description: 'Begrenzt die Downloads, solange jemand streamt.' },
  { mode: 'pause', title: 'Pausieren', description: 'Hält die Downloads an, solange jemand streamt.' },
];

function Fields({ status }: { status: JDownloaderStatus }) {
  const id = useId();
  const save = useSaveJDownloaderSettings();
  const [enabled, setEnabled] = useState(status.settings.enabled);
  const [url, setUrl] = useState(status.settings.url);
  const [mode, setMode] = useState(status.settings.throttle.mode);
  const [limitMbit, setLimitMbit] = useState(mbitField(kibToMbit(status.settings.throttle.limitKBps)));
  // Missing before agent 0.26.0.
  const extractSupported = status.settings.extractTo !== undefined;
  const [extractTo, setExtractTo] = useState(status.settings.extractTo ?? '');

  const limitKBps = mbitToKib(Number(limitMbit.replace(',', '.')));
  const limitInvalid = mode === 'limit' && !(limitKBps >= 1);

  function submit(event: FormEvent) {
    event.preventDefault();
    const settings: JDownloaderSettings = {
      enabled,
      url: url.trim(),
      throttle: { mode, limitKBps: limitKBps >= 1 ? limitKBps : status.settings.throttle.limitKBps },
      ...(extractSupported ? { extractTo: extractTo.trim() || null } : {}),
    };
    save.mutate(settings);
  }

  const shown = save.data ?? status;
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5 size-4 accent-accent" />
        <span>
          <span className="font-medium">JDownloader einbinden</span>
          <span className="block text-xs text-ink-2">
            Dafür in JDownloader unter Einstellungen → Erweiterte Einstellungen die «Deprecated API» einschalten (nur localhost genügt).
          </span>
        </span>
      </label>

      {enabled && (
        <>
          <Field id={`${id}-url`} label="Adresse aus Sicht des Agents" hint={<>Meist <Code>http://127.0.0.1:3128</Code> – JDownloader läuft ja auf demselben Rechner.</>}>
            <input id={`${id}-url`} required spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} className={inputClass} />
          </Field>

          {extractSupported && (
            <Field
              id={`${id}-extract`}
              label="Entpack-Ordner"
              hint="Der Ordner auf dem Jellyfin-Server, in den JDownloader die Archive entpackt – wie beim Archiv-Entpacker von JDownloader eingestellt. Der Reiter «Extracted» zeigt, was darin liegt. Leer lassen: keiner."
            >
              <input
                id={`${id}-extract`}
                spellCheck={false}
                value={extractTo}
                onChange={(event) => setExtractTo(event.target.value)}
                placeholder="z. B. D:\Downloads\Entpackt"
                className={clsx(inputClass, 'font-mono placeholder:font-sans')}
              />
            </Field>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Wenn jemand streamt</legend>
            <div className="space-y-2">
              {MODES.map((option) => (
                <label key={option.mode} className={clsx('flex cursor-pointer gap-3 rounded-xl p-3 ring-1 transition', mode === option.mode ? 'bg-accent/8 ring-accent/50' : 'ring-line')}>
                  <input type="radio" name={`${id}-mode`} checked={mode === option.mode} onChange={() => setMode(option.mode)} className="mt-1 accent-accent" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">{option.title}</span>
                    <span className="block text-xs text-ink-2">{option.description}</span>
                    {option.mode === 'limit' && mode === 'limit' && (
                      <span className="mt-2 flex items-center gap-2 text-xs">
                        auf
                        <input
                          inputMode="decimal"
                          value={limitMbit}
                          onChange={(event) => setLimitMbit(event.target.value)}
                          aria-label="Tempo-Limit in Mbit/s"
                          className="w-20 rounded-lg border border-line bg-card px-2 py-1 text-sm tabular-nums outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
                        />
                        Mbit/s
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Fünf Minuten nach dem letzten Stream stellt der Agent JDownloader wieder so ein wie vorher – auch nach einem Neustart. Was du in der
              Zwischenzeit von Hand änderst, bleibt.
            </p>
          </fieldset>
        </>
      )}

      {limitInvalid && <Message tone="critical">Das Tempo-Limit muss eine Zahl über 0 sein, z. B. 2 oder 0.5.</Message>}
      {save.isError && <Message tone="critical">{save.error.message}</Message>}
      {shown.settings.enabled && (shown.reachable ? (
        <Message tone="good">JDownloader antwortet{shown.state ? ` (${shown.state === 'RUNNING' ? 'lädt' : shown.state === 'PAUSE' ? 'pausiert' : 'bereit'})` : ''}.</Message>
      ) : (
        shown.error && <Message tone="critical">{shown.error}</Message>
      ))}

      <button
        type="submit"
        disabled={save.isPending || limitInvalid}
        className="bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Speichern
      </button>
    </form>
  );
}
