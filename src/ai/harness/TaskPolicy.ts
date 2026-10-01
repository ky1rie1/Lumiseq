import type { StudioDocument } from '../../types/document';
import type { ObservationRequest } from '../vision/observationTypes';
export type TaskKind = 'precise' | 'photo' | 'local-detail' | 'layout';
export type DocumentRegion = NonNullable<ObservationRequest['region']>;
export interface TaskPolicyOptions {
  taskKind?: TaskKind;
  regions?: DocumentRegion[];
  targetIds?: string[];
  wholeImage?: boolean;
  complexGoal?: boolean;
}
export interface TaskPolicy {
  kind: TaskKind;
  visual: boolean;
  groups: string[];
  requiredObservations: string[];
  regions: DocumentRegion[];
  targetIds: string[];
  wholeImage: boolean;
}
export function classifyTask(prompt: string, document?: StudioDocument | null, options: TaskPolicyOptions = {}): TaskPolicy {
  const numerical = /^(?:请\s*)?(?:(?:set|increase|decrease|adjust|change|设置|增加|降低|减少|调整)\s*)?(?:(?:选中)?图层\s*|(?:selected\s+)?layer\s+)?(?:曝光|exposure|contrast|temperature|opacity|对比度|色温|不透明度)\s*(?:to|by|为|到|至|=)?\s*[-+]?\d+(?:\.\d+)?\s*(?:EV|K|%)?\s*[.!。]?$/i.test(prompt.trim())
    || /^(?:(?:set|设置)\s*)?(?:color|颜色|RGB)\s*(?:to|为|=|:)?\s*(?:#[a-f\d]{6}|\(?\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\)?)\s*[.!。]?$/i.test(prompt.trim());
  const administrative=/^(?:请\s*)?(?:create|save|undo|redo|创建|保存|撤销)/i.test(prompt.trim())&&!/局部|细节|边缘|排版|均衡|美观|漂亮|海报|文字|风格|高级感|设计|detail|edge|layout|poster|typography|balanced|beautiful|aesthetic|cinematic|vivid|design/i.test(prompt);
  const kind = options.taskKind ?? (administrative?'precise':/局部|细节|边缘|噪点|锐化|detail|edge|noise|retouch|局域/i.test(prompt) ? 'local-detail'
    : /布局|排版|文字|海报|layout|poster|typography/i.test(prompt) ? 'layout'
      : /漂亮|美观|更均衡|好看|审美|风格|高级感|设计|beautiful|aesthetic|composition|balanced|cinematic|vivid|design/i.test(prompt) ? (document?.kind==='edit'?'layout':'photo')
      : numerical ? 'precise'
      : /^(?:(?:read|get|show|读取|查看)\s*)?(?:参数|settings|exposure|曝光)(?:值)?\s*[?？]?$/i.test(prompt.trim()) ? 'precise' : document?.kind === 'edit' ? 'layout' : 'photo');
  return { kind, visual: kind !== 'precise', groups: kind === 'precise' ? ['state', ...(document?.kind==='edit'?['layers','layout']:['parameters']), ...(/create|save|undo|redo|创建|保存|撤销/i.test(prompt)?['system']:[])] : kind === 'layout' ? ['state', 'observation', 'layers', 'layout'] : ['state', 'observation', 'parameters', ...(kind === 'local-detail' ? ['local'] : [])],
    requiredObservations: kind === 'precise' ? [] : kind === 'local-detail' ? ['overview', 'contextual region', 'native detail', 'matching before/after edges'] : ['overview', 'fresh result'],
    regions: options.regions ?? [], targetIds: options.targetIds ?? [], wholeImage: options.wholeImage ?? /整张|全图|whole image|entire image/i.test(prompt) };
}
/** Bounded original-coordinate search, prioritized by unresolved task claims, never by invented confidence. */
export function relevantRegions(policy: TaskPolicy, document: StudioDocument): DocumentRegion[] {
  if (policy.regions.length) return policy.regions;
  if (policy.wholeImage) {
    const regions: DocumentRegion[] = [];
    for (let y = 0; y < document.height; y += 1536) for (let x = 0; x < document.width; x += 1536)
      regions.push({ x, y, width: Math.min(1536, document.width - x), height: Math.min(1536, document.height - y) });
    return regions;
  }
  // A vague local claim needs model discovery via inspect_region before any local write.
  return [];
}
export function edgeContext(region: DocumentRegion, document: StudioDocument): DocumentRegion {
  const x = Math.max(0, Math.floor(region.x) - 16), y = Math.max(0, Math.floor(region.y) - 16);
  return { x, y, width: Math.min(document.width, Math.ceil(region.x + region.width) + 16) - x,
    height: Math.min(document.height, Math.ceil(region.y + region.height) + 16) - y };
}
