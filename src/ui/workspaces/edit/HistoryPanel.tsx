// src/ui/workspaces/edit/HistoryPanel.tsx
//! 命令历史面板：读取命令总线的历史记录，按最新优先展示。
import React from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { useHistoryStore } from '../../../stores/useHistoryStore';

export const HistoryPanel: React.FC = () => {
  const history = useHistoryStore((s) => s.history);

  return (
    <div className="h-44 border-t border-studio-800 bg-studio-950 p-2.5 flex flex-col" role="region" aria-label="命令历史">
      <div className="flex items-center space-x-1.5 text-2xs font-bold uppercase tracking-wider text-studio-500 mb-1.5">
        <HistoryIcon className="w-3 h-3" />
        <span>命令历史 ({history.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 font-mono text-2xs">
        {history.length === 0 ? (
          <div className="text-studio-400 text-center py-4">暂无操作记录</div>
        ) : (
          [...history].reverse().map((entry) => (
            <div
              key={entry.id}
              className="bg-studio-900 border border-studio-800 px-2 py-1 rounded text-studio-300 flex justify-between"
            >
              <span className="truncate">{entry.name}</span>
              <span className="text-studio-500">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
