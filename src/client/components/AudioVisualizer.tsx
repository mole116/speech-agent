import React from 'react';
import { AgentStatus } from '../../types/protocol.js';

interface AudioVisualizerProps {
  status: AgentStatus;
  volumeLevel: number; // 0.0 to 1.0
  isCalling: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  status,
  volumeLevel,
  isCalling,
}) => {
  // Determine color theme based on agent status
  const getColorClasses = () => {
    switch (status) {
      case 'speaking':
        return 'from-emerald-500/30 via-emerald-400/20 to-teal-500/10 border-emerald-500/50 shadow-emerald-500/20';
      case 'listening':
        return 'from-sky-500/30 via-blue-500/20 to-indigo-500/10 border-sky-500/50 shadow-sky-500/20';
      case 'thinking':
        return 'from-purple-500/30 via-violet-500/20 to-fuchsia-500/10 border-purple-500/50 shadow-purple-500/20';
      case 'tool_executing':
        return 'from-amber-500/30 via-yellow-500/20 to-orange-500/10 border-amber-500/50 shadow-amber-500/20';
      case 'interrupted':
        return 'from-rose-500/30 via-red-500/20 to-pink-500/10 border-rose-500/50 shadow-rose-500/20';
      default:
        return 'from-slate-700/20 via-slate-800/10 to-slate-900/10 border-slate-700/30 shadow-none';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'speaking':
        return 'Agent Speaking';
      case 'listening':
        return 'Listening to You...';
      case 'thinking':
        return 'Thinking & Reasoning...';
      case 'tool_executing':
        return 'Executing Local Tool...';
      case 'interrupted':
        return 'Barge-In Interrupted!';
      default:
        return isCalling ? 'Idle' : 'Ready to Connect';
    }
  };

  // Compute reactive scale from mic volume
  const scale = isCalling ? 1 + volumeLevel * 0.45 : 1;
  const numBars = 24;

  return (
    <div className="flex flex-col items-center justify-center p-6">
      {/* Central Pulsating Orb */}
      <div className="relative flex items-center justify-center w-48 h-48 my-4">
        {/* Outer glowing ripple */}
        <div
          className={`absolute inset-0 rounded-full bg-gradient-to-tr ${getColorClasses()} border transition-all duration-300 blur-md`}
          style={{
            transform: `scale(${scale * 1.15})`,
            opacity: isCalling ? 0.8 : 0.2,
          }}
        />

        {/* Middle reactive ring */}
        <div
          className={`absolute inset-3 rounded-full bg-gradient-to-br ${getColorClasses()} border backdrop-blur-sm transition-transform duration-150 shadow-2xl`}
          style={{
            transform: `scale(${scale})`,
          }}
        />

        {/* Center Core */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center p-4">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-300 ${
              status === 'speaking'
                ? 'bg-emerald-500 text-slate-950'
                : status === 'listening'
                ? 'bg-sky-500 text-slate-950'
                : status === 'tool_executing'
                ? 'bg-amber-500 text-slate-950'
                : status === 'interrupted'
                ? 'bg-rose-500 text-white'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {status === 'speaking' && (
              <svg className="w-7 h-7 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
            {status === 'listening' && (
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
            {status === 'thinking' && (
              <svg className="w-7 h-7 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {status === 'tool_executing' && (
              <svg className="w-7 h-7 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              </svg>
            )}
            {status === 'interrupted' && (
              <svg className="w-7 h-7 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
            {status === 'idle' && (
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            )}
            {status === 'disconnected' && (
              <svg className="w-7 h-7 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a5 5 0 01-7.071-7.072m0 0l2.829 2.829M3 3l18 18" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Reactive Frequency Spectrum Bars */}
      <div className="flex items-center justify-center gap-1 h-8 mt-2">
        {Array.from({ length: numBars }).map((_, i) => {
          // Compute pseudo-random frequency wave height modulated by live mic volume
          const offset = Math.sin((i / numBars) * Math.PI);
          const height = isCalling
            ? Math.max(4, Math.round(offset * (volumeLevel * 28 + 6)))
            : 4;

          return (
            <div
              key={i}
              className={`w-1 rounded-full transition-all duration-75 ${
                status === 'speaking'
                  ? 'bg-emerald-400'
                  : status === 'listening'
                  ? 'bg-sky-400'
                  : status === 'tool_executing'
                  ? 'bg-amber-400'
                  : 'bg-slate-700'
              }`}
              style={{ height: `${height}px` }}
            />
          );
        })}
      </div>

      {/* Status Label */}
      <div className="mt-3 text-sm font-semibold tracking-wide uppercase">
        <span
          className={`${
            status === 'speaking'
              ? 'text-emerald-400'
              : status === 'listening'
              ? 'text-sky-400'
              : status === 'thinking'
              ? 'text-purple-400'
              : status === 'tool_executing'
              ? 'text-amber-400'
              : status === 'interrupted'
              ? 'text-rose-400'
              : 'text-slate-400'
          }`}
        >
          {getStatusText()}
        </span>
      </div>
    </div>
  );
};
