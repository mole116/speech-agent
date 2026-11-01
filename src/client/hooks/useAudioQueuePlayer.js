import { useRef, useCallback, useState } from 'react';
export function useAudioQueuePlayer(options = {}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const queueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const activeSourceRef = useRef(null);
    const activeUtteranceRef = useRef(null);
    const audioContextRef = useRef(null);
    const activeTurnIdRef = useRef(null);
    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
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
        console.warn('[AudioPlayer] 🛑 VIOLENT CANCEL: Purging playback queue and aborting audio output.');
        // 1. Cancel browser speech synthesis instantly
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            activeUtteranceRef.current = null;
        }
        // 2. Stop active Web Audio source node
        if (activeSourceRef.current) {
            try {
                activeSourceRef.current.stop(0);
                activeSourceRef.current.disconnect();
            }
            catch {
                // Source node might already have ended
            }
            activeSourceRef.current = null;
        }
        // 3. Purge playback queue
        queueRef.current = [];
        isPlayingRef.current = false;
        activeTurnIdRef.current = null;
        setIsPlaying(false);
        options.onPlaybackStateChange?.(false);
    }, [options]);
    /**
     * Plays the next item in the queue
     */
    const playNext = useCallback(() => {
        if (queueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsPlaying(false);
            options.onPlaybackStateChange?.(false);
            return;
        }
        isPlayingRef.current = true;
        setIsPlaying(true);
        options.onPlaybackStateChange?.(true);
        const item = queueRef.current.shift();
        options.onSentenceStart?.(item);
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
                options.onSentenceEnd?.(item);
                playNext();
            };
            source.start(0);
            return;
        }
        // Mode B: Fast Browser SpeechSynthesis playback
        if (item.text && typeof window !== 'undefined' && 'speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(item.text);
            utterance.rate = 1.05; // Slightly faster for snappier conversation
            utterance.pitch = 1.0;
            // Select natural English voice if available
            const voices = window.speechSynthesis.getVoices();
            const naturalVoice = voices.find((v) => v.lang.startsWith('en') &&
                (v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Natural') || v.name.includes('Google')));
            if (naturalVoice) {
                utterance.voice = naturalVoice;
            }
            utterance.onend = () => {
                activeUtteranceRef.current = null;
                options.onSentenceEnd?.(item);
                playNext();
            };
            utterance.onerror = (e) => {
                if (e.error !== 'canceled' && e.error !== 'interrupted') {
                    console.error('[AudioPlayer] Utterance error:', e);
                }
                activeUtteranceRef.current = null;
                playNext();
            };
            activeUtteranceRef.current = utterance;
            window.speechSynthesis.speak(utterance);
        }
        else {
            // Fallback
            playNext();
        }
    }, [getAudioContext, options]);
    /**
     * Enqueues a synthesized sentence for speech output
     */
    const enqueueSentence = useCallback((text, turnId, sentenceIndex) => {
        // If turn ID changed without cancel, clear previous stale turns
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
    }, [cancelAllPlayback, playNext]);
    /**
     * Enqueues a raw audio buffer (e.g. from server-side TTS WAV/AIFF)
     */
    const enqueueAudioChunk = useCallback(async (base64Data, turnId, sentenceIndex) => {
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
        }
        catch (err) {
            console.error('[AudioPlayer] Failed to decode audio chunk:', err);
        }
    }, [cancelAllPlayback, getAudioContext, playNext]);
    return {
        isPlaying,
        enqueueSentence,
        enqueueAudioChunk,
        cancelAllPlayback,
    };
}
