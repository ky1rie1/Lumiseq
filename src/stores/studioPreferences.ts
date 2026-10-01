export type PreferenceSection = 'general' | 'appearance' | 'canvas' | 'files' | 'performance';
export interface StudioPreferences {
  startupWorkspace: 'home' | 'last'; recentLimit: 5 | 10 | 20 | 30; openAiPanel: boolean;
  density: 'comfortable' | 'compact'; motion: 'full' | 'reduced' | 'off'; canvasBackground: string;
  wheelDirection: 'normal' | 'reverse'; wheelSpeed: 'slow' | 'normal' | 'fast'; checkerSize: 'small' | 'medium' | 'large'; checkerTone: 'light' | 'dark';
  defaultBrushSize: number; defaultBrushHardness: number;
  recoveryIntervalSeconds: 15 | 30 | 60 | 120; exportFormat: 'jpeg' | 'png'; jpegQuality: number;
  historyLimit: number; previewQuality: 'auto' | 'economy' | 'high'; cutoutIdleMinutes: 0 | 1 | 3 | 5; cutoutAcceleration:'auto'|'cpu';
}
export const STUDIO_PREFERENCES_KEY = 'yingxu_studio_preferences_v1';
export const DEFAULT_STUDIO_PREFERENCES: Readonly<StudioPreferences> = Object.freeze({
  startupWorkspace:'home',recentLimit:10,openAiPanel:false,density:'comfortable',motion:'full',canvasBackground:'#202022',
  wheelDirection:'normal',wheelSpeed:'normal',checkerSize:'medium',checkerTone:'light',defaultBrushSize:30,defaultBrushHardness:0.8,
  recoveryIntervalSeconds:30,exportFormat:'jpeg',jpegQuality:90,historyLimit:100,previewQuality:'auto',cutoutIdleMinutes:3,cutoutAcceleration:'auto',
});
export const PREFERENCE_SECTIONS: Record<PreferenceSection, readonly (keyof StudioPreferences)[]> = {
  general:['startupWorkspace','recentLimit','openAiPanel'],appearance:['density','motion','canvasBackground'],
  canvas:['wheelDirection','wheelSpeed','checkerSize','checkerTone','defaultBrushSize','defaultBrushHardness'],
  files:['recoveryIntervalSeconds','exportFormat','jpegQuality'],performance:['historyLimit','previewQuality','cutoutIdleMinutes','cutoutAcceleration'],
};
const choices: Partial<Record<keyof StudioPreferences, readonly unknown[]>> = {
  startupWorkspace:['home','last'],recentLimit:[5,10,20,30],density:['comfortable','compact'],motion:['full','reduced','off'],
  wheelDirection:['normal','reverse'],wheelSpeed:['slow','normal','fast'],checkerSize:['small','medium','large'],checkerTone:['light','dark'],
  recoveryIntervalSeconds:[15,30,60,120],exportFormat:['jpeg','png'],previewQuality:['auto','economy','high'],cutoutIdleMinutes:[0,1,3,5],cutoutAcceleration:['auto','cpu'],
};
export function normalizeStudioPreferences(value: unknown): StudioPreferences {
  const result = {...DEFAULT_STUDIO_PREFERENCES};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string,unknown>;
  for (const [key, values] of Object.entries(choices)) if (values.includes(input[key])) Object.assign(result,{[key]:input[key]});
  if (typeof input.openAiPanel === 'boolean') result.openAiPanel=input.openAiPanel;
  if (typeof input.canvasBackground === 'string' && /^#[\da-f]{6}$/i.test(input.canvasBackground)) result.canvasBackground=input.canvasBackground;
  for (const [key,min,max,integer] of [['defaultBrushSize',1,1000,true],['defaultBrushHardness',0,1,false],['jpegQuality',1,100,true],['historyLimit',20,200,true]] as const) {
    const number=input[key]; if (typeof number==='number' && Number.isFinite(number) && number>=min && number<=max && (!integer || Number.isInteger(number))) result[key]=number;
  }
  return result;
}
export function preferenceStorage(): Storage | undefined { try {return typeof localStorage==='undefined' ? undefined : localStorage;} catch {return undefined;} }
export function readStudioPreferences(storage?: Pick<Storage,'getItem'>): StudioPreferences {
  try {
    const raw=storage?.getItem(STUDIO_PREFERENCES_KEY);
    if (raw) {const record=JSON.parse(raw); return record?.version===1 || record?.version===2 ? normalizeStudioPreferences(record.preferences) : {...DEFAULT_STUDIO_PREFERENCES};}
    const legacy=JSON.parse(storage?.getItem('yingxu_appearance') ?? 'null');
    return normalizeStudioPreferences(legacy && typeof legacy==='object' ? {motion:legacy.reduceMotion===true?'reduced':'full'} : null);
  } catch {return {...DEFAULT_STUDIO_PREFERENCES};}
}
export function saveStudioPreferences(storage: Pick<Storage,'setItem'> | undefined, value: StudioPreferences): boolean {
  try {if (!storage) return false; storage.setItem(STUDIO_PREFERENCES_KEY,JSON.stringify({version:2,preferences:normalizeStudioPreferences(value)})); return true;} catch {return false;}
}
export function resetPreferenceSection(value: StudioPreferences, section: PreferenceSection): StudioPreferences {
  const result={...value}; for (const key of PREFERENCE_SECTIONS[section]) Object.assign(result,{[key]:DEFAULT_STUDIO_PREFERENCES[key]}); return result;
}
