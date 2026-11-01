/**
 * Client-Side Voice Activity Detection (VAD) & Audio Streaming Engine
 * Continuously monitors microphone input, computes energy RMS, and fires instant
 * Barge-in interrupt triggers the MOMENT speech onset is detected while AI is outputting audio.
 */

export interface ClientVadOptions {
  energyThreshold?: number; // RMS threshold (default 0.035)
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
  private silenceTimer: NodeJS.Timeout | null = null;
  private consecutiveSpeechFrames = 0;

  private readonly energyThreshold: number;
  private readonly silenceTimeoutMs: number;
  private readonly onSpeechStart?: () => void;
  private readonly onSpeechEnd?: () => void;
  private readonly onBargeIn?: (rms: number) => void;
  private readonly onAudioChunk?: (pcm16: Int16Array, base64: string) => void;
  private readonly onVolumeChange?: (volume: number) => void;

  constructor(options: ClientVadOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 0.035;
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
    // Connect to a mute destination to keep processing alive without feedback loop
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

    // Convert to base64 for JSON transmission or direct binary transfer
    if (this.onAudioChunk) {
      const uint8 = new Uint8Array(pcm16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);
      this.onAudioChunk(pcm16, base64);
    }

    // 3. VAD Voice Trigger Logic
    if (rms >= this.energyThreshold) {
      this.consecutiveSpeechFrames++;

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      // BARGE-IN CHECK: Human speaks while AI is outputting audio
      if (this.isAiSpeaking) {
        console.warn(`[ClientVAD] ⚡ BARGE-IN DETECTED! RMS=${rms.toFixed(4)}. Firing instant KILL signal.`);
        this.onBargeIn?.(rms);
        // Force reset AI speaking immediately
        this.isAiSpeaking = false;
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
    console.log('[ClientVAD] Audio processing stopped and resources released.');
  }
}
