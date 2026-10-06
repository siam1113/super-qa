'use client';

import { cloneElement, isValidElement, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Video, X } from 'lucide-react';

export const fieldClass = 'ui-field w-full px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent-blue';
export const primaryClass = 'ui-button-primary text-sm font-medium disabled:opacity-40';
export const secondaryClass = 'ui-button-secondary text-sm disabled:opacity-40';

export function ChatDialog({ title, children, onClose, wide = false, compact = false, callSetup = false, immersive = false, bare = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; compact?: boolean; callSetup?: boolean; immersive?: boolean; bare?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} className={(immersive ? 'h-[min(92vh,820px)] w-[min(96vw,1280px)] ' : wide ? 'w-[min(96vw,1200px)] ' : callSetup ? 'w-[min(94vw,1080px)] ' : compact ? 'w-[min(94vw,760px)] ' : 'w-[min(94vw,620px)] ') + 'ui-dialog-panel m-auto max-w-none max-h-[92vh] p-0 text-text-primary backdrop:bg-black/65'} aria-label={title}>
    {!immersive && !bare && <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close dialog" onClick={onClose} className="rounded-lg p-2 hover:bg-elevated"><X size={18} /></button></div>}
    <div className={immersive ? 'h-full min-h-0' : bare ? '' : 'space-y-5 p-6'}>{children}</div>
  </dialog>;
}

export function CallSkeleton({ label }: { label: string }) {
  return <div className="call-skeleton" role="status">
    <span className="call-skeleton-mark" aria-hidden="true"><Video size={24} /></span>
    <div className="call-skeleton-bars" aria-hidden="true"><span className="call-skeleton-bar" /><span className="call-skeleton-bar" /></div>
    <p className="call-skeleton-label">{label}</p>
  </div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const generatedId = useId();
  const control = isValidElement<{ id?: string }>(children) ? children : null;
  const id = control?.props.id || generatedId;
  return <div className="space-y-2 text-sm font-medium"><label htmlFor={id} className="block">{label}</label>{control ? cloneElement(control, { id }) : children}</div>;
}

/**
 * A password-style field. When `onReveal` is provided and the field starts empty
 * (editing an already-saved secret), the eye icon fetches the real saved value on
 * first click instead of toggling visibility of nothing — the field shows a dotted
 * placeholder until then so it reads as "a value is set", not "this is empty".
 */
export function SecretField({ id: providedId, value, onChange, placeholder, required = false, autoComplete = 'off', onReveal }: { id?: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; autoComplete?: string; onReveal?: () => Promise<string> }) {
  const [visible, setVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const generatedId = useId();
  const id = providedId || generatedId;

  const toggle = async () => {
    if (!visible && onReveal && !value) {
      setRevealing(true); setRevealError('');
      try { onChange(await onReveal()); setVisible(true); }
      catch { setRevealError('Could not load the saved value.'); }
      finally { setRevealing(false); }
      return;
    }
    setVisible(current => !current);
  };

  return <div>
    <div className="relative">
      <input
        id={id}
        required={required}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={fieldClass + ' pr-9'}
        value={value}
        onChange={event => { onChange(event.target.value); setRevealError(''); }}
        placeholder={onReveal && !value ? '••••••••••••••••' : placeholder}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={revealing}
        aria-label={visible ? 'Hide value' : onReveal && !value ? 'Reveal saved value' : 'Show value'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-text-secondary transition-colors hover:bg-elevated hover:text-text-primary disabled:opacity-50"
      >
        {revealing ? <Loader2 size={15} className="animate-spin" /> : visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
    {revealError && <p className="mt-1 text-[11px] text-danger">{revealError}</p>}
  </div>;
}

/**
 * A labeled, bordered group for related fields — the one visual shape every
 * credentials/config block in the Integrations modals should use, instead of each
 * modal inventing its own box styling.
 */
export function FieldSection({ icon, label, hint, children }: { icon?: ReactNode; label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="space-y-3 rounded-xl border border-border bg-canvas p-4">
    <div className="flex items-center gap-2">{icon}<p className="text-sm font-medium text-text-primary">{label}</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    {hint && <p className="flex items-start gap-2 text-xs leading-5 text-text-secondary">{hint}</p>}
  </div>;
}
