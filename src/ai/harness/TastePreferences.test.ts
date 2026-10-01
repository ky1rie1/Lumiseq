import { expect, it } from 'vitest';
import { TastePreferences } from './TastePreferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

it('saves, edits, and clears only explicit user feedback by domain', () => {
  const storage = memoryStorage();
  const preferences = new TastePreferences(storage);
  expect(preferences.recordModelEvaluation('photo', 'dramatic')).toBe(false);
  expect(preferences.get('photo')).toEqual([]);
  const consent = preferences.beginUserFeedback();
  preferences.save('photo', 'Keep skin tones natural', consent);
  preferences.save('layout', 'Use generous title spacing', preferences.beginUserFeedback());
  const photoId = preferences.get('photo')[0].id;
  preferences.edit('photo', photoId, 'Keep skin tones realistic', preferences.beginUserFeedback());
  expect(preferences.get('photo').map(item => item.text)).toEqual(['Keep skin tones realistic']);
  expect(preferences.get('layout').map(item => item.text)).toEqual(['Use generous title spacing']);
  preferences.clear('photo', preferences.beginUserFeedback());
  expect(preferences.get('photo')).toEqual([]);
  expect(new TastePreferences(storage).get('layout')).toHaveLength(1);
});

it('rejects technical prose and invalid stored data instead of treating it as taste', () => {
  const storage = memoryStorage();
  const preferences = new TastePreferences(storage);
  expect(() => preferences.save('photo', 'set exposure to +0.5 EV', preferences.beginUserFeedback())).toThrow();
  expect(() => preferences.save('photo', 'cinematic', undefined)).toThrow();
  storage.setItem('lumiseq.taste.v1', JSON.stringify({ version: 999, photo: [{ text: 'bad' }] }));
  expect(new TastePreferences(storage).get('photo')).toEqual([]);
});
