import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';

export function handleModalCancel(event: Pick<Event, 'preventDefault'>, onClose: () => void, dismissible = true): void {
  // Keep the native dialog in sync with its controlled React open state.
  event.preventDefault();
  if (dismissible) onClose();
}

/** Native dialog supplies focus containment, Escape handling and focus restoration. */
export function Modal({ open, onClose, title, children, dismissible = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const trapFocus = useFocusTrap(ref);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  // showModal() makes the rest of the document inert, but a Tab on the last control still drops
  // focus to <body>; the shared trap keeps the focus ring inside the panel.
  return <dialog ref={ref} className="studio-dialog glass-surface" aria-label={title} onCancel={event => handleModalCancel(event, onClose, dismissible)} onKeyDown={trapFocus}
    onClick={event => { if (dismissible && event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" disabled={!dismissible} onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
    {children}
  </dialog>;
}
