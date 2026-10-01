import { describe, expect, it } from 'vitest';
import { curveToCss, cssToCurve, hitCurvePoint, moveCurvePoint, numericCurveValue, numericCurvePosition, startCurvePointer } from '../src/ui/workspaces/develop/curveCoordinates';

describe('precise curve coordinates', () => {
  const points = [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }];
  it('uses CSS pixels for a nonsquare graph and a round ten-pixel hit area', () => {
    expect(curveToCss({ x: .5, y: .5 }, 274, 190)).toEqual({ x: 137, y: 95 });
    expect(cssToCurve({ x: 137, y: 95 }, 274, 190)).toEqual({ x: .5, y: .5 });
    expect(hitCurvePoint(points, { x: 137, y: 104 }, 274, 190)).toBe(1);
    expect(hitCurvePoint(points, { x: 145, y: 103 }, 274, 190)).toBeNull();
    expect(cssToCurve({ x: -20, y: 999 }, 274, 190)).toEqual({ x: 0, y: 0 });
  });
  it('validates numeric 0–255 inputs including nonfinite values', () => {
    expect(numericCurveValue(255)).toBe(1);
    expect(numericCurveValue(128)).toBeCloseTo(.5019607843);
    for (const value of [-1, 256, NaN, Infinity]) expect(() => numericCurveValue(value)).toThrow();
  });
  it('fixes endpoint X and clamps interior X strictly between adjacent points', () => {
    expect(moveCurvePoint(points, 0, { x: .4, y: .2 })[0]).toEqual({ x: 0, y: .2 });
    expect(moveCurvePoint(points, 2, { x: .4, y: 2 })[2]).toEqual({ x: 1, y: 1 });
    expect(moveCurvePoint(points, 1, { x: 1, y: -.2 })[1]).toEqual({ x: 254 / 255, y: 0 });
    const dense = [{ x: 0, y: 0 }, { x: .001, y: .2 }, { x: .002, y: .4 }, { x: 1, y: 1 }];
    const moved = moveCurvePoint(dense, 1, { x: 1, y: .6 });
    expect(moved[1].x).toBeGreaterThan(0);
    expect(moved[1].x).toBeLessThan(.002);
    expect(points[1]).toEqual({ x: .5, y: .5 });
  });
  it('preserves legacy bounded endpoint positions rather than migrating the recipe', () => {
    expect(moveCurvePoint([{ x: .1, y: .2 }, { x: .9, y: .8 }], 0, { x: 0, y: .3 })[0]).toEqual({ x: .1, y: .3 });
  });
  it('preserves precise untouched coordinates when submitting rounded numeric displays', () => {
    expect(numericCurvePosition({ x: .5, y: .5 }, { x: '128', y: '128' })).toEqual({ x: .5, y: .5 });
    expect(numericCurvePosition({ x: .5, y: .5 }, { x: '128', y: '204' })).toEqual({ x: .5, y: .8 });
    expect(() => numericCurvePosition({ x: .5, y: .5 }, { x: '', y: '20' })).toThrow();
  });
  it.each([{ top: 400.719, scrolledTop: 436.719 }, { top: 568, scrolledTop: 500.7 }])('selects the visible midpoint without focus scrolling a clipped graph at $top', ({ top, scrolledTop }) => {
    let canvasTop = top;
    const canvas = {
      getBoundingClientRect: () => ({ left: 981.333, top: canvasTop, width: 267, height: 190 }),
      focus: (options?: FocusOptions) => { if (!options?.preventScroll) canvasTop = scrolledTop; },
    };
    const { css, coord, box } = startCurvePointer(canvas, { x: 1114.833, y: top + 95 });
    expect(canvasTop).toBe(top);
    expect(css.x).toBeCloseTo(133.5, 8);
    expect(css.y).toBe(95);
    expect(coord.x).toBeCloseTo(.5, 8);
    expect(coord.y).toBe(.5);
    expect(hitCurvePoint(points, css, box.width, box.height)).toBe(1);
  });
  it('does not move a close interior X when submitting only Y or pressing a vertical arrow', () => {
    const close = [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .5006857036, y: .71517319 }, { x: 1, y: 1 }];
    const numeric = numericCurvePosition(close[2], { x: '128', y: '204' });
    expect(moveCurvePoint(close, 2, numeric)[2]).toEqual({ x: .5006857036, y: .8 });
    const vertical = moveCurvePoint(close, 2, { x: .5006857036, y: .719094758627451 });
    expect(vertical[2]).toEqual({ x: .5006857036, y: .719094758627451 });
    const horizontal = moveCurvePoint(close, 2, { x: .4, y: .71517319 });
    expect(horizontal[2].x).toBeGreaterThan(.5);
    expect(horizontal[2].x).toBeLessThan(1);
  });
});
