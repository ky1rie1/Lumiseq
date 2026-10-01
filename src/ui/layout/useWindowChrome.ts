import { useEffect, useRef, useState } from 'react';
import { isTauriEnvironment } from '../../platform';
import { useAppStore } from '../../stores/useAppStore';
import { WindowChromeController, type WindowCommand } from './WindowChromeController';

export function useWindowChrome() {
  const native = isTauriEnvironment();
  const [maximized, setMaximized] = useState(false);
  const controller = useRef<WindowChromeController | null>(null);
  const setStatus = useAppStore(s => s.setStatusMessage);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    const report = (error: unknown) => {
      if (!cancelled) setStatus(`窗口操作失败：${error instanceof Error ? error.message : String(error)}`);
    };
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (cancelled) return;
      const instance = new WindowChromeController(getCurrentWindow(), setMaximized, report);
      controller.current = instance;
      void instance.connect();
    }).catch(report);
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, [native, setStatus]);

  const run = (command: WindowCommand) => { void controller.current?.run(command); };
  return { native, maximized, run };
}
