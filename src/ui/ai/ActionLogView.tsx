// src/ui/ai/ActionLogView.tsx
import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Layers,
  Wrench
} from 'lucide-react';
import { AgentRun, AgentActionLogEntry } from '../../ai/types';

/** Chinese display labels for the run status enum. Enum values stay unchanged. */
const RUN_STATUS_LABELS: Record<AgentRun['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  partial: '部分完成',
  budget_exhausted: '预算已用尽',
  awaiting_selection: '等待选择',
};

/** Chinese display labels for the per-tool action status enum. */
const ACTION_STATUS_LABELS: Record<AgentActionLogEntry['status'], string> = {
  pending: '等待确认',
  success: '执行成功',
  failed: '执行失败',
  rejected: '已拒绝',
};

const TOOL_LABELS: Record<string, string> = {
  get_develop_settings: '读取调色参数', get_edit_document: '读取图层',
  develop_set_exposure: '调整曝光', develop_set_contrast: '调整对比度',
  develop_set_temperature: '调整色温', develop_set_tint: '调整色调',
  develop_set_saturation: '调整饱和度', develop_set_highlights: '调整高光',
  develop_set_shadows: '调整阴影', develop_reset_settings: '重置调色参数',
  edit_create_text_layer: '创建文字图层', edit_create_image_layer: '创建图像图层',
  edit_delete_layer: '删除图层', edit_rename_layer: '重命名图层',
  edit_set_layer_opacity: '调整图层不透明度', edit_set_blend_mode: '调整混合模式',
  edit_set_visibility: '设置图层可见性', edit_move_layer_order: '调整图层顺序',
  edit_select_subject: '选择主体', edit_select_object: '选择对象',
  edit_select_background: '选择背景', edit_select_sky: '选择天空',
  edit_remove_selected_object: '移除选中对象', edit_generative_fill: '生成式填充',
  edit_create_paint_layer: '创建绘画图层', edit_create_adjustment_layer: '创建调整图层',
  edit_set_adjustment_settings: '调整图层参数', edit_brush_stroke: '画笔描绘',
  edit_paint_mask: '绘制蒙版', edit_clone_stamp: '仿制图章',
  edit_heal: '修复图像', edit_sample_color: '采样颜色',
  edit_draw_gradient: '绘制渐变', edit_create_group: '创建图层组',
  edit_move_to_group: '移动至图层组', edit_create_smart_object: '创建智能对象',
  edit_add_smart_filter: '添加智能滤镜', edit_manage_smart_filter: '调整智能滤镜',
  edit_transform: '变换图层', edit_crop: '裁切图像',
  edit_resize_canvas: '调整画布大小', edit_resize_image: '调整图像大小',
};

interface ActionLogViewProps {
  run: AgentRun;
  onUndoRun?: (runId: string) => void;
}

export const ActionLogView: React.FC<ActionLogViewProps> = ({ run, onUndoRun }) => {
  const [expanded, setExpanded] = useState(run.status === 'running' || run.status === 'failed' || run.status === 'awaiting_selection');
  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});

  const toggleEntry = (id: string) => {
    setExpandedEntries((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getToolIcon = (toolName: string) => {
    if (toolName.startsWith('develop_')) {
      return <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />;
    }
    if (toolName.startsWith('edit_')) {
      return <Layers className="w-3.5 h-3.5 text-blue-400" />;
    }
    return <Wrench className="w-3.5 h-3.5 text-zinc-400" />;
  };

  const getStatusBadge = (status: AgentActionLogEntry['status']) => {
    const label = ACTION_STATUS_LABELS[status];
    switch (status) {
      case 'success':
        return (
          <span className="flex items-center space-x-1 text-2xs text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{label}</span>
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center space-x-1 text-2xs text-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{label}</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center space-x-1 text-2xs text-amber-300">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>{label}</span>
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center space-x-1 text-2xs text-studio-300">
            <Clock className="w-3.5 h-3.5 text-studio-400" />
            <span>{label}</span>
          </span>
        );
    }
  };

  return (
    <article className="ai-run" aria-label={`AI 任务：${run.prompt}`}>
      {/* Run Header */}
      <div className="ai-run-header flex items-center justify-between">
      <button type="button"
        className="ai-run-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-studio-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-studio-400 shrink-0" />
          )}
          <span className="ai-run-prompt">
            {run.prompt}
          </span>
      </button>

        <div className="ai-run-controls">
          {onUndoRun && run.actions.length > 0 && (
            <button
              disabled={run.status === 'running'}
              onClick={(e) => {
                e.stopPropagation();
                onUndoRun(run.runId);
              }}
              title="撤销本次运行的全部操作"
              aria-label="撤销本次运行的全部操作"
              className="ai-icon-button"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          <span
            title={`状态：${RUN_STATUS_LABELS[run.status]}（${run.status}）`}
            className="ai-run-status" data-status={run.status}>
            {RUN_STATUS_LABELS[run.status]}
          </span>
        </div>
      </div>

      {run.rollbackBlockedReason && <p role="status" className="text-2xs text-studio-300 px-3 py-2">{run.rollbackBlockedReason}</p>}
      <div className="ai-run-meta">
        <span>{run.actions.length} 个操作</span>
        {run.phase && <span>阶段：{{ observation: '观察', plan: '计划', tools: '编辑', rendered_result: '检查结果', review: '评审' }[run.phase]} · </span>}
        {run.budget && <span>模型 {run.budget.modelSteps} · 操作 {run.budget.toolCalls} · 图像 {run.budget.images} · 细节 {run.budget.detailTiles}</span>}
      </div>

      {/* Actions List */}
      {expanded && (
        <div className="ai-run-actions space-y-1.5">
          {(run.providerId || run.modelId) && <div className="text-2xs text-studio-400 px-2">{run.providerId} · {run.modelId}</div>}
          {run.response && <p className="ai-run-response">{run.response}</p>}
          {run.verification && <div className="ai-run-verification" aria-label="核验与待确认事项">
            {!!run.verification.verified.length && <div><strong>已核验</strong>{run.verification.verified.map((fact, index) => <p key={index}>{fact}</p>)}</div>}
            {!!run.verification.pending.length && <div><strong>待确认</strong>{run.verification.pending.map((fact, index) => <p key={index}>{fact}</p>)}</div>}
          </div>}
          {run.actions.length === 0 ? (
            <div className="text-2xs text-studio-500 py-1">
              {run.status === 'running' ? '正在处理操作…' : '本次运行未执行任何工具操作。'}
            </div>
          ) : (
            run.actions.map((act) => {
              const isEntryExpanded = !!expandedEntries[act.id];
              return (
                <div
                  key={act.id}
                  className="ai-run-action text-2xs space-y-1"
                >
                  <button type="button"
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={isEntryExpanded}
                    onClick={() => toggleEntry(act.id)}
                  >
                    <div className="flex items-center space-x-2">
                      {getToolIcon(act.toolName)}
                      <span className="text-studio-200 font-semibold">
                        {TOOL_LABELS[act.toolName] || act.toolName.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {getStatusBadge(act.status)}
                      {isEntryExpanded ? (
                        <ChevronDown className="w-3 h-3 text-studio-500" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-studio-500" />
                      )}
                    </div>
                  </button>

                  {isEntryExpanded && (
                    <div className="pt-2 mt-1 border-t border-studio-800 text-2xs font-mono space-y-1 bg-studio-950 p-2 rounded">
                      <div>
                        <span className="text-studio-500">工具：{act.toolName}</span>
                      </div>
                      <div>
                        <span className="text-studio-500">参数：</span>
                        <pre className="text-studio-300 mt-0.5 overflow-x-auto">
                          {JSON.stringify(act.args, null, 2)}
                        </pre>
                      </div>

                      {act.result && (
                        <div>
                          <span className="text-studio-500">执行结果：</span>
                          <pre className="text-studio-300 mt-0.5 overflow-x-auto">
                            {JSON.stringify(act.result, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {run.error && (
            <div className="ai-run-error" role="status">
              <div>
                本次运行失败，后续操作已停止。
              </div>
              <div className="font-mono text-rose-300/80 break-all">
                原始错误：{run.error}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
