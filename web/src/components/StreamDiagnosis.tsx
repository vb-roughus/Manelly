import type { FindingSeverity, StreamSession } from '@manelly/shared';
import { CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { describeFinding } from '../lib/streamFindings';

const SEVERITY: Record<FindingSeverity, { icon: LucideIcon; className: string; label: string }> = {
  good: { icon: CircleCheck, className: 'text-good', label: 'In Ordnung' },
  info: { icon: Info, className: 'text-info', label: 'Hinweis' },
  warning: { icon: TriangleAlert, className: 'text-warning', label: 'Warnung' },
  critical: { icon: TriangleAlert, className: 'text-critical', label: 'Problem' },
};

/** What a stream costs the server, whether it keeps up and what could be improved. */
export function StreamDiagnosis({ session }: { session: StreamSession }) {
  const { findings, settingsKnown } = session.health;
  const videoTranscoded = session.transcoding !== null && !session.transcoding.isVideoDirect;
  if (findings.length === 0 && (settingsKnown || !videoTranscoded)) return null;

  return (
    <section className="border-t border-line px-4 py-3" aria-label="Diagnose">
      <p className="mb-2 text-xs font-medium text-ink-2">Diagnose</p>
      <ul className="space-y-2.5">
        {findings.map((finding) => {
          const { icon: Icon, className, label } = SEVERITY[finding.severity];
          const text = describeFinding(finding, session);
          return (
            <li key={finding.kind} className="flex gap-2.5 text-sm">
              <Icon className={clsx('mt-0.5 size-4 shrink-0', className)} aria-label={label} />
              <div className="min-w-0">
                <p className="font-medium">{text.title}</p>
                <p className="text-ink-2">{text.detail}</p>
                {text.action && <p className="mt-0.5 text-xs text-ink-3">→ {text.action}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {!settingsKnown && videoTranscoded && (
        <p className={clsx('text-xs text-ink-3', findings.length > 0 && 'mt-2.5')}>
          Manelly konnte die Transcoding-Einstellungen von Jellyfin nicht lesen – Hinweise zu Hardware-Beschleunigung und Limits
          fehlen. Dafür braucht der API-Schlüssel Administratorrechte.
        </p>
      )}
    </section>
  );
}
