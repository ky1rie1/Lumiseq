import { describe, expect, it } from 'vitest';
import * as model from './contextMenuModel';
const api = model as any;
describe('context menu boundaries', () => {
 it('fits a scrollable menu into all four viewport corners', () => {
  expect(api.menuPosition).toBeTypeOf('function');
  for(const anchor of [{x:0,y:0},{x:800,y:0},{x:0,y:600},{x:800,y:600}]) {
   const p=api.menuPosition(anchor,{width:240,height:320},{width:800,height:600});
   expect(p.left).toBeGreaterThanOrEqual(6);expect(p.top).toBeGreaterThanOrEqual(6);
   expect(p.left+240).toBeLessThanOrEqual(794);expect(p.top+320).toBeLessThanOrEqual(594);
  }
 });
 it('rejects empty, nonnumeric and out of range clipboard values', () => {
  expect(api.parseMenuNumber).toBeTypeOf('function');
  for(const text of ['', ' ', '2abc', 'NaN','Infinity','1001', '0x10', '0b11']) expect(api.parseMenuNumber(text,0,1000)).toBeNull();
  expect(api.parseMenuNumber(' 12.5 ',0,1000)).toBe(12.5);
 });
 it('flips a submenu beside its parent without covering the parent', () => {
  expect(api.menuPosition({x:790,y:40,parentLeft:550},{width:220,height:100},{width:800,height:600},true).left).toBe(332);
 });
 it('never executes disabled menu items', async () => {
  expect(api.executeMenuItem).toBeTypeOf('function');
  let writes=0;await api.executeMenuItem({id:'x',label:'x',disabled:true,run:()=>writes++});
  expect(writes).toBe(0);
 });
});
