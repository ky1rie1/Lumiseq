import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

// No DOM test dependency is installed. Keep the real component and event handlers,
// using a small hook host to advance renders and its effects deterministically.
const hooks = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[],
}));
vi.mock('react', async importOriginal => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[index], (next: unknown) => {
        hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      return hooks.slots[index] ??= { current: initial };
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      if (!previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) {
        hooks.slots[index] = dependencies;
        hooks.effects.push(() => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); });
      }
    },
  };
});

import { ProviderSettingsContent } from '../src/ui/settings/ProviderSettingsContent';
import { defaultProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { defaultCapabilityRouter } from '../src/ai/capabilities/CapabilityRouter';

function render(props: Partial<ComponentProps<typeof ProviderSettingsContent>> = {}) {
  hooks.cursor = 0;
  const tree = ProviderSettingsContent({ isOpen: true, embedded: true, onClose() {}, ...props });
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
function nodes(tree: ReactNode): ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as ReactElement<any>;
  return [element, ...nodes(element.props.children)];
}
function textOf(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' && 'props' in tree ? textOf((tree as ReactElement<any>).props.children) : '';
}
afterEach(() => {
  hooks.cleanups.splice(0).forEach(cleanup => cleanup());
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  vi.restoreAllMocks();
});

it('lets an empty custom service be discarded when switching to another provider', async () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(false);
  render();
  let tree = render();
  nodes(tree).find(node => node.type === 'button' && textOf(node.props.children).includes('添加自定义服务'))!.props.onClick();
  tree = render();
  const target = defaultProviderRegistry.getAllConfigs().find(config => config.type === 'anthropic')!;
  nodes(tree).find(node => node.type === 'button' && textOf(node.props.children).includes(target.name))!.props.onClick();
  tree = render();
  const prompt = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SettingsUnsavedDialog');
  expect(prompt).toBeDefined();
  expect(prompt!.props.open).toBe(true);
  prompt!.props.onDiscard();
  tree = render();
  expect(nodes(tree).some(node => node.type === 'input' && node.props.value === target.name)).toBe(true);
  expect(nodes(tree).some(node => node.type === 'input' && node.props.value === '自定义服务')).toBe(false);
});

it('keeps an invalid custom service draft when save-and-continue fails', async () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(false);
  render();
  let tree = render();
  nodes(tree).find(node => node.type === 'button' && textOf(node.props.children).includes('添加自定义服务'))!.props.onClick();
  tree = render();
  nodes(tree).find(node => node.type === 'button' && textOf(node.props.children).includes('Anthropic'))!.props.onClick();
  tree = render();
  const prompt = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SettingsUnsavedDialog');
  expect(prompt).toBeDefined();
  expect(await prompt!.props.onSave()).toBe(false);
  tree = render();
  expect(nodes(tree).some(node => node.type === 'input' && node.props.value === '自定义服务')).toBe(true);
  expect(textOf(tree)).toContain('请填写模型 ID');
});

it('keeps current provider edits when its sidebar entry is clicked again', () => {
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(false);
  render();
  let tree = render();
  const active = defaultProviderRegistry.getActiveConfig();
  const label = nodes(tree).find(node => node.type === 'label' && textOf(node.props.children).startsWith('服务名称'))!;
  nodes(label.props.children).find(node => node.type === 'input')!.props.onChange({ target: { value: 'Unsaved rename' } });
  tree = render();
  nodes(tree).find(node => node.type === 'button' && node.props['aria-pressed'] && textOf(node.props.children).includes(active.name))!.props.onClick();
  tree = render();
  const prompt = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SettingsUnsavedDialog');
  expect(prompt?.props.open).toBe(false);
  expect(nodes(tree).some(node => node.type === 'input' && node.props.value === 'Unsaved rename')).toBe(true);
});

it('does not delete a custom service or its key when routing cleanup cannot save', async () => {
  const custom = { ...defaultProviderRegistry.getActiveConfig(), id: 'router_delete_regression', name: 'Delete regression' };
  defaultProviderRegistry.saveConfig(custom);
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockResolvedValue(true);
  const eraseKey = vi.spyOn(defaultProviderRegistry, 'setApiKey').mockResolvedValue();
  vi.spyOn(defaultCapabilityRouter, 'saveStackConfig').mockImplementation(() => { throw new Error('routing quota'); });
  try {
    render();
    let tree = render();
    nodes(tree).find(node => node.type === 'button' && textOf(node.props.children).includes(custom.name))!.props.onClick();
    tree = render();
    await nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '删除自定义服务')!.props.onClick();
    expect(defaultProviderRegistry.getConfig(custom.id)).toEqual(custom);
    expect(eraseKey).not.toHaveBeenCalled();
    expect(textOf(render())).toContain('routing quota');
  } finally { if (defaultProviderRegistry.getConfig(custom.id)) defaultProviderRegistry.deleteConfig(custom.id); }
});

it.each([true, false])('refreshes key presence (%s) when saving before the initial vault lookup finishes', async stored => {
  let finishInitialLookup!: (value: boolean) => void;
  const initialLookup = new Promise<boolean>(resolve => { finishInitialLookup = resolve; });
  vi.spyOn(defaultProviderRegistry, 'hasApiKey').mockImplementationOnce(() => initialLookup).mockResolvedValue(stored);
  // Config persistence has separate coverage; this test isolates the vault timing.
  vi.spyOn(defaultProviderRegistry, 'saveConfig').mockImplementation(() => {});
  const tree = render({ embedded: false });
  const save = nodes(tree).find(node => node.type === 'button' && textOf(node.props.children) === '保存连接')!;

  await save.props.onClick();
  finishInitialLookup(stored);
  await initialLookup;
  const updated = render();

  expect(textOf(updated)).toContain(stored ? '已安全保存' : '尚未填写');
  expect(nodes(updated).some(node => node.type === 'button' && textOf(node.props.children) === '移除')).toBe(stored);
});
