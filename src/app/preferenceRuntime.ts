import type {StudioPreferences} from '../stores/studioPreferences';
import type {WorkspaceType} from '../types/common';
import type {ImageExportOptions} from './ImageExportService';
export const LAST_WORKSPACE_KEY='yingxu_last_workspace';
export function initialWorkspace(preferences:StudioPreferences,storage?:Pick<Storage,'getItem'>):WorkspaceType {
  if(preferences.startupWorkspace!=='last')return 'home';
  try {const saved=storage?.getItem(LAST_WORKSPACE_KEY);return saved==='edit'||saved==='develop'?saved:'home';}catch{return 'home';}
}
export function defaultExportOptions(document:{width:number;height:number;cropRect?:{x:number;y:number;width:number;height:number}|null},preferences:StudioPreferences):ImageExportOptions {
  return {format:preferences.exportFormat,quality:preferences.jpegQuality,width:Math.max(1,Math.round(document.cropRect?.width??document.width)),height:Math.max(1,Math.round(document.cropRect?.height??document.height))};
}
