import {it,expect,vi,afterEach} from 'vitest';
const native = vi.hoisted(() => ({listen:vi.fn(),invoke:vi.fn().mockResolvedValue(undefined)}));
vi.mock('@tauri-apps/api/event',()=>({listen:native.listen}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {AgentBridge} from '../src/ai/mcp/AgentBridge';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it('concurrent setup has one subscriber and disposal releases it',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
  const unlisten=vi.fn();native.listen.mockResolvedValue(unlisten);
  const bridge=new AgentBridge();
  await Promise.all([bridge.initTauriListener(),bridge.initTauriListener()]);
  expect(native.listen).toHaveBeenCalledTimes(1);
  bridge.disposeTauriListener();
  expect(unlisten).toHaveBeenCalledTimes(1);
});
it('disposes a subscription whose asynchronous setup completes after unmount',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
  let complete!: (unlisten:()=>void)=>void;
  native.listen.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const bridge=new AgentBridge();const pending=bridge.initTauriListener();
  await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
  bridge.disposeTauriListener();const unlisten=vi.fn();complete(unlisten);await pending;
  expect(unlisten).toHaveBeenCalledOnce();
});
it('can remount while an old subscription is pending without leaking either listener',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
  const completions: Array<(unlisten:()=>void)=>void>=[];
  native.listen.mockImplementation(()=>new Promise(resolve=>{completions.push(resolve);}));
  const bridge=new AgentBridge();const oldSetup=bridge.initTauriListener();
  await vi.waitFor(()=>expect(completions).toHaveLength(1));
  bridge.disposeTauriListener();const newSetup=bridge.initTauriListener();
  await vi.waitFor(()=>expect(completions).toHaveLength(2));
  const oldStop=vi.fn(),newStop=vi.fn();
  completions[0](oldStop);completions[1](newStop);await Promise.all([oldSetup,newSetup]);
  expect(oldStop).toHaveBeenCalledOnce();expect(newStop).not.toHaveBeenCalled();
  bridge.disposeTauriListener();expect(newStop).toHaveBeenCalledOnce();
});
