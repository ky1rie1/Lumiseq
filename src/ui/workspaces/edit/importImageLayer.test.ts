import { describe, it, expect, vi } from 'vitest';
import { prepareImageLayer } from './importImageLayer';
import { AssetManager } from '../../../assets/AssetManager';
describe('image layer import', () => {
  it('uses decoded portrait dimensions even if the handle has no dimensions', async () => {
    const assets = new AssetManager();
    const result = await prepareImageLayer(new Blob(['image']), 'portrait.png', {assets, decode:async()=>({width:613,height:1201}), load:vi.fn()});
    expect(result).toMatchObject({width:613,height:1201});
  });
  it('releases a new asset after decoding fails', async () => {
    const assets = new AssetManager();
    await expect(prepareImageLayer(new Blob(['bad']), 'bad.png', {assets, decode:async()=>{throw new Error('decode failed')}, load:vi.fn()})).rejects.toThrow('decode failed');
    expect(assets.listAssets()).toHaveLength(0);
  });
});
