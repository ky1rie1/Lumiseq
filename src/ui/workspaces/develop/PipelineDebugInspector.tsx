// src/ui/workspaces/develop/PipelineDebugInspector.tsx
//! Pipeline Debug Inspector (Developer Mode only)
//! Displays real-time ImageColorPipelineState, resolution, and rendering stage facts.

import React from 'react';
import { DevelopDocument } from '../../../types/develop';
import { Activity, X, Check, AlertTriangle } from 'lucide-react';

interface PipelineDebugInspectorProps {
  document: DevelopDocument;
  canvasWidth: number;
  canvasHeight: number;
  isOpen: boolean;
  onClose: () => void;
}

export const PipelineDebugInspector: React.FC<PipelineDebugInspectorProps> = ({
  document: doc,
  canvasWidth,
  canvasHeight,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const pipe = doc.pipelineState || {
    colorState: 'display-encoded',
    whiteBalanceApplied: true,
    cameraMatrixApplied: true,
    toneMappingApplied: false,
    transferFunctionApplied: true,
    colorSpace: 'srgb',
  };

  return (
    <div className="absolute top-12 left-4 z-40 w-80 bg-studio-900/95 border border-studio-700/80 shadow-2xl rounded-xl backdrop-blur-md text-2xs p-3 font-mono text-studio-200 select-none">
      <div className="flex items-center justify-between pb-2 border-b border-studio-800 mb-2">
        <div className="flex items-center space-x-1.5 text-amber-400 font-semibold">
          <Activity className="w-3.5 h-3.5" />
          <span>管线色彩状态诊断 (Debug)</span>
        </div>
        <button
          onClick={onClose}
          className="text-studio-400 hover:text-studio-100 p-0.5 rounded cursor-pointer"
          aria-label="关闭诊断器"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="text-studio-400">文件源类型：</span>
          <span className={doc.isRaw ? 'text-amber-400 font-bold' : 'text-blue-400'}>
            {doc.isRaw ? 'RAW 原始文件' : '位图图像 (Raster)'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">原生引擎连接：</span>
          <span className={doc.rawEngineAttached ? 'text-emerald-400' : 'text-studio-400'}>
            {doc.rawEngineAttached ? 'LibRaw 0.21.3 (Native)' : '前端模拟/离线'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">输入色彩状态：</span>
          <span className="text-purple-400 font-bold">{pipe.colorState}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">白平衡已应用：</span>
          <span className={pipe.whiteBalanceApplied ? 'text-emerald-400 flex items-center' : 'text-amber-400 flex items-center'}>
            {pipe.whiteBalanceApplied ? <Check className="w-3 h-3 mr-0.5" /> : <AlertTriangle className="w-3 h-3 mr-0.5" />}
            {pipe.whiteBalanceApplied ? '已应用 (防止重叠倍率)' : '未应用 (需在管线执行)'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">相机色彩矩阵：</span>
          <span className="text-studio-300">{pipe.cameraMatrixApplied ? '已校正' : '标准工作矩阵'}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">工作色彩空间：</span>
          <span className="text-cyan-400">{pipe.colorSpace.toUpperCase()}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">传递函数 (EOTF)：</span>
          <span className="text-studio-300">
            {pipe.transferFunctionApplied ? 'sRGB 分段传递函数' : 'Linear (物理光度)'}
          </span>
        </div>

        <div className="flex justify-between pt-1 border-t border-studio-800">
          <span className="text-studio-400">原图尺寸：</span>
          <span>{doc.width} × {doc.height}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-studio-400">实时渲染尺寸：</span>
          <span className="text-sky-400">{canvasWidth} × {canvasHeight}</span>
        </div>
      </div>
    </div>
  );
};
