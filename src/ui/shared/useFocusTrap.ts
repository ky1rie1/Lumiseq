// src/ui/shared/useFocusTrap.ts
//! 模态面板的焦点陷阱。原生 <dialog> 只约束「文档其余部分不可交互」，在最后一个控件上按 Tab
//! 仍会把焦点交给 body，导致焦点框消失一帧；这里显式在面板内循环：
//! 遮罩式弹窗（OverlayModal）与原生 <dialog> 版本（Modal）共用同一份实现，不再各写一遍。

import { KeyboardEvent, RefObject, useCallback } from 'react';

/** 参与焦点的元素；disabled 与不可见的控件由 getFocusableElements 过滤。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

const isDisabled = (element: HTMLElement): boolean =>
  element.hasAttribute('disabled') || element.closest('fieldset[disabled]') !== null;

/** 面板内按文档顺序排列的可聚焦元素。 */
export function getFocusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !isDisabled(element) && element.getClientRects().length > 0
  );
}

/** 返回一个挂在模态面板上的 onKeyDown 处理器，让 Tab / Shift+Tab 在面板内循环。 */
export function useFocusTrap<T extends HTMLElement>(panelRef: RefObject<T | null>) {
  return useCallback(
    (event: KeyboardEvent<T>) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      event.preventDefault();
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        // 没有可聚焦控件时，焦点留在面板本身。
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panel.contains(active)) {
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey) {
        if (active === first) last.focus();
        else (focusable[focusable.indexOf(active) - 1] ?? first).focus();
      } else if (active === last) {
        first.focus();
      } else {
        (focusable[focusable.indexOf(active) + 1] ?? last).focus();
      }
    },
    [panelRef]
  );
}
