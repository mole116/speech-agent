import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceCloneProfile } from '../../types/protocol.js';
import { analyzeAudioBuffer, AcousticVoiceAnalysis } from '../vad/pitchEstimator.js';

interface VoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableVoices: SpeechSynthesisVoice[];
  activeProfile: VoiceCloneProfile | null;
  onSaveProfile: (profile: VoiceCloneProfile, audioBase64?: string) => Promise<void>;
  onDeleteProfile?: () => Promise<void>;
  previewVoice: (sampleText?: string) => void;
}

const SAMPLE_SENTENCE = "The quick brown fox jumps over the lazy dog near the calm blue river.";

export const VoiceCloneModal: React.FC<VoiceCloneModalProps> = ({
  isOpen,
  onClose,
  availableVoices,
  activeProfile,
  onSaveProfile,
  onDeleteProfile,
  previewVoice,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioUri, setRecordedAudioUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AcousticVoiceAnalysis | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const stopRecordingCleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRecordingCleanup();
    };
  }, [stopRecordingCleanup]);

  const startRecording = async () => {
    try {
      setStatusMessage(null);
      setRecordedAudioUri(null);
      setAnalysis(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false, // capture natural timbre
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // AudioContext for live volume visualization
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setVolumeLevel(Math.min(1, avg / 128));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stopRecordingCleanup();
        setIsRecording(false);
        setIsProcessing(true);
        setStatusMessage('Analyzing vocal pitch and timbre...');

        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();

          // Decode audio into PCM Float32Array for autocorrelation pitch estimation
          const decodeCtx = new AudioCtx();
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
          const channelData = audioBuffer.getChannelData(0);

          const voiceNames = availableVoices.map((v) => v.name);
          const result = analyzeAudioBuffer(channelData, audioBuffer.sampleRate, voiceNames);
          setAnalysis(result);

          // Convert blob to Data URI for playback
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUri = reader.result as string;
            setRecordedAudioUri(dataUri);
            setIsProcessing(false);
            setStatusMessage('Vocal profile calibrated successfully!');
          };
          reader.readAsDataURL(blob);
        } catch (err: any) {
          console.error('[VoiceClone] Analysis failed:', err);
          setIsProcessing(false);
          setStatusMessage('Failed to analyze audio sample. Please try again.');
        }
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 9) {
            // Auto stop after 10s
            stopRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('[VoiceClone] Could not start recording:', err);
      setStatusMessage(`Microphone access error: ${err.message || 'Permission denied'}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleSave = async () => {
    if (!analysis) return;
    setIsProcessing(true);

    const profile: VoiceCloneProfile = {
      id: `clone_${Date.now()}`,
      name: 'My Voice',
      createdAt: Date.now(),
      sampleAudioDurationSec: analysis.durationSec,
      detectedPitchHz: analysis.meanPitchHz,
      pitch: analysis.calibratedPitch,
      rate: analysis.calibratedRate,
      baseVoiceName: analysis.recommendedBaseVoice,
      audioDataUri: recordedAudioUri || undefined,
      classification: analysis.pitchClassification,
    };

    try {
      await onSaveProfile(profile, recordedAudioUri || undefined);
      setIsProcessing(false);
      onClose();
    } catch (err: any) {
      setIsProcessing(false);
      setStatusMessage(`Failed to save: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteProfile) return;
    if (confirm('Are you sure you want to delete your cloned voice profile?')) {
      setIsProcessing(true);
      try {
        await onDeleteProfile();
        setRecordedAudioUri(null);
        setAnalysis(null);
        setIsProcessing(false);
        onClose();
      } catch (err: any) {
        setIsProcessing(false);
        setStatusMessage(`Failed to delete profile: ${err.message}`);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden p-6 text-slate-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-lg">
              ✨
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Voice Cloning & Profiler</h2>
              <p className="text-xs text-slate-400">Clone your voice so the local agent answers in your vocal style</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Existing Profile Banner if enrolled */}
        {activeProfile && !analysis && (
          <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-800/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <span className="text-lg">🌟</span>
              <div>
                <p className="font-semibold text-indigo-200">Active Profile: {activeProfile.name}</p>
                <p className="text-[11px] text-indigo-300/70">
                  Pitch: {activeProfile.detectedPitchHz ? `${activeProfile.detectedPitchHz} Hz` : `${activeProfile.pitch}x`} &middot; Rate: {activeProfile.rate}x &middot; Base: {activeProfile.baseVoiceName}
                </p>
              </div>
            </div>
            {onDeleteProfile && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-[11px] font-medium transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        )}

        {/* Prompt Card */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-sky-400 uppercase tracking-wider">Reference Passage</span>
            <span className="text-[10px] text-slate-500 font-mono">Read clearly & naturally</span>
          </div>
          <p className="text-sm font-medium text-slate-200 leading-relaxed italic border-l-2 border-sky-500 pl-3 py-1">
            "{SAMPLE_SENTENCE}"
          </p>
        </div>

        {/* Recording Controls & Visualizer */}
        <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-slate-950/40 border border-slate-800/80 space-y-3">
          {/* Animated Volume Ring / Waves */}
          <div className="relative flex items-center justify-center">
            {isRecording && (
              <div
                className="absolute rounded-full bg-sky-500/20 animate-ping"
                style={{
                  width: `${80 + volumeLevel * 70}px`,
                  height: `${80 + volumeLevel * 70}px`,
                }}
              />
            )}
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              className={`relative z-10 w-20 h-20 rounded-full flex flex-col items-center justify-center text-white font-semibold transition-all shadow-xl ${
                isRecording
                  ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/40 animate-pulse'
                  : 'bg-gradient-to-tr from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 shadow-sky-500/30'
              }`}
            >
              <span className="text-2xl">{isRecording ? '⏹️' : '🎙️'}</span>
              <span className="text-[11px] mt-0.5">{isRecording ? 'Stop' : 'Record'}</span>
            </button>
          </div>

          <div className="text-center space-y-0.5">
            <p className="text-xs font-semibold text-slate-300">
              {isRecording
                ? `Recording... (00:0${recordingSeconds} / 00:10)`
                : recordedAudioUri
                ? 'Sample Captured'
                : 'Click Record to read passage'}
            </p>
            {statusMessage && <p className="text-[11px] text-sky-400 animate-in fade-in">{statusMessage}</p>}
          </div>

          {/* Audio Sample Playback if recorded */}
          {recordedAudioUri && (
            <div className="pt-2 w-full flex items-center justify-center">
              <audio controls src={recordedAudioUri} className="h-8 w-64 max-w-full accent-sky-500" />
            </div>
          )}
        </div>

        {/* Acoustic Analysis Breakdown */}
        {analysis && (
          <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Calibrated Voice Profile</h4>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Fundamental Pitch</span>
                <span className="text-sm font-bold text-sky-400 font-mono">{analysis.meanPitchHz} Hz</span>
                <span className="text-[10px] text-slate-400 block capitalize">{analysis.pitchClassification}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Calibrated Rate</span>
                <span className="text-sm font-bold text-indigo-400 font-mono">{analysis.calibratedRate}x</span>
                <span className="text-[10px] text-slate-400 block">{analysis.durationSec}s reading</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Base Timbre</span>
                <span className="text-xs font-bold text-emerald-400 truncate block">
                  {analysis.recommendedBaseVoice}
                </span>
                <span className="text-[10px] text-slate-400 block">System Match</span>
              </div>
            </div>

            {/* Test Sample Button */}
            <button
              type="button"
              onClick={() =>
                previewVoice("Hey Moshe! This is your cloned voice agent speaking back in your vocal tone.")
              }
              className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-slate-700/60"
            >
              <span>▶️</span>
              <span>Preview Agent Speaking In Your Voice</span>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!analysis || isProcessing}
            className={`px-5 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all ${
              analysis && !isProcessing
                ? 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-sky-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isProcessing ? 'Saving Profile...' : 'Save & Activate Voice'}
          </button>
        </div>
      </div>
    </div>
  );
};
