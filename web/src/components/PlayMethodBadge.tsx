import type { PlayMethod } from '@manelly/shared';
import { CircleCheck, Cpu, Shuffle, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface MethodMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the tinted background and the icon color. */
  tone: string;
}

export const PLAY_METHODS: Record<PlayMethod, MethodMeta> = {
  DirectPlay: {
    label: 'Direct Play',
    description: 'Die Datei wird unverändert gesendet – keine Last für den Server.',
    icon: CircleCheck,
    tone: 'bg-good/12 text-good ring-good/25',
  },
  Remux: {
    label: 'Remux',
    description: 'Audio und Video werden kopiert, nur der Container wird umgepackt.',
    icon: Shuffle,
    tone: 'bg-info/12 text-info ring-info/25',
  },
  DirectStream: {
    label: 'Direct Stream',
    description: 'Das Video wird kopiert, nur der Ton wird umgewandelt.',
    icon: Shuffle,
    tone: 'bg-info/12 text-info ring-info/25',
  },
  Transcode: {
    label: 'Transcode',
    description: 'Der Server codiert das Video neu – das kostet am meisten Leistung.',
    icon: Cpu,
    tone: 'bg-warning/15 text-warning ring-warning/30',
  },
};

export function PlayMethodBadge({ method, hardware }: { method: PlayMethod; hardware?: string | null }) {
  const meta = PLAY_METHODS[method];
  const Icon = meta.icon;
  return (
    <span
      title={meta.description}
      className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', meta.tone)}
    >
      <Icon className="size-3.5" aria-hidden />
      {/* Text stays in ink color; the icon carries the status color. */}
      <span className="text-ink">{meta.label}</span>
      {hardware && <span className="text-ink-2 uppercase">· {hardware}</span>}
    </span>
  );
}
