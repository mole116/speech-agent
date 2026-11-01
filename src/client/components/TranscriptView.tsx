import React, { useEffect, useRef } from 'react';
import { TranscriptEntry } from '../../types/protocol.js';

interface TranscriptViewProps {
  transcript: TranscriptEntry[];
  currentAssistantText: string;
  isStreaming: boolean;
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  transcript,
  currentAssistantText,
  isStreaming,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, currentAssistantText]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[460px] rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-md"
    >
      {transcript.length === 0 && !currentAssistantText && (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-sm space-y-2">
          <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span>No voice conversation yet. Click "Start Call" or pick a sample prompt below.</span>
        </div>
      )}

      {transcript.map((entry) => {
        const isUser = entry.role === 'user';

        return (
          <div
            key={entry.id}
            className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
          >
            <div className="flex items-center space-x-2 px-1">
              <span className="text-xs font-medium text-slate-400">
                {isUser ? 'You' : 'qwen2.5-coder (Local Ollama)'}
              </span>
              <span className="text-[10px] text-slate-500">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>

            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                isUser
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60'
              }`}
            >
              <p className="whitespace-pre-wrap">{entry.text}</p>

              {/* Interruption Badge */}
              {entry.interrupted && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                  Barge-in Interrupted
                </div>
              )}

              {/* Tool Execution summary pill if attached */}
              {entry.toolCalls && entry.toolCalls.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-700/40 space-y-1">
                  {entry.toolCalls.map((tc) => (
                    <div
                      key={tc.id}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 text-amber-300 text-xs border border-amber-500/20 mr-1.5 mb-1"
                    >
                      <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Tool: {tc.name}</span>
                      {tc.durationMs && <span className="text-[10px] text-amber-400/70">({tc.durationMs}ms)</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Real-time Streaming Assistant Chunk */}
      {currentAssistantText ? (
        <div className="flex flex-col items-start space-y-1">
          <div className="flex items-center space-x-2 px-1">
            <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Streaming Voice Output...
            </span>
          </div>

          <div className="max-w-[85%] rounded-2xl rounded-bl-none px-4 py-2.5 text-sm leading-relaxed bg-slate-800 text-slate-100 border border-emerald-500/30 shadow-lg shadow-emerald-500/5">
            <p className="whitespace-pre-wrap">
              {currentAssistantText}
              {isStreaming && <span className="inline-block w-1.5 h-4 ml-1 bg-emerald-400 animate-pulse align-middle" />}
            </p>
          </div>
        </div>
      ) : isStreaming ? (
        <div className="flex flex-col items-start space-y-1 animate-fade-in">
          <div className="flex items-center space-x-2 px-1">
            <span className="text-xs font-medium text-purple-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              Thinking & Reasoning...
            </span>
          </div>
          <div className="rounded-2xl rounded-bl-none px-4 py-3 bg-slate-800/80 border border-purple-500/30 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" />
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce [animation-delay:0.2s]" />
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce [animation-delay:0.4s]" />
          </div>
        </div>
      ) : null}
    </div>
  );
};
