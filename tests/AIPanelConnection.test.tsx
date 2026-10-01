import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const host = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async load => {
  const original = await load<typeof import('react')>();
  return { ...original,
    useState(initial: unknown) { const i = host.cursor++; if (!(i in host.slots)) host.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [host.slots[i], (next: unknown) => { host.slots[i] = typeof next === 'function' ? next(host.slots[i]) : next; }]; },
    useRef(initial: unknown) { return host.slots[host.cursor++] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = host.cursor++, old = host.slots[i];
      if (!old || deps.some((v, n) => !Object.is(v, old[n]))) {
        host.slots[i] = deps; host.effects.push(() => { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup); });
      }
    },
  };
});
vi.mock('../src/stores/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ isAiPanelOpen: true, currentWorkspace: 'edit', toggleAiPanel() {} }) }));
vi.mock('../src/stores/useAppearanceStore', () => ({ useAppearanceStore: (select: (state: unknown) => unknown) => select({ reduceMotion: false }) }));
vi.mock('../src/ui/shared/useDocuments', () => ({ useDocuments: () => ({ activeDocument: defaultDocumentManager.getActiveDocument() }) }));

import { AIPanel } from '../src/ui/ai/AIPanel';
import { defaultProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { defaultAgentRuntime } from '../src/ai/runtime/AgentRuntime';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { createEditDocument } from '../src/document/EditDocument';
import type { StudioActionHandlers } from '../src/app/studioActions';

function render() {
  host.cursor = 0;
  const tree = AIPanel({ actions: { openFile() {}, createCanvas() {} } as unknown as StudioActionHandlers });
  host.effects.splice(0).forEach(effect => effect()); return tree;
}
function nodes(tree: ReactNode): ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as ReactElement<any>; return [element, ...nodes(element.props.children)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as ReactElement<any>).props.children) : '';
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); return render(); }
function draft(tree: ReactNode) { return nodes(tree).find(n => n.type === 'textarea')!; }
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout });
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(false);
  defaultDocumentManager.openDocument(createEditDocument({ id: 'panel-test', name: 'Panel test', width: 400, height: 300, layers: [] }));
});
afterEach(() => {
  host.cleanups.splice(0).forEach(cleanup => cleanup()); host.slots = []; host.cursor = 0; host.effects = [];
  defaultDocumentManager.closeDocument('panel-test'); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('shows an unconnected state without leaking the default preset into the header or composer', async () => {
  render(); const tree = await settle();
  expect(text(tree)).toContain('未连接 AI'); expect(text(tree)).not.toContain('gpt-4o');
  expect(draft(tree).props.disabled).toBe(false);
});

it('keeps a disconnected draft on Enter and opens connection settings without starting a run', async () => {
  let attempts = 0;
  vi.spyOn(defaultAgentRuntime, 'run').mockImplementation(async () => { attempts++; throw new Error('Should not run'); });
  render(); let tree = await settle(); draft(tree).props.onChange({ target: { value: '保留主体' } }); tree = render();
  await draft(tree).props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} });
  tree = await settle(); expect(attempts).toBe(0); expect(draft(tree).props.value).toBe('保留主体');
  expect(nodes(tree).some(n => typeof n.type === 'function' && n.type.name === 'ProviderSettingsModal' && n.props.isOpen)).toBe(true);
});

it('restores a draft and shows an inline error when starting a configured run fails', async () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(true);
  vi.spyOn(defaultAgentRuntime, 'run').mockRejectedValue(new Error('Provider rejected request'));
  render(); let tree = await settle(); draft(tree).props.onChange({ target: { value: '整理排版' } }); tree = render();
  await nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '发送指令')!.props.onClick();
  tree = await settle(); expect(draft(tree).props.value).toBe('整理排版'); expect(text(tree)).toContain('Provider rejected request');
});

it('rechecks credentials when a formerly enabled send button is used after key removal', async () => {
  const key = vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(true);
  let attempts = 0;
  vi.spyOn(defaultAgentRuntime, 'run').mockImplementation(async () => { attempts++; throw new Error('Should not run'); });
  render(); let tree = await settle(); draft(tree).props.onChange({ target: { value: '检查图像' } }); tree = render();
  key.mockResolvedValue(false);
  await nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '发送指令')!.props.onClick();
  tree = await settle(); expect(attempts).toBe(0); expect(draft(tree).props.value).toBe('检查图像');
});

it('serializes two rapid submissions during the async readiness check', async () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(true);
  let attempts = 0;
  vi.spyOn(defaultAgentRuntime, 'run').mockImplementation(async () => { attempts++; throw new Error('Fixture rejection'); });
  render(); let tree = await settle(); draft(tree).props.onChange({ target: { value: '检查图像' } }); tree = render();
  const send = nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '发送指令')!.props.onClick;
  await Promise.all([send(), send()]); expect(attempts).toBe(1);
});

it('does not submit to a provider changed during the async readiness check', async () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(true);
  let attempts = 0;
  vi.spyOn(defaultAgentRuntime, 'run').mockImplementation(async () => { attempts++; throw new Error('Should not run'); });
  render(); let tree = await settle(); draft(tree).props.onChange({ target: { value: '检查图像' } }); tree = render();
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>(done => { resolve = done; });
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockImplementation(() => pending);
  const sending = nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '发送指令')!.props.onClick();
  const saved = defaultProviderRegistry.getActiveConfig();
  defaultProviderRegistry.saveConfig({ ...saved, model: 'replacement' }); resolve(true);
  await sending;
  expect(attempts).toBe(0); expect(draft(render()).props.value).toBe('检查图像');
  defaultProviderRegistry.saveConfig(saved);
});

it('ignores an old configured result after a newer unconfigured result has arrived', async () => {
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>(done => { resolve = done; });
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockImplementationOnce(() => pending).mockResolvedValue(false);
  render();
  const saved = defaultProviderRegistry.getActiveConfig();
  defaultProviderRegistry.saveConfig({ ...saved });
  let tree = await settle(); expect(text(tree)).not.toContain('gpt-4o');
  resolve(true); tree = await settle();
  expect(text(tree)).toContain('未连接 AI'); expect(text(tree)).not.toContain('gpt-4o');
  defaultProviderRegistry.saveConfig(saved);
});
