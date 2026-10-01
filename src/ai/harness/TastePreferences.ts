export interface TastePreference { id: string; text: string; updatedAt: number }
type Domain = 'photo' | 'layout';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Stored { version: 1; photo: TastePreference[]; layout: TastePreference[] }
const KEY = 'lumiseq.taste.v1';
const EMPTY = (): Stored => ({ version: 1, photo: [], layout: [] });
const MAX_PER_DOMAIN = 12;
let serial = 0;

function validEntry(value: unknown): value is TastePreference {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TastePreference>;
  return typeof entry.id === 'string' && entry.id.length <= 80 && typeof entry.text === 'string'
    && entry.text.length > 0 && entry.text.length <= 160 && Number.isFinite(entry.updatedAt);
}

/** Preferences are app-local and independent of image project dirty state. */
export class TastePreferences {
  private data: Stored;
  private approvals = new Set<object>();
  private storage: StoragePort;
  constructor(storage?: StoragePort) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    try {
      const value = JSON.parse(this.storage.getItem(KEY) ?? 'null');
      this.data = value?.version === 1 && ['photo', 'layout'].every(domain =>
        Array.isArray(value[domain]) && value[domain].length <= MAX_PER_DOMAIN && value[domain].every(validEntry)) ? value : EMPTY();
    } catch { this.data = EMPTY(); }
  }
  get(domain: Domain): TastePreference[] { return this.data[domain].map(item => ({ ...item })); }
  beginUserFeedback(): object { const approval = {}; this.approvals.add(approval); return approval; }
  recordModelEvaluation(_domain: Domain, _text: string): false { return false; }
  private consume(approval: object | undefined): void {
    if (!approval || !this.approvals.delete(approval)) throw new Error('Explicit user feedback required');
  }
  private persist(): void { this.storage.setItem(KEY, JSON.stringify(this.data)); }
  private validateText(text: string): string {
    const normalized = text.trim();
    if (!normalized || normalized.length > 160 || /\b(?:set|increase|decrease)\s+(?:exposure|contrast|opacity|temperature)\b|(?:设置|增加|降低)\s*(?:曝光|对比度|不透明度|色温)|[-+]?\d+(?:\.\d+)?\s*(?:EV|K|%)/i.test(normalized))
      throw new Error('A style preference must describe taste, not a technical edit');
    return normalized;
  }
  save(domain: Domain, text: string, approval?: object): TastePreference {
    this.consume(approval);
    const item = { id: `taste_${Date.now()}_${++serial}`, text: this.validateText(text), updatedAt: Date.now() };
    this.data[domain] = [...this.data[domain], item].slice(-MAX_PER_DOMAIN); this.persist(); return { ...item };
  }
  edit(domain: Domain, id: string, text: string, approval?: object): void {
    this.consume(approval); const value = this.validateText(text);
    if (!this.data[domain].some(item => item.id === id)) throw new Error('Preference not found');
    this.data[domain] = this.data[domain].map(item => item.id === id ? { ...item, text: value, updatedAt: Date.now() } : item); this.persist();
  }
  clear(domain: Domain, approval?: object): void { this.consume(approval); this.data[domain] = []; this.persist(); }
  remove(domain: Domain, id: string, approval?: object): void {
    this.consume(approval); this.data[domain] = this.data[domain].filter(item => item.id !== id); this.persist();
  }
}

export const defaultTastePreferences = new TastePreferences();
