import {describe,expect,it} from 'vitest';
import {deriveAppearancePolicy} from './appearancePolicy';
import {DEFAULT_STUDIO_PREFERENCES} from './studioPreferences';
describe('appearance runtime policy',()=>{
  it('stops animation when the document is hidden',()=>{
    expect(deriveAppearancePolicy(DEFAULT_STUDIO_PREFERENCES,false,false,false)).toMatchObject({motion:'off',glass:'off'});
  });
  it('keeps the professional surface opaque while honoring system motion',()=>{
    const saved={...DEFAULT_STUDIO_PREFERENCES};
    expect(deriveAppearancePolicy(saved,true,true,true)).toMatchObject({motion:'off',glass:'off'});
    expect(deriveAppearancePolicy(saved,false,false,true)).toMatchObject({motion:'full',glass:'off'});
  });
  it('keeps simplified motion distinct from disabled motion',()=>{
    expect(deriveAppearancePolicy({...DEFAULT_STUDIO_PREFERENCES,motion:'reduced'},false,false,true).motion).toBe('reduced');
  });
});
