import { useRef, useCallback, useState } from 'react';

export interface QueueItem {
  id: string;
  turnId: string;
  sentenceIndex: number;
  text?: string;
  audioBuffer?: AudioBuffer;
}

export interface UseAudioQueuePlayerOptions {
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  onSentenceStart?: (item: QueueItem) => void;
  onSentenceEnd?: (item: QueueItem) => void;
}

// Global reference retention to prevent Chromium V8 GC from killing active utterances mid-sentence
declare global {
  interface Window {
    __voiceUtterances?: SpeechSynthesisUtterance[];
  }
}

if (typeof window !== 'undefined') {
  window.__voiceUtterances = window.__voiceUtterances || [];
}

export function useAudioQueuePlayer(options: UseAudioQueuePlayerOptions = {}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const queueRef = useRef<QueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Violent Kill Switch: Immediately stops all active audio output and drains queue.
   */
  const cancelAllPlayback = useCallback(() => {
    // 1. Cancel browser speech synthesis instantly
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (window.__voiceUtterances) {
        window.__voiceUtterances = [];
      }
      activeUtteranceRef.current = null;
    }

    // 2. Stop active Web Audio source node
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop(0);
        activeSourceRef.current.disconnect();
      } catch {
        // Source node might already have ended
      }
      activeSourceRef.current = null;
    }

    // 3. Purge playback queue
    queueRef.current = [];
    isPlayingRef.current = false;
    activeTurnIdRef.current = null;
    setIsPlaying(false);
    optionsRef.current.onPlaybackStateChange?.(false);
  }, []);

  /**
   * Plays the next item in the queue
   */
  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      optionsRef.current.onPlaybackStateChange?.(false);
      return;
    }

    isPlayingRef.current = true;
    setIsPlaying(true);
    optionsRef.current.onPlaybackStateChange?.(true);

    const item = queueRef.current.shift()!;
    optionsRef.current.onSentenceStart?.(item);

    // Mode A: Raw AudioBuffer playback
    if (item.audioBuffer) {
      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = item.audioBuffer;
      source.connect(ctx.destination);
      activeSourceRef.current = source;

      source.onended = () => {
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null;
        }
        optionsRef.current.onSentenceEnd?.(item);
        playNext();
      };

      source.start(0);
      return;
    }

    // Mode B: Fast Browser SpeechSynthesis playback
    if (item.text && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // Chrome audio queue bug workaround: resume if paused
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.rate = 1.05; // Snappy conversational rate
      utterance.pitch = 1.0;

      // Keep strong reference in global array to prevent GC killing speech mid-sentence
      const globalUtterances = window.__voiceUtterances || [];
      globalUtterances.push(utterance);
      window.__voiceUtterances = globalUtterances;

      const voices = window.speechSynthesis.getVoices();
      const naturalVoice = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Alex'))
      );
      if (naturalVoice) {
        utterance.voice = naturalVoice;
      }

      utterance.onend = () => {
        // Clean up global reference
        if (window.__voiceUtterances) {
          window.__voiceUtterances = window.__voiceUtterances.filter((u) => u !== utterance);
        }
        activeUtteranceRef.current = null;
        optionsRef.current.onSentenceEnd?.(item);
        playNext();
      };

      utterance.onerror = (e) => {
        if (window.__voiceUtterances) {
          window.__voiceUtterances = window.__voiceUtterances.filter((u) => u !== utterance);
        }
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.error('[AudioPlayer] Utterance error:', e);
        }
        activeUtteranceRef.current = null;
        playNext();
      };

      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } else {
      playNext();
    }
  }, [getAudioContext]);

  /**
   * Enqueues a synthesized sentence for speech output
   */
  const enqueueSentence = useCallback(
    (text: string, turnId: string, sentenceIndex: number) => {
      if (activeTurnIdRef.current && activeTurnIdRef.current !== turnId) {
        cancelAllPlayback();
      }
      activeTurnIdRef.current = turnId;

      queueRef.current.push({
        id: `${turnId}_${sentenceIndex}`,
        turnId,
        sentenceIndex,
        text,
      });

      if (!isPlayingRef.current) {
        playNext();
      }
    },
    [cancelAllPlayback, playNext]
  );

  /**
   * Enqueues a raw audio buffer
   */
  const enqueueAudioChunk = useCallback(
    async (base64Data: string, turnId: string, sentenceIndex: number) => {
      if (activeTurnIdRef.current && activeTurnIdRef.current !== turnId) {
        cancelAllPlayback();
      }
      activeTurnIdRef.current = turnId;

      try {
        const ctx = getAudioContext();
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        queueRef.current.push({
          id: `${turnId}_${sentenceIndex}`,
          turnId,
          sentenceIndex,
          audioBuffer,
        });

        if (!isPlayingRef.current) {
          playNext();
        }
      } catch (err) {
        console.error('[AudioPlayer] Failed to decode audio chunk:', err);
      }
    },
    [cancelAllPlayback, getAudioContext, playNext]
  );

  return {
    isPlaying,
    enqueueSentence,
    enqueueAudioChunk,
    cancelAllPlayback,
  };
}
