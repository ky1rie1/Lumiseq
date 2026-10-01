// src/ui/shared/OverlayModal.tsx
//! 遮罩式弹窗的统一交互组件：遮罩 + studio-modal 面板 + role/aria + Esc + 焦点陷阱 + 焦点恢复。
//! 六个手写弹窗（AI 指令面板、模型服务、诊断、外部工具、本地模型、拾色器）共用它，
//! 避免每个界面重复实现同一套弹窗行为，并保证键盘用户不会 Tab 到弹窗背后的内容。
//! 焦点陷阱与原生 <dialog> 版本的 Modal 共用 src/ui/shared/useFocusTrap.ts。

import React, { ReactNode, useEffect, useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

interface OverlayModalProps {
  /** false 时不渲染任何内容。 */
  open: boolean;
  onClose: () => void;
  /** 中文 aria-label。 */
  label: string;
  /** 追加到面板上的类（各弹窗原有的宽度 / 布局类）。 */
  className?: string;
  /** 追加到遮罩上的类（用于保留 items-start pt-24 之类的对齐差异）。 */
  overlayClassName?: string;
  children: ReactNode;
}

/**
 * 模态弹窗容器。行为与原生 <dialog> 版本（src/ui/shared/Modal.tsx）对齐：
 * 焦点移入面板、Tab 在面板内循环、Escape 关闭、点击遮罩空白处关闭、关闭后把焦点还给打开它的元素。
 */
export const OverlayModal: React.FC<OverlayModalProps> = ({
  open,
  onClose,
  label,
  className,
  overlayClassName,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const trapFocus = useFocusTrap(panelRef);

  // 打开时记录 opener 并把焦点移入面板；关闭 / 卸载时把焦点还给 opener。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  // Escape 关闭（全局监听，保证焦点在面板内任意位置都生效）。
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`studio-overlay fixed inset-0 flex items-center justify-center${overlayClassName ? ` ${overlayClassName}` : ''}`}
      onClick={(event) => {
        // 仅点击遮罩空白处关闭；点击面板内部不关闭。
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={`studio-modal w-full border overflow-hidden flex flex-col outline-none${className ? ` ${className}` : ''}`}
      >
        {children}
      </div>
    </div>
  );
};
