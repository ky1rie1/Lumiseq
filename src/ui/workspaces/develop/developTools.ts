export const DEVELOP_GROUPS = [
  { id: 'basic', label: '基础' }, { id: 'color', label: '色彩' },
  { id: 'detail', label: '细节' }, { id: 'local', label: '局部' }, { id: 'looks', label: '预设' },
] as const;
export type DevelopGroup = typeof DEVELOP_GROUPS[number]['id'];

const sections: Array<{ id: string; groups: DevelopGroup[]; keywords: string }> = [
  { id:'dev-sec-looks', groups:['looks'], keywords:'预设 快照 保存 导入 导出 对比 preset snapshot looks' },
  { id:'dev-sec-masks', groups:['local'], keywords:'局部 蒙版 画笔 渐变 径向 mask local brush radial linear' },
  { id:'dev-sec-basic', groups:['basic'], keywords:'基础 影调 曝光 对比度 高光 阴影 白色 黑色 exposure contrast highlights shadows whites blacks tone' },
  { id:'dev-sec-wb', groups:['color'], keywords:'白平衡 原照 自动 手动 色温 色调 温度 white balance temperature tint as shot' },
  { id:'dev-sec-presence', groups:['color','detail'], keywords:'质感 饱和度 纹理 清晰度 去雾 自然饱和度 texture clarity dehaze vibrance saturation' },
  { id:'dev-sec-curves', groups:['color'], keywords:'色调 曲线 明度 红 绿 蓝 curve rgb tone' },
  { id:'dev-sec-hsl', groups:['color'], keywords:'颜色 混合 色相 饱和 明亮 红 橙 黄 绿 蓝 紫 洋红 hsl hue saturation luminance mixer' },
  { id:'dev-sec-detail', groups:['detail'], keywords:'细节 锐化 半径 阈值 降噪 明度 色彩 噪点 sharpen radius threshold luma chroma noise denoise detail' },
  { id:'dev-sec-optics', groups:['detail'], keywords:'镜头 晕影 数量 中点 optics lens vignette amount midpoint' },
];

export function visibleDevelopSections(group: DevelopGroup, query: string): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sections.filter(section => terms.length
    ? terms.every(term => section.keywords.includes(term))
    : section.groups.includes(group)).map(section => section.id);
}

export function nextDevelopGroup(group: DevelopGroup, key: string): DevelopGroup | null {
  const index = DEVELOP_GROUPS.findIndex(item => item.id === group);
  if (key === 'Home') return 'basic';
  if (key === 'End') return 'looks';
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  return DEVELOP_GROUPS[(index + (key === 'ArrowRight' ? 1 : -1) + DEVELOP_GROUPS.length) % DEVELOP_GROUPS.length].id;
}
