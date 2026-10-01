import { describe, expect, it } from 'vitest';
import { visibleDevelopSections, nextDevelopGroup } from './developTools';

describe('develop tool navigation', () => {
  it('places white balance only in Color while keeping search available', () => {
    expect(visibleDevelopSections('basic', '')).toEqual(['dev-sec-basic']);
    expect(visibleDevelopSections('color', '')).toContain('dev-sec-wb');
    expect(visibleDevelopSections('basic', '白平衡')).toEqual(['dev-sec-wb']);
    expect(visibleDevelopSections('local', '')).toEqual(['dev-sec-masks']);
  });
  it('searches all groups and parameter aliases with every term', () => {
    expect(visibleDevelopSections('basic', ' chroma 降噪 ')).toEqual(['dev-sec-detail']);
    expect(visibleDevelopSections('local', '去雾')).toEqual(['dev-sec-presence']);
    expect(visibleDevelopSections('basic', 'exposure')).toEqual(['dev-sec-basic']);
    expect(visibleDevelopSections('basic', '不存在')).toEqual([]);
  });
  it('supports arrow wraparound and Home/End', () => {
    expect(nextDevelopGroup('basic', 'ArrowLeft')).toBe('looks');
    expect(nextDevelopGroup('looks', 'ArrowRight')).toBe('basic');
    expect(nextDevelopGroup('detail', 'Home')).toBe('basic');
    expect(nextDevelopGroup('detail', 'End')).toBe('looks');
    expect(nextDevelopGroup('detail', 'Tab')).toBeNull();
  });
});
