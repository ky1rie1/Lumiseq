import {expect,it} from 'vitest';
import {DEFAULT_STUDIO_PREFERENCES} from '../stores/studioPreferences';
import {initialWorkspace,defaultExportOptions} from './preferenceRuntime';
it('uses validated last workspace only when explicitly requested',()=>{
  expect(initialWorkspace(DEFAULT_STUDIO_PREFERENCES,{getItem:()=> 'edit'})).toBe('home');
  expect(initialWorkspace({...DEFAULT_STUDIO_PREFERENCES,startupWorkspace:'last'},{getItem:()=> 'develop'})).toBe('develop');
  expect(initialWorkspace({...DEFAULT_STUDIO_PREFERENCES,startupWorkspace:'last'},{getItem:()=> '{broken'})).toBe('home');
});
it('uses export defaults while retaining original document dimensions',()=>{
  expect(defaultExportOptions({width:6000,height:4000},{...DEFAULT_STUDIO_PREFERENCES,exportFormat:'png',jpegQuality:78})).toEqual({format:'png',quality:78,width:6000,height:4000});
});
