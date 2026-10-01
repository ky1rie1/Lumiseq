import { Copy, Minus, Square, X } from 'lucide-react';
import type { WindowCommand } from './WindowChromeController';

export function WindowControls({ maximized, run }: {
  maximized: boolean;
  run: (command: WindowCommand) => void;
}) {
  return <div className="window-controls" role="group" aria-label="窗口控制">
    <button type="button" aria-label="最小化窗口" title="最小化" onClick={() => run('minimize')}><Minus size={15} /></button>
    <button type="button" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={() => run('toggleMaximize')}>
      {maximized ? <Copy size={13} /> : <Square size={13} />}
    </button>
    <button type="button" className="window-close" aria-label="关闭窗口" title="关闭" onClick={() => run('close')}><X size={16} /></button>
  </div>;
}
