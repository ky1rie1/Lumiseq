// src/types/adjustmentLabels.ts
//! 调整图层类型的中文显示名。仅用于界面展示与默认图层名，不改变数据结构。
//! 键与 AdjustmentType 的下划线字面量一一对应，供 UI 与图层工厂共用，避免两处重复维护。

import { AdjustmentType } from './edit';

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  exposure: '曝光度',
  brightness_contrast: '亮度 / 对比度',
  hue_saturation: '色相 / 饱和度',
  color_balance: '色彩平衡',
  black_and_white: '黑白',
  levels: '色阶',
  curves: '曲线',
};

/** 枚举顺序的类型列表，由上面这份映射派生，避免下拉选项与 AdjustmentType 联合类型漂移。 */
export const ALL_ADJUSTMENT_TYPES = Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentType[];
