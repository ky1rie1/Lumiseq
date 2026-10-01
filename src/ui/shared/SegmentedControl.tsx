// src/ui/shared/SegmentedControl.tsx
//! Shared compact segmented selection with stationary hit areas.

import React from 'react';

export interface SegmentOption<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  activeId: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'xs';
}

export function SegmentedControl<T extends string = string>({
  options,
  activeId,
  onChange,
  size = 'xs',
}: SegmentedControlProps<T>) {
  return (
    <div className={`segmented-control segmented-control-${size} flex select-none`}>
      {options.map((opt) => {
        const isActive = opt.id === activeId;
        return (
          <button
            type="button"
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className="flex-1 flex items-center justify-center gap-1.5 min-w-0 text-center"
            aria-pressed={isActive}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
