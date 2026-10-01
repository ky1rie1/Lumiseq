import { describe, expect, it } from 'vitest';
import { RecentProjectsStore } from './recentProjects';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('recent projects', () => {
  it('changes visible limit without deleting stored recent projects', () => {
    const recent=new RecentProjectsStore(memoryStorage(),()=>10);
    for(let n=0;n<18;n++)recent.record(`C:\\Work\\${n}.aistudio`);
    recent.setLimit(5);expect(recent.getAll()).toHaveLength(5);
    recent.setLimit(20);expect(recent.getAll()).toHaveLength(18);
  });
  it('persists only saved local project paths, sorted by recency with path deduplication', () => {
    const storage = memoryStorage();
    const recent = new RecentProjectsStore(storage, () => 10);
    recent.record('C:\\Work\\First.aistudio');
    recent.record('C:\\Work\\second.aistudio');
    recent.record('c:\\work\\FIRST.aistudio');

    expect(new RecentProjectsStore(storage).getAll().map(entry => entry.path)).toEqual([
      'c:\\work\\FIRST.aistudio',
      'C:\\Work\\second.aistudio',
    ]);
    expect(() => recent.record('Untitled-1')).toThrow();
    expect(() => recent.record('C:\\Work\\image.png')).toThrow();
    recent.record('C:\\Work\\Layered.psd');
    expect(recent.getAll()[0].name).toBe('Layered.psd');
    expect(recent.getAll()).toHaveLength(3);
  });

  it('notifies subscribers after recording or removing a project', () => {
    const recent = new RecentProjectsStore(memoryStorage());
    let notifications = 0;
    const unsubscribe = recent.subscribe(() => { notifications += 1; });
    recent.record('C:\\Work\\One.aistudio');
    recent.remove('C:\\Work\\One.aistudio');
    unsubscribe();
    recent.record('C:\\Work\\Two.aistudio');
    expect(notifications).toBe(2);
  });
});
