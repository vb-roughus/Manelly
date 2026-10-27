import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A card with an icon, a title and a line about what it is for. */
export function SettingsSection({ id, icon: Icon, title, description, children }: { id?: string; icon: LucideIcon; title: string; description: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="mt-6 scroll-mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm shadow-black/5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        <div>
          <h2 id={headingId} className="font-semibold">
            {title}
          </h2>
          <p className="text-sm text-ink-2">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
