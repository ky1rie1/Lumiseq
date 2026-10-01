import { lazy, Suspense } from 'react';

const SettingsCenter = lazy(() => import('../settings/SettingsCenter').then(module => ({ default: module.SettingsCenter })));

/** AI panel compatibility entry; settings are only loaded while open. */
export function ProviderSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return isOpen ? <Suspense fallback={null}><SettingsCenter isOpen onClose={onClose} initialCategory="ai" /></Suspense> : null;
}
