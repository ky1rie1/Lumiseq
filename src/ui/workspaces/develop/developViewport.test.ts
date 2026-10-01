import { describe, expect, it } from 'vitest';
import { fitDevelopScale, zoomDevelopAt, developViewShortcut, shouldIgnoreDevelopNavigation, shouldResetDevelopView } from './developViewport';

describe('develop canvas navigation', () => {
  it('preserves navigation across a temporarily inactive document and resets for a different photo', () => {
    expect(shouldResetDevelopView(undefined, 'raw-a')).toBe(false);
    expect(shouldResetDevelopView('raw-a', 'raw-a')).toBe(false);
    expect(shouldResetDevelopView('raw-b', 'raw-a')).toBe(true);
    expect(shouldResetDevelopView('raw-a', undefined)).toBe(true);
  });
  it('does not handle editor shortcuts while its retained workspace is inactive', () => {
    const event={defaultPrevented:false,isComposing:false,code:'Equal',target:null} as unknown as KeyboardEvent;
    expect(shouldIgnoreDevelopNavigation(event,false,false)).toBe(true);
  });
  it('fits actual source dimensions without upscaling small photos', () => {
    expect(fitDevelopScale(6000, 4000, 600, 500)).toBeCloseTo(.092);
    expect(fitDevelopScale(100, 80, 600, 500)).toBe(1);
    expect(fitDevelopScale(0, 100, 600, 500)).toBe(1);
  });
  it('keeps the image point under the pointer when zooming', () => {
    const old={scale:.5,x:20,y:-10};
    const next=zoomDevelopAt(old,1,{x:120,y:40});
    expect((120-next.x)/next.scale).toBe((120-old.x)/old.scale);
    expect((40-next.y)/next.scale).toBe((40-old.y)/old.scale);
  });
  it('limits extreme and invalid zoom without corrupting pan', () => {
    expect(zoomDevelopAt({scale:1,x:0,y:0},100,{x:0,y:0}).scale).toBe(16);
    expect(zoomDevelopAt({scale:1,x:0,y:0},NaN,{x:0,y:0})).toEqual({scale:1,x:0,y:0});
  });
  it.each([['=',false,'in'],['+',true,'in'],['-',false,'out'],['0',false,'fit'],['1',false,'actual']])('matches Photoshop Ctrl %s', (key,shift,action) => {
    expect(developViewShortcut({key,ctrlKey:true,metaKey:false,altKey:false,shiftKey:shift})).toBe(action);
  });
  it('keeps history shortcuts separate from the zoom tool', () => {
    const event={key:'z',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false};
    expect(developViewShortcut(event)).toBe('zoom');
    expect(developViewShortcut({...event,ctrlKey:true})).toBe(null);
    expect(developViewShortcut({...event,key:'h'})).toBe('hand');
    expect(developViewShortcut({...event,key:'+',altKey:true})).toBe(null);
  });
  it('protects modal windows and keyboard activation of focused buttons', () => {
    const event={defaultPrevented:false,isComposing:false,code:'Space',target:{closest:(selector:string)=>selector.includes('button')?{}:null}} as unknown as KeyboardEvent;
    expect(shouldIgnoreDevelopNavigation(event,false)).toBe(true);
    expect(shouldIgnoreDevelopNavigation({...event,code:'Equal'},true)).toBe(true);
    expect(shouldIgnoreDevelopNavigation({...event,code:'Equal'},false)).toBe(false);
  });
});
