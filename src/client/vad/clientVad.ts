/**
 * Client-Side Voice Activity Detection (VAD) & Audio Streaming Engine
 * Continuously monitors microphone input, computes energy RMS, and manages
 * acoustic echo suppression and barge-in interruption.
 */

export interface ClientVadOptions {
  energyThreshold?: number; // Baseline voice threshold when AI is silent (default 0.030)
  bargeInThreshold?: number; // Elevated threshold when AI is outputting audio through speakers (default 0.14)
  silenceTimeoutMs?: number; // Silence duration before utterance ends (default 750ms)
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onBargeIn?: (rms: number) => void;
  onAudioChunk?: (pcm16: Int16Array, base64: string) => void;
  onVolumeChange?: (volume: number) => void;
}

export class ClientVAD {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  private isSpeaking = false;
  private isAiSpeaking = false;
  private aiSpeakingStartTime = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private consecutiveSpeechFrames = 0;
  private consecutiveBargeInFrames = 0;

  private readonly energyThreshold: number;
  private readonly bargeInThreshold: number;
  private readonly silenceTimeoutMs: number;
  private readonly onSpeechStart?: () => void;
  private readonly onSpeechEnd?: () => void;
  private readonly onBargeIn?: (rms: number) => void;
  private readonly onAudioChunk?: (pcm16: Int16Array, base64: string) => void;
  private readonly onVolumeChange?: (volume: number) => void;

  constructor(options: ClientVadOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 0.030;
    this.bargeInThreshold = options.bargeInThreshold ?? 0.14;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 750;
    this.onSpeechStart = options.onSpeechStart;
    this.onSpeechEnd = options.onSpeechEnd;
    this.onBargeIn = options.onBargeIn;
    this.onAudioChunk = options.onAudioChunk;
    this.onVolumeChange = options.onVolumeChange;
  }

  /**
   * Updates whether the AI is currently speaking/streaming audio
   */
  public setAiSpeaking(speaking: boolean): void {
    this.isAiSpeaking = speaking;
    if (speaking) {
      this.aiSpeakingStartTime = Date.now();
      this.consecutiveBargeInFrames = 0;
    } else {
      this.consecutiveBargeInFrames = 0;
    }
  }

  /**
   * Initializes Web Audio microphone stream and starts VAD frame monitoring
   */
  public async start(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.mediaStream = stream;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: 16000 });

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    // 1024 samples at 16kHz is ~64ms per frame
    this.processorNode = this.audioContext.createScriptProcessor(1024, 1, 1);

    this.processorNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this.processAudioFrame(inputData);
    };

    this.sourceNode.connect(this.processorNode);
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0;
    this.processorNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    console.log('[ClientVAD] Audio processing node connected at 16kHz.');
  }

  /**
   * Analyzes an individual audio frame
   */
  private processAudioFrame(float32Array: Float32Array): void {
    // 1. Calculate RMS Energy
    let sumSquares = 0;
    for (let i = 0; i < float32Array.length; i++) {
      sumSquares += float32Array[i] * float32Array[i];
    }
    const rms = Math.sqrt(sumSquares / float32Array.length);

    // Notify volume change for UI visualizer
    const normalizedVol = Math.min(1, rms * 8);
    this.onVolumeChange?.(normalizedVol);

    // 2. Convert Float32 [-1.0, 1.0] to 16-bit linear PCM [-32768, 32767]
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    if (this.onAudioChunk) {
      const uint8 = new Uint8Array(pcm16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);
      this.onAudioChunk(pcm16, base64);
    }

    // 3. BARGE-IN MONITORING WHILE AI IS SPEAKING
    if (this.isAiSpeaking) {
      // 600ms grace period after AI speech begins to ignore initial speaker transients
      const timeSinceAiStarted = Date.now() - this.aiSpeakingStartTime;
      if (timeSinceAiStarted > 600 && rms >= this.bargeInThreshold) {
        this.consecutiveBargeInFrames++;
        // Require 4 consecutive frames (~160ms) of sustained louder speech to interrupt
        if (this.consecutiveBargeInFrames >= 4) {
          console.warn(`[ClientVAD] ⚡ INTENTIONAL BARGE-IN: RMS=${rms.toFixed(4)} >= ${this.bargeInThreshold}. Firing abort.`);
          this.isAiSpeaking = false;
          this.consecutiveBargeInFrames = 0;
          this.onBargeIn?.(rms);
        }
      } else {
        this.consecutiveBargeInFrames = 0;
      }
      return; // Do NOT trigger regular speech onset while AI is speaking
    }

    // 4. NORMAL USER SPEECH VAD LOGIC (when AI is silent)
    if (rms >= this.energyThreshold) {
      this.consecutiveSpeechFrames++;

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      if (!this.isSpeaking && this.consecutiveSpeechFrames >= 2) {
        this.isSpeaking = true;
        this.onSpeechStart?.();
      }
    } else {
      this.consecutiveSpeechFrames = 0;

      if (this.isSpeaking && !this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this.isSpeaking = false;
          this.silenceTimer = null;
          this.onSpeechEnd?.();
        }, this.silenceTimeoutMs);
      }
    }
  }

  /**
   * Stops audio monitoring, releases microphone, and closes Web Audio context
   */
  public stop(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isSpeaking = false;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveBargeInFrames = 0;
    console.log('[ClientVAD] Audio processing stopped and resources released.');
  }
}
