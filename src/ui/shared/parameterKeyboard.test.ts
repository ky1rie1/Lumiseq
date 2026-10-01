import { describe, expect, it } from 'vitest';
import { nudgeParameter, shouldNudgeHoveredParameter } from './parameterKeyboard';
import { PARAM_DEFINITIONS } from './parameterDefinitions';

describe('parameter keyboard nudging', () => {
  it('respects handled navigation and focused controls instead of changing a hovered parameter', () => {
    const event={key:'ArrowRight',defaultPrevented:false,ctrlKey:false,metaKey:false,altKey:false,isComposing:false};
    expect(shouldNudgeHoveredParameter(event,'button')).toBe(false);
    expect(shouldNudgeHoveredParameter(event,'input')).toBe(false);
    expect(shouldNudgeHoveredParameter({...event,defaultPrevented:true},null)).toBe(false);
    expect(shouldNudgeHoveredParameter(event,null)).toBe(true);
    expect(shouldNudgeHoveredParameter(event,'input',true)).toBe(true);
  });
  it('uses a repeatable step for arrows, a finer Shift step, and clamps to range', () => {
    const exposure = PARAM_DEFINITIONS.exposure;
    expect(nudgeParameter(0, exposure, 'ArrowRight')).toBe(0.05);
    expect(nudgeParameter(0.05, exposure, 'ArrowRight')).toBe(0.1);
    expect(nudgeParameter(0.1, exposure, 'ArrowLeft', true)).toBe(0.09);
    expect(nudgeParameter(4.99, exposure, 'ArrowUp')).toBe(5);
    expect(nudgeParameter(-5, exposure, 'ArrowDown')).toBe(-5);
  });
});
