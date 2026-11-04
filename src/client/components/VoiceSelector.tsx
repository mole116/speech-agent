import React, { useState, useRef, useEffect } from 'react';
import { VoiceSettings } from '../../types/protocol.js';

interface VoiceSelectorProps {
  voiceSettings: VoiceSettings;
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void;
  availableVoices: SpeechSynthesisVoice[];
  previewVoice: (sampleText?: string) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voiceSettings,
  setVoiceSettings,
  availableVoices,
  previewVoice,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter and prioritize English voices first, then others
  const englishVoices = availableVoices.filter((v) => v.lang.startsWith('en'));
  const otherVoices = availableVoices.filter((v) => !v.lang.startsWith('en'));

  // Active voice display name
  const currentVoiceObj = availableVoices.find((v) => v.name === voiceSettings.voiceName);
  const activeLabel = currentVoiceObj ? `${currentVoiceObj.name} (${currentVoiceObj.lang})` : 'System Default';

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 transition-colors shadow-sm"
        title="Change Voice & Speech Speed"
      >
        <span className="text-sky-400">🎙️</span>
        <span className="font-medium truncate max-w-[150px]">{currentVoiceObj?.name || 'Voice'}</span>
        <span className="text-[10px] text-slate-400 font-mono">{voiceSettings.rate.toFixed(2)}x</span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Popover Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-900/95 border border-slate-700/80 backdrop-blur-xl shadow-2xl z-50 p-4 space-y-4 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-base">🎙️</span>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Voice & Speech Settings</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded"
            >
              ✕
            </button>
          </div>

          {/* Voice Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex justify-between">
              <span>Speaker Voice</span>
              <span className="text-[10px] text-slate-500 font-mono">{availableVoices.length} available</span>
            </label>
            <select
              value={voiceSettings.voiceName}
              onChange={(e) => {
                const name = e.target.value;
                const v = availableVoices.find((x) => x.name === name);
                setVoiceSettings({ voiceName: name, lang: v?.lang });
              }}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition-colors"
            >
              <option value="">Default (Auto-select natural English voice)</option>
              {englishVoices.length > 0 && (
                <optgroup label="English Voices (macOS / System)">
                  {englishVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
              {otherVoices.length > 0 && (
                <optgroup label="Other Installed Languages">
                  {otherVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Speed / Rate Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Speaking Rate</span>
              <span className="text-sky-400 font-mono font-bold text-[11px]">{voiceSettings.rate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.5"
              step="0.05"
              value={voiceSettings.rate}
              onChange={(e) => setVoiceSettings({ rate: parseFloat(e.target.value) })}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.8x (Slow)</span>
              <span>1.0x (Normal)</span>
              <span>1.5x (Fast)</span>
            </div>
          </div>

          {/* Pitch Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Voice Pitch</span>
              <span className="text-indigo-400 font-mono font-bold text-[11px]">{voiceSettings.pitch.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.05"
              value={voiceSettings.pitch}
              onChange={(e) => setVoiceSettings({ pitch: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>Deep (0.8x)</span>
              <span>Default (1.0x)</span>
              <span>Higher (1.3x)</span>
            </div>
          </div>

          {/* Preview & Done Action Buttons */}
          <div className="pt-2 border-t border-slate-800 flex gap-2">
            <button
              type="button"
              onClick={() => previewVoice()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <span>▶️</span>
              <span>Test Voice</span>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors shadow-sm shadow-sky-500/20"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
