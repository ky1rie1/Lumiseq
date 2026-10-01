import type { ReactNode } from 'react';
import { OverlayModal } from '../shared/OverlayModal';

/** Service settings can keep their own standalone entry without nesting dialogs in the center. */
export function SettingsPageFrame({ embedded, children, ...props }: {
  embedded?: boolean; children: ReactNode; open: boolean; onClose: () => void;
  label: string; className?: string; overlayClassName?: string;
}) {
  return embedded ? <div className={`settings-embedded ${props.className || ''}`}>{children}</div>
    : <OverlayModal {...props}>{children}</OverlayModal>;
}
