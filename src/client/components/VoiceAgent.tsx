import React, { useState } from 'react';
import { useVoiceAgent } from '../hooks/useVoiceAgent.js';
import { AudioVisualizer } from './AudioVisualizer.js';
import { TranscriptView } from './TranscriptView.js';
import { ToolExecLog } from './ToolExecLog.js';

export const VoiceAgent: React.FC = () => {
  const {
    isConnected,
    isCalling,
    agentStatus,
    statusDetail,
    modelName,
    transcript,
    currentAssistantText,
    toolLogs,
    volumeLevel,
    isAiSpeaking,
    error,
    startCall,
    endCall,
    triggerBargeIn,
    sendTextQuery,
    clearTranscript,
    reconnect,
  } = useVoiceAgent();

  const [textInput, setTextInput] = useState('');

  const samplePrompts = [
    { label: '📦 Check Inventory', prompt: 'Check our local inventory for MacBook Pro M4 stock.' },
    { label: '⚡ System Telemetry', prompt: 'What are the current MacBook Pro M4 hardware and system metrics?' },
    { label: '📜 Inspect Logs', prompt: 'Show me recent warning logs from the voice engine or network.' },
    { label: '📝 Save Voice Note', prompt: 'Save a note that the M4 audio pipeline latency is sub-100ms.' },
    { label: '🛑 Test Barge-in (Long Speech)', prompt: 'Tell me a long, detailed explanation of how voice activity detection and WebSockets work in real time.' },
  ];

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendTextQuery(textInput);
    setTextInput('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080c14] text-slate-100 selection:bg-sky-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">Local Voice Agent</h1>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                M4 Real-Time
              </span>
            </div>
            <p className="text-xs text-slate-400">Ollama ({modelName}) &middot; Vercel AI SDK &middot; WebSockets &middot; Silero VAD</p>
          </div>
        </div>

        {/* Server Status Pill */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isConnected ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-slate-300 font-mono">
              {isConnected ? 'WebSocket: Connected (3001)' : 'WebSocket: Disconnected'}
            </span>
            {!isConnected && (
              <button
                type="button"
                onClick={reconnect}
                className="ml-1 text-sky-400 hover:text-sky-300 underline font-sans text-xs"
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚠️ Warning:</span>
            <span>{error}</span>
          </div>
          <span className="text-[11px] text-rose-300/70">Ensure Ollama is running ('ollama serve')</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Visualizer & Call Controls (4 cols) */}
        <section className="lg:col-span-4 flex flex-col space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md flex flex-col items-center shadow-xl">
            {/* Audio Visualizer */}
            <AudioVisualizer
              status={agentStatus}
              volumeLevel={volumeLevel}
              isCalling={isCalling}
            />

            {statusDetail && (
              <p className="text-xs text-slate-400 mt-1 italic text-center animate-fade-in">
                {statusDetail}
              </p>
            )}

            {/* Call Action Buttons */}
            <div className="w-full mt-6 space-y-3">
              {!isCalling ? (
                <button
                  type="button"
                  onClick={startCall}
                  className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-lg shadow-sky-500/25 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Start Live Voice Call
                </button>
              ) : (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={endCall}
                    className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                    </svg>
                    End Voice Session
                  </button>

                  {/* Prominent Barge-in Interrupt Kill Switch Button */}
                  <button
                    type="button"
                    onClick={() => triggerBargeIn('manual')}
                    disabled={!isAiSpeaking && agentStatus !== 'speaking' && agentStatus !== 'thinking'}
                    className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-md ${
                      isAiSpeaking || agentStatus === 'speaking' || agentStatus === 'thinking'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse shadow-rose-600/30'
                        : 'bg-rose-950/40 text-rose-400/50 border border-rose-900/30 cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    🛑 Barge-in (Kill Active Audio)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Voice Prompt Chips */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Quick Test Prompts
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendTextQuery(p.prompt)}
                  className="text-left text-xs px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/50 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Middle Column: Live Transcript (5 cols) */}
        <section className="lg:col-span-5 flex flex-col space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <h2 className="text-sm font-semibold text-slate-200">Live Transcript</h2>
            </div>
            <button
              type="button"
              onClick={clearTranscript}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Live Transcript View */}
          <TranscriptView
            transcript={transcript}
            currentAssistantText={currentAssistantText}
            isStreaming={agentStatus === 'speaking' || agentStatus === 'thinking'}
          />

          {/* Text Query Input (Fallback & Testing) */}
          <form onSubmit={handleTextSubmit} className="flex gap-2 mt-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type a message to the voice agent..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition-colors placeholder:text-slate-600"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white rounded-xl text-xs font-medium transition-colors"
            >
              Send
            </button>
          </form>
        </section>

        {/* Right Column: Server Tool Executions Log (3 cols) */}
        <section className="lg:col-span-3 flex flex-col space-y-3">
          <ToolExecLog toolLogs={toolLogs} />
        </section>
      </main>
    </div>
  );
};
