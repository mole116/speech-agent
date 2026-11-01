import React, { useState } from 'react';
import { ToolCallLog } from '../../types/protocol.js';

interface ToolExecLogProps {
  toolLogs: ToolCallLog[];
}

export const ToolExecLog: React.FC<ToolExecLogProps> = ({ toolLogs }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col h-full rounded-xl bg-slate-900/60 border border-slate-800 p-4 backdrop-blur-md">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          </svg>
          <h3 className="text-sm font-semibold text-slate-200">Server Tool Executions</h3>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
          {toolLogs.length} calls
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-3 space-y-2.5 pr-1 max-h-[460px]">
        {toolLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-36 text-slate-500 text-xs text-center px-4">
            <span>No tools triggered yet.</span>
            <span className="text-slate-600 mt-1">
              Ask: "Check our local inventory" or "What are the M4 system metrics?"
            </span>
          </div>
        ) : (
          toolLogs.map((log) => {
            const isExpanded = expandedId === log.id;
            const isCalling = log.status === 'calling';

            return (
              <div
                key={log.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden text-xs transition-colors hover:border-slate-700"
              >
                {/* Header row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(log.id)}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isCalling ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
                      }`}
                    />
                    <span className="font-mono font-medium text-slate-200">{log.name}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {log.durationMs !== undefined && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
                        {log.durationMs}ms
                      </span>
                    )}
                    <span className="text-slate-500 text-[10px]">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="p-3 bg-slate-950 border-t border-slate-800/80 space-y-2 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                        Arguments:
                      </span>
                      <pre className="mt-1 p-2 rounded bg-slate-900 text-amber-200/90 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(log.args, null, 2)}
                      </pre>
                    </div>

                    {log.result !== undefined && (
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                          Returned Data:
                        </span>
                        <pre className="mt-1 p-2 rounded bg-slate-900 text-emerald-300/90 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(log.result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
