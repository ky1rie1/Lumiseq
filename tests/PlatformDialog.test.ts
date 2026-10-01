import {it,expect,vi,afterEach} from 'vitest';
const native=vi.hoisted(()=>({open:vi.fn(),save:vi.fn(),invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-dialog',()=>({open:native.open,save:native.save}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {TauriPlatformBridge} from '../src/platform/TauriPlatformBridge';
afterEach(()=>vi.clearAllMocks());
it('distinguishes cancellation from native open and save failures',async()=>{
  const bridge=new TauriPlatformBridge();
  native.open.mockResolvedValueOnce(null);expect(await bridge.openFileDialog()).toBeNull();
  native.open.mockRejectedValueOnce(Error('denied'));await expect(bridge.openFileDialog()).rejects.toThrow('denied');
  native.save.mockRejectedValueOnce(Error('save denied'));await expect(bridge.saveFileDialog()).rejects.toThrow('save denied');
});
