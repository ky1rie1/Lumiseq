export function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return !!element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}

export function handleHistoryShortcut(event: KeyboardEvent, undo: () => unknown, redo: () => unknown): void {
  if (event.defaultPrevented || event.isComposing || isTextEditingTarget(event.target) || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'z' || key === 'y') {
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redo(); else undo();
  }
}
