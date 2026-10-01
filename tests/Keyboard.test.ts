import {it,expect,vi} from 'vitest';
import {handleHistoryShortcut} from '../src/app/keyboard';
it('leaves text editing shortcuts to inputs and contenteditable descendants',()=>{
  for(const tag of ['INPUT','TEXTAREA','SELECT','contenteditable']) {
    const undo=vi.fn();const preventDefault=vi.fn();
    handleHistoryShortcut({key:'z',ctrlKey:true,target:{closest:()=>({tag})},preventDefault} as any,undo,vi.fn());
    expect(undo).not.toHaveBeenCalled();expect(preventDefault).not.toHaveBeenCalled();
  }
});
it('undoes and redoes canvas edits and prevents default only for shortcuts',()=>{
  const undo=vi.fn();const redo=vi.fn();const preventDefault=vi.fn();
  const event={key:'z',ctrlKey:true,target:{closest:()=>null},preventDefault};
  handleHistoryShortcut(event as any,undo,redo);
  handleHistoryShortcut({...event,shiftKey:true} as any,undo,redo);
  expect(undo).toHaveBeenCalledOnce();expect(redo).toHaveBeenCalledOnce();expect(preventDefault).toHaveBeenCalledTimes(2);
});
