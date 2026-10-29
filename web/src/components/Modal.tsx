import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

/** A dialog over the page: Escape, the cross or a click beside it closes it; the content exists only while it is open. */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  tone = 'accent',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  tone?: 'accent' | 'critical';
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

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
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby={`${id}-heading`}
      className="m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id={`${id}-heading`} className="flex items-center gap-2.5 text-lg font-semibold">
                <span className={tone === 'critical' ? 'grid size-8 place-items-center rounded-lg bg-critical/12 text-critical' : 'grid size-8 place-items-center rounded-lg bg-accent/12 text-accent'}>
                  <Icon className="size-4" aria-hidden />
                </span>
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Schliessen" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-card-2 hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
