import { useEffect, useRef } from 'react';
import { defaultAgentBridge } from '../ai/mcp/AgentBridge';
import { defaultMCPServerManager } from '../ai/mcp/MCPServerManager';
import { listenForNativeFileDrop } from '../platform/nativeFileDrop';
import { getPlatformBridge } from '../platform';

let startup: Promise<void> | undefined;

export function useAppLifecycle(onNativeDrop: (paths:string[])=>void, onHover:(hover:boolean)=>void, onError:(error:unknown)=>void): void {
  const callbacks = useRef({onNativeDrop,onHover,onError});
  callbacks.current = {onNativeDrop,onHover,onError};
  useEffect(() => {
    let disposed = false;
    let stopDrop: (()=>void) | undefined;
    const report = (error:unknown) => { if (!disposed) callbacks.current.onError(error); };
    void defaultAgentBridge.initTauriListener().then(() => {
      if (disposed) return;
      startup ??= defaultMCPServerManager.initOnAppStart();
      return startup;
    }).catch(report);

    // Process Windows CLI startup arguments (e.g. lumiseq.exe <path> or double-click associated file)
    void getPlatformBridge().getStartupArgs().then(args => {
      if (disposed || !args || args.length === 0) return;
      const filePaths = args.filter(arg => !arg.startsWith('-') && !arg.startsWith('/'));
      if (filePaths.length > 0) {
        callbacks.current.onNativeDrop(filePaths);
      }
    }).catch(report);

    void listenForNativeFileDrop(paths => {
      if (!disposed) callbacks.current.onNativeDrop(paths);
    }, hover => { if (!disposed) callbacks.current.onHover(hover); }).then(stop => {
      if (disposed) stop(); else stopDrop=stop;
    }).catch(report);
    return () => {
      disposed = true;
      stopDrop?.();
      defaultAgentBridge.disposeTauriListener();
    };
  }, []);
}
