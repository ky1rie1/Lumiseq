// src/ui/shared/AccordionSection.tsx
//! High-Density Professional Collapsible Accordion Drawer with Section Reset

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

interface AccordionSectionProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  onResetSection?: () => void;
  resetTooltip?: string;
  badge?: string;
  children: React.ReactNode;
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  title,
  icon,
  defaultExpanded = true,
  onResetSection,
  resetTooltip = '重置此模块参数',
  badge,
  children,
}) => {
  // Store user collapsed preference in sessionStorage so switching photos doesn't reset it
  const storageKey = `accordion_open_${id}`;
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(storageKey);
      if (saved !== null) return saved === 'true';
    }
    return defaultExpanded;
  });

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(storageKey, String(next));
      }
      return next;
    });
  };

  return (
    <section className="accordion-section border-t border-studio-800/80 pt-2.5 pb-1 select-none">
      {/* Header */}
      <div className="accordion-section-header flex items-center justify-between py-1 group">
        <button
          onClick={toggleOpen}
          className="flex items-center space-x-1.5 text-xs font-medium text-studio-200 hover:text-white transition-colors cursor-pointer flex-1 text-left"
          aria-expanded={isOpen}
        >
          <span className="text-studio-400 group-hover:text-studio-200">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          {icon && <span className="accordion-section-icon text-studio-400">{icon}</span>}
          <span>{title}</span>
          {badge && (
            <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] bg-studio-800 text-studio-400 font-mono">
              {badge}
            </span>
          )}
        </button>

        {onResetSection && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResetSection();
            }}
            className="text-studio-500 hover:text-studio-300 p-1 rounded transition-colors cursor-pointer"
            title={resetTooltip}
            aria-label={resetTooltip}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Body Content */}
      {isOpen && <div className="accordion-section-body pt-2 pb-1 space-y-2.5">{children}</div>}
    </section>
  );
};
