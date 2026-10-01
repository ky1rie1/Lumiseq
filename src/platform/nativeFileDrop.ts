import { getPlatformBridge, isTauriEnvironment, type SelectedFile } from './index';

export async function readSelectedNativeFile(path: string): Promise<SelectedFile> {
  const bytes = await getPlatformBridge().readBinaryFile(path);
  return {name:path.split(/[\\/]/).pop() || path,path,sizeBytes:bytes.byteLength,blob:new Blob([new Uint8Array(bytes)])};
}

/** Tauri intercepts OS drops; DOM File.path is neither standard nor reliable. */
export async function listenForNativeFileDrop(
  onPaths: (paths: string[]) => void,
  onHover: (hover: boolean) => void,
): Promise<() => void> {
  if (!isTauriEnvironment()) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent(event => {
    const payload = event.payload;
    onHover(payload.type === 'enter' || payload.type === 'over');
    if (payload.type === 'drop') onPaths(payload.paths);
  });
}
