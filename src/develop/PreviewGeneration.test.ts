import { expect, it } from 'vitest';
import { PreviewGeneration } from './PreviewGeneration';
it('rejects late results after settings or document change', async () => {
 const gate = new PreviewGeneration(); const old = gate.begin(); const next = gate.begin();
 expect(old()).toBe(false); expect(next()).toBe(true); gate.cancel(); expect(next()).toBe(false);
});
