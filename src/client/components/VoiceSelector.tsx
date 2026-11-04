import React, { useState, useRef, useEffect } from 'react';
import { VoiceSettings, VoiceCloneProfile } from '../../types/protocol.js';
import { VoiceCloneModal } from './VoiceCloneModal.js';

interface VoiceSelectorProps {
  voiceSettings: VoiceSettings;
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void;
  availableVoices: SpeechSynthesisVoice[];
  previewVoice: (sampleText?: string) => void;
  saveClonedProfile?: (profile: VoiceCloneProfile, audioBase64?: string) => Promise<void>;
  deleteClonedProfile?: () => Promise<void>;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voiceSettings,
  setVoiceSettings,
  availableVoices,
  previewVoice,
  saveClonedProfile,
  deleteClonedProfile,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
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
  const isCloned = voiceSettings.isClonedVoice && voiceSettings.clonedProfile;
  const currentVoiceObj = availableVoices.find((v) => v.name === voiceSettings.voiceName);
  const activeLabel = isCloned
    ? '🌟 My Voice'
    : currentVoiceObj
    ? currentVoiceObj.name
    : 'System Voice';

  return (
    <>
      <div className="relative inline-block" ref={popoverRef}>
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors shadow-sm ${
            isCloned
              ? 'bg-gradient-to-r from-indigo-950/90 to-purple-950/90 hover:from-indigo-900/90 hover:to-purple-900/90 border-indigo-500/50 text-indigo-200 shadow-indigo-500/10'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 hover:border-slate-700 text-slate-200'
          }`}
          title="Change Voice & Speech Speed"
        >
          <span className={isCloned ? 'text-indigo-400' : 'text-sky-400'}>{isCloned ? '🌟' : '🎙️'}</span>
          <span className="font-medium truncate max-w-[150px]">{activeLabel}</span>
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
                <span className="text-base">{isCloned ? '🌟' : '🎙️'}</span>
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

            {/* Clone Voice Call-to-Action Card */}
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-700/50 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-indigo-200">
                  {voiceSettings.clonedProfile ? 'Your Voice is Cloned' : 'Answer in YOUR Voice'}
                </p>
                <p className="text-[10px] text-indigo-300/70">
                  {voiceSettings.clonedProfile
                    ? `${voiceSettings.clonedProfile.detectedPitchHz || 135}Hz pitch & timbre calibrated`
                    : 'Record 5s sample to mirror your vocal style'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setIsCloneModalOpen(true);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors shadow-sm shadow-indigo-500/20 whitespace-nowrap"
              >
                {voiceSettings.clonedProfile ? 'Manage' : '✨ Clone'}
              </button>
            </div>

            {/* Voice Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex justify-between">
                <span>Speaker Voice</span>
                <span className="text-[10px] text-slate-500 font-mono">{availableVoices.length} available</span>
              </label>
              <select
                value={isCloned ? '__my_cloned_voice__' : voiceSettings.voiceName}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__my_cloned_voice__' && voiceSettings.clonedProfile) {
                    setVoiceSettings({
                      isClonedVoice: true,
                      voiceName: voiceSettings.clonedProfile.baseVoiceName,
                      pitch: voiceSettings.clonedProfile.pitch,
                      rate: voiceSettings.clonedProfile.rate,
                    });
                  } else {
                    const v = availableVoices.find((x) => x.name === val);
                    setVoiceSettings({
                      isClonedVoice: false,
                      voiceName: val,
                      lang: v?.lang,
                    });
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition-colors"
              >
                {voiceSettings.clonedProfile && (
                  <optgroup label="🌟 Personalized Cloned Profile">
                    <option value="__my_cloned_voice__">
                      🌟 My Cloned Voice ({voiceSettings.clonedProfile.detectedPitchHz ? `${voiceSettings.clonedProfile.detectedPitchHz} Hz` : 'Active'})
                    </option>
                  </optgroup>
                )}
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
                onClick={() =>
                  previewVoice(
                    isCloned
                      ? "Hello! This is your voice agent answering in your cloned vocal style."
                      : "Hello! This is how I sound on your Mac."
                  )
                }
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

      {/* Voice Clone Enrollment Modal */}
      <VoiceCloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        availableVoices={availableVoices}
        activeProfile={voiceSettings.clonedProfile || null}
        onSaveProfile={saveClonedProfile || (async () => {})}
        onDeleteProfile={deleteClonedProfile}
        previewVoice={previewVoice}
      />
    </>
  );
};
