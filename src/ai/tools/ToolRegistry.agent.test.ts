import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './ToolRegistry';

describe('agent tool catalog', () => {
  it('advertises one parameter tool for RAW adjustments while keeping direct API aliases callable', () => {
    const registry = new ToolRegistry();
    const names = registry.getForAgent('develop').map(tool => tool.schema.name);
    expect(names).toContain('develop_set_parameter');
    expect(names).not.toContain('develop_set_exposure');
    expect(names).not.toContain('develop_set_contrast');
    expect(registry.get('develop_set_exposure')).toBeDefined();
    expect(names).toContain('get_develop_settings');
  });
});
