import { SettingsCenter } from './SettingsCenter';

/** Compatibility entry: appearance now shares the same settings shell. */
export function AppearanceSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return isOpen ? <SettingsCenter isOpen onClose={onClose} initialCategory="appearance" /> : null;
}
