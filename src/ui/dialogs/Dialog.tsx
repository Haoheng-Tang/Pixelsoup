import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

interface DialogProps {
  title: string;
  /** Called for Escape and for the browser closing the dialog itself. */
  onCancel: () => void;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}

/**
 * A modal native `<dialog>`, shown while mounted. The parent decides when it's open by
 * mounting and unmounting it. On open, focus goes to the element marked
 * `data-autofocus` (or the browser's default).
 */
export function Dialog({ title, onCancel, role = 'dialog', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    // Browsers may close the dialog without a cancelable `cancel` event (e.g. a second
    // Escape with no user activation in between); treat that as Cancel. The listener is
    // removed before our own close() so that one doesn't count.
    const onClose = () => {
      if (!dialog.open) onCancelRef.current();
    };
    dialog.addEventListener('close', onClose);
    return () => {
      dialog.removeEventListener('close', onClose);
      dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      role={role}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
