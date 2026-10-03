import { describe, expect, it } from 'vitest';
import * as gestures from './toolGestures';
const intent = (input: object) => (gestures as any).canvasPointerIntent?.(input);
describe('canvas pointer routing', () => {
 it.each(['zoom','hand','brush'])('routes right button %s to context before capture', tool => {
  expect(intent({button:2,tool,space:false})).toBe('context');
  expect(intent({button:2,tool,space:true})).toBe('context');
 });
 it('retains left tool actions and middle/space pan', () => {
  expect(intent({button:0,tool:'zoom',space:false})).toBe('zoom');
  expect(intent({button:0,tool:'brush',space:false})).toBe('tool');
  expect(intent({button:1,tool:'brush',space:false})).toBe('pan');
  expect(intent({button:0,tool:'brush',space:true})).toBe('pan');
 });
});
