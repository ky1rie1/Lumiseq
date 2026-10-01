import { describe, expect, it, vi } from 'vitest';
import { WindowChromeController, type ChromeWindow } from './WindowChromeController';

function fixture() {
  let resize = () => {};
  const unlisten = vi.fn();
  const port: ChromeWindow = {
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async callback => { resize = callback; return unlisten; }),
    minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}), startDragging: vi.fn(async () => {}),
  };
  const change = vi.fn(), error = vi.fn();
  return { port, change, error, unlisten, resize: () => resize(), controller: new WindowChromeController(port, change, error) };
}

describe('native caption lifecycle', () => {
  it('closes through the cancellable close request, never destroy', async () => {
    const f = fixture();
    await f.controller.run('close');
    expect(f.port.close).toHaveBeenCalledOnce();
  });
  it('releases a subscription that resolves after the component unmounts', async () => {
    const f = fixture();
    let resolve!: (unsubscribe: () => void) => void;
    f.port.onResized = () => new Promise(done => { resolve = done; });
    const connecting = f.controller.connect();
    f.controller.dispose();
    resolve(f.unlisten);
    await connecting;
    expect(f.unlisten).toHaveBeenCalledOnce();
    expect(f.change).not.toHaveBeenCalled();
  });
  it('ignores older maximize queries that finish after a resize query', async () => {
    const f = fixture();
    const pending: Array<(value: boolean) => void> = [];
    f.port.isMaximized = () => new Promise(done => pending.push(done));
    const connecting = f.controller.connect();
    await Promise.resolve();
    f.resize();
    pending[1](true);
    await Promise.resolve();
    pending[0](false);
    await connecting;
    expect(f.change.mock.calls).toEqual([[true]]);
    f.controller.dispose();
    expect(f.unlisten).toHaveBeenCalledOnce();
  });
  it('reports rejected native actions instead of leaking a rejected promise', async () => {
    const f = fixture(), failure = new Error('permission denied');
    f.port.minimize = async () => { throw failure; };
    await f.controller.run('minimize');
    expect(f.error).toHaveBeenCalledWith(failure);
  });
  it('does not issue commands or publish state after disposal', async () => {
    const f = fixture();
    await f.controller.connect();
    f.change.mockClear();
    f.controller.dispose();
    f.resize();
    await f.controller.run('close');
    expect(f.port.close).not.toHaveBeenCalled();
    expect(f.change).not.toHaveBeenCalled();
  });
});
