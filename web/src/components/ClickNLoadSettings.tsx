import type { ClickNLoadEvent } from '@manelly/shared';
import { CircleCheck, CircleX, Download, LoaderCircle, MousePointerClick } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useClickNLoad, useSetLocalClickNLoad } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../lib/format';
import { Code, Message } from './ConnectionForm';

/**
 * Click'n'Load: pages send links to a JDownloader on the own computer (127.0.0.1:9666). The browser extension, on
 * Windows and elsewhere, and Manelly itself on its own computer take them there and hand them to the JDownloader on
 * the Jellyfin server.
 */
export function ClickNLoadSettings() {
  const cnl = useClickNLoad(5_000);
  const setLocal = useSetLocalClickNLoad();
  const status = useAgent().data?.status;
  const now = useNow(30_000);
  const local = cnl.data?.local;
  const agentTooOld = status?.jdownloader !== undefined && !status.jdownloader.links;

  return (
    <section className="mt-6 space-y-4 border-t border-line pt-5 text-sm" aria-labelledby="clicknload-heading">
      <div>
        <h3 id="clicknload-heading" className="flex items-center gap-2 font-semibold">
          <MousePointerClick className="size-4 text-accent" aria-hidden /> Click'n'Load
        </h3>
        <p className="mt-1 text-ink-2">
          Ein Klick auf «Click'n'Load» schickt die Links an einen JDownloader auf dem eigenen Rechner (<Code>127.0.0.1:9666</Code>). Manelly nimmt sie
          an und übergibt sie mit Paketname und Passwort dem JDownloader auf dem Jellyfin-Server – sie erscheinen im Link Grabber.
        </p>
      </div>
      {agentTooOld && (
        <Message tone="critical">Der Agent ist zu alt für Click'n'Load (ab 0.32.0) – unter Server → Agent «Aktualisieren & neu starten».</Message>
      )}

      <div className="rounded-xl p-4 ring-1 ring-line">
        <p className="font-medium">Windows und andere Rechner: Browser-Erweiterung (Chrome, Edge)</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
          <li>
            <a href="/api/cnl/extension.zip" download className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <Download className="size-3.5" aria-hidden /> Erweiterung herunterladen
            </a>{' '}
            und entpacken, z. B. nach <Code>Dokumente</Code>. Den Ordner behalten – der Browser lädt die Erweiterung von dort.
          </li>
          <li>
            <Code>edge://extensions</Code> bzw. <Code>chrome://extensions</Code> öffnen und den <b>Entwicklermodus</b> einschalten.
          </li>
          <li>
            «Entpackte Erweiterung laden» (Edge: «Entpackt laden») und den Ordner <Code>manelly-clicknload</Code> wählen.
          </li>
        </ol>
        <p className="mt-2 text-xs text-ink-3">
          Die Erweiterung kennt die Adresse dieses Manelly ({window.location.origin}) schon. Sie braucht Zugriff auf alle Seiten – nur so kann sie den
          Seiten sagen, dass «JDownloader» läuft, und ihre Click'n'Load-Anfragen lesen; sie reagiert nur auf Anfragen an 127.0.0.1:9666. Ein Klick auf
          ihr Symbol zeigt, was zuletzt übergeben wurde.
        </p>
      </div>

      <div className="rounded-xl p-4 ring-1 ring-line">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-accent"
            checked={local?.enabled ?? false}
            disabled={!local || setLocal.isPending}
            onChange={(event) => setLocal.mutate(event.target.checked)}
          />
          <span>
            <span className="font-medium">Auf dem Rechner mit Manelly selbst annehmen</span>
            <span className="block text-ink-2">
              Für den Browser auf dem Rechner, auf dem Manelly läuft (z. B. den Mac) – ohne Erweiterung. Manelly lauscht dafür auf Port{' '}
              {local?.port ?? 9666}, nur für diesen Rechner.
            </span>
          </span>
        </label>
        {local?.enabled && (
          <p className={clsx('mt-2 flex items-center gap-1.5 text-xs', local.error ? 'text-critical' : local.listening ? 'text-good' : 'text-ink-2')}>
            {setLocal.isPending ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : local.error ? (
              <CircleX className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <CircleCheck className="size-3.5 shrink-0" aria-hidden />
            )}
            {local.error ?? (local.listening ? `Nimmt auf 127.0.0.1:${local.port} an.` : 'Startet …')}
          </p>
        )}
        {setLocal.isError && <p className="mt-2 text-xs text-critical">{setLocal.error.message}</p>}
      </div>

      <div>
        <p className="font-medium">Zuletzt empfangen</p>
        {cnl.error ? (
          <p className="mt-1 text-xs text-critical">{cnl.error.message}</p>
        ) : !cnl.data ? (
          <div aria-busy className="mt-1 h-10 animate-pulse rounded-lg bg-card-2" />
        ) : cnl.data.events.length === 0 ? (
          <p className="mt-1 text-xs text-ink-3">Noch nichts – seit dem letzten Start von Manelly.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line text-xs">
            {cnl.data.events.slice(0, 8).map((event) => (
              <EventRow key={event.id} event={event} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function EventRow({ event, now }: { event: ClickNLoadEvent; now: number }) {
  const what = event.container ? 'DLC-Container' : `${event.links} ${event.links === 1 ? 'Link' : 'Links'}`;
  return (
    <li className="flex items-start gap-2 py-1.5">
      {event.error ? <CircleX className="mt-px size-3.5 shrink-0 text-critical" aria-hidden /> : <CircleCheck className="mt-px size-3.5 shrink-0 text-good" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="font-medium break-words text-ink">{event.packageName ?? host(event.source) ?? 'Ohne Paketname'}</span>
        <span className="text-ink-2">
          {' '}
          · {event.error ? <span className="text-critical">{event.error}</span> : `${what} an JDownloader`}
          {event.packageName && host(event.source) && ` · von ${host(event.source)}`} · {event.via === 'extension' ? 'Erweiterung' : 'dieser Rechner'}
        </span>
      </span>
      <span className="shrink-0 text-ink-3">{formatAgo(Date.parse(event.at), now)}</span>
    </li>
  );
}
