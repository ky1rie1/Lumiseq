// src/types/blendModeLabels.ts
//! 混合模式的中文显示名（Photoshop 中文标准名）。
//! 键与 BlendMode 的枚举字面量一一对应，供图层快捷属性、工具选项条与属性面板共用，
//! 避免三处各维护一份并在增删模式时漂移。value / onChange 传出的枚举值始终是英文原文，不参与本地化。

import { BlendMode } from './edit';

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  darken: '变暗',
  lighten: '变亮',
  'color-dodge': '颜色减淡',
  'color-burn': '颜色加深',
  'hard-light': '强光',
  'soft-light': '柔光',
  difference: '差值',
  exclusion: '排除',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度',
};

/** 枚举顺序的模式列表，由上面这份映射派生，避免下拉选项与 BlendMode 联合类型漂移。 */
export const ALL_BLEND_MODES = Object.keys(BLEND_MODE_LABELS) as BlendMode[];
