import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { FindingSeverity, HardwareTestResult, TranscodeLogInfo, TranscodingReport } from '@manelly/shared';
import { CircleCheck, CircleMinus, CircleX, Cpu, Info, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ErrorPanel } from '../components/ErrorPanel';
import { SetupPanel } from '../components/SetupPanel';
import { isConfigured, useAgent, useHardwareTest, useSettings, useTranscodingReport } from '../hooks/queries';
import { codecLabel, joinParts } from '../lib/format';
import { decoderLabel, hardwareLabel } from '../lib/streamFindings';
import { describeCheck, HARDWARE_TEST_LABELS } from '../lib/transcodingChecks';

const SYSTEM_LABELS: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

export function ServerPage() {
  useEffect(() => {
    document.title = 'Server · Manelly';
  }, []);
  const { data: settings } = useSettings();
  const configured = settings ? isConfigured(settings) : undefined;
  const report = useTranscodingReport(configured === true);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Server</h1>
        <p className="mt-1 text-sm text-ink-2">Transcoding und Hardware-Beschleunigung deines Jellyfin-Servers.</p>
      </header>
      <div className="mt-6 space-y-6">
        {configured === false && <SetupPanel />}
        {report.isPending && configured && <div aria-busy className="h-64 animate-pulse rounded-2xl bg-card-2" />}
        {report.error && <ErrorPanel error={report.error} />}
        {report.data && <Transcoding report={report.data} />}
      </div>
    </div>
  );
}

function Transcoding({ report }: { report: TranscodingReport }) {
  return (
    <>
      <Card title="Hardware-Beschleunigung" icon={Cpu}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Row label="Beschleunigung">{report.hardwareAcceleration ? hardwareLabel(report.hardwareAcceleration) : 'Keine'}</Row>
          <Row label="System">{report.operatingSystem ? SYSTEM_LABELS[report.operatingSystem] : '–'}</Row>
          <Row label="Hardware-Kodierung">
            {report.hardwareEncoding ? 'Eingeschaltet' : 'Ausgeschaltet'}
            {report.hardwareEncoding && (
              <span className="text-ink-2">
                {' '}
                · {joinParts(['H.264', report.allowHevcEncoding && 'HEVC', report.allowAv1Encoding && 'AV1'])}
              </span>
            )}
          </Row>
          <Row label="Hardware-Dekodierung">
            {report.hardwareDecodingCodecs.length ? report.hardwareDecodingCodecs.map((codec) => codecLabel(codec)).join(', ') : 'Keine Codecs'}
            {report.hardwareDecodingCodecs.includes('hevc') && <span className="text-ink-2"> · HEVC 10 bit {report.hevc10Bit ? 'an' : 'aus'}</span>}
          </Row>
          <Row label="Tone-Mapping">{report.toneMapping ? 'Eingeschaltet' : 'Ausgeschaltet'}</Row>
          <Row label="FFmpeg">
            <span className="font-mono text-xs break-all">{report.encoderPath ?? 'von Jellyfin mitgeliefert'}</span>
          </Row>
        </dl>
        <ul className="mt-4 space-y-2.5">
          {report.checks.map((check) => {
            const text = describeCheck(check);
            return (
              <Finding key={check.kind} severity={check.severity} title={text.title}>
                <p className="text-ink-2">{text.detail}</p>
                {text.action && <p className="mt-0.5 text-xs text-ink-3">→ {text.action}</p>}
              </Finding>
            );
          })}
        </ul>
        {report.hardwareAcceleration && <HardwareTest />}
      </Card>

      <Card title="Letzte Transcodes" icon={Cpu}>
        {!report.logsReadable ? (
          <p className="text-sm text-ink-2">Die Protokolle von Jellyfin liessen sich nicht lesen – dafür braucht der API-Schlüssel Administratorrechte.</p>
        ) : report.recent.length === 0 ? (
          <p className="text-sm text-ink-2">In den Protokollen von Jellyfin findet sich noch kein Transcode.</p>
        ) : (
          <RecentTranscodes logs={report.recent} />
        )}
      </Card>
    </>
  );
}

function HardwareTest() {
  const agent = useAgent();
  const test = useHardwareTest();
  const ready = agent.data?.status?.ready === true;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Hardware testen</p>
          <p className="text-xs text-ink-2">
            Der Agent lässt das FFmpeg von Jellyfin auf dem Server ein paar Sekunden Testbild kodieren und dekodieren – mit der
            eingestellten Beschleunigung.
          </p>
        </div>
        {ready ? (
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending} className={primaryButton}>
            {test.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {test.isPending ? 'Teste …' : 'Hardware testen'}
          </button>
        ) : (
          <p className="text-xs text-ink-3">
            Dafür braucht es den{' '}
            <Link to="/settings" className="font-medium text-accent hover:underline">
              Agent auf dem Jellyfin-Server
            </Link>
            .
          </p>
        )}
      </div>
      {test.error && <p className="mt-3 text-sm text-critical">{test.error.message}</p>}
      {test.data && <TestResults result={test.data} />}
    </div>
  );
}

function TestResults({ result }: { result: HardwareTestResult }) {
  const failed = result.tests.filter((entry) => !entry.ok && !entry.skipped).length;
  return (
    <div className="mt-3 space-y-2">
      <p className={clsx('text-sm font-medium', failed ? 'text-critical' : 'text-good')}>
        {failed ? `${failed} von ${result.tests.length} Tests fehlgeschlagen` : `${hardwareLabel(result.hardware)} funktioniert`}
        <span className="font-normal text-ink-3"> · FFmpeg {result.ffmpeg.version ?? '?'}</span>
      </p>
      <ul className="space-y-1.5 text-sm">
        {result.tests.map((entry) => {
          const Icon = entry.skipped ? CircleMinus : entry.ok ? CircleCheck : CircleX;
          return (
            <li key={entry.id}>
              <span className="flex items-center gap-2">
                <Icon className={clsx('size-4 shrink-0', entry.skipped ? 'text-ink-3' : entry.ok ? 'text-good' : 'text-critical')} aria-hidden />
                <span className="font-medium">{HARDWARE_TEST_LABELS[entry.id]}</span>
                <span className="text-xs text-ink-3 tabular-nums">{(entry.durationMs / 1000).toFixed(1)} s</span>
              </span>
              {entry.message && <p className="ml-6 text-xs text-ink-2">{entry.message}</p>}
              {entry.log && (
                <details className="ml-6 text-xs">
                  <summary className="cursor-pointer text-ink-2">Ausgabe von FFmpeg</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-card-2 p-2 whitespace-pre-wrap">{entry.log}</pre>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecentTranscodes({ logs }: { logs: TranscodeLogInfo[] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-card-2 text-xs text-ink-2">
          <tr>
            <th className="px-3 py-2 font-medium">Gestartet</th>
            <th className="px-3 py-2 font-medium">Dekodieren</th>
            <th className="px-3 py-2 font-medium">Kodieren</th>
            <th className="px-3 py-2 font-medium">Meldungen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {logs.map((log) => (
            <tr key={log.fileName} title={log.fileName}>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{new Date(log.startedAt).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="px-3 py-2">
                <Pill hardware={log.decoderHardware}>
                  {log.decoderHardware && log.decoder ? decoderLabel(log.decoder) : log.decoder ? `Software (${decoderLabel(log.decoder)} fehlgeschlagen)` : 'Software'}
                </Pill>
              </td>
              <td className="px-3 py-2">
                <Pill hardware={log.encoderHardware ?? false}>{log.encoder ?? '–'}</Pill>
              </td>
              <td className="max-w-[18rem] px-3 py-2 text-xs text-ink-2">
                {log.errors.length ? <span className="text-critical">{log.errors[0]}</span> : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ hardware, children }: { hardware: boolean; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex rounded px-1.5 py-0.5 text-xs whitespace-nowrap ring-1 ring-inset', hardware ? 'bg-good/10 ring-good/30' : 'bg-warning/10 ring-warning/30')}>
      {children}
    </span>
  );
}

const SEVERITY: Record<FindingSeverity, { icon: LucideIcon; className: string }> = {
  good: { icon: CircleCheck, className: 'text-good' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  critical: { icon: TriangleAlert, className: 'text-critical' },
};

function Finding({ severity, title, children }: { severity: FindingSeverity; title: string; children: ReactNode }) {
  const { icon: Icon, className } = SEVERITY[severity];
  return (
    <li className="flex gap-2.5 text-sm">
      <Icon className={clsx('mt-0.5 size-4 shrink-0', className)} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm shadow-black/5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2.5 font-semibold">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70';
