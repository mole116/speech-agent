import { CONFIG } from '../config.js';

export interface VadEvent {
  type: 'speech_start' | 'speech_end' | 'barge_in';
  timestamp: number;
  audioBuffer?: Buffer;
  durationMs?: number;
}

export class ServerVAD {
  private isSpeaking = false;
  private consecutiveSpeechFrames = 0;
  private silenceFrames = 0;
  private speechStartTimestamp = 0;
  private audioChunks: Buffer[] = [];

  private readonly energyThreshold: number;
  private readonly bargeInThreshold: number; // Elevated threshold when AI is outputting audio
  private readonly silenceTimeoutMs: number;
  private readonly minSpeechFrames = 2; // ~40ms minimum for normal speech start
  private readonly minBargeInFrames = 4; // ~120ms of sustained louder speech for barge-in
  private readonly frameDurationMs: number;

  constructor(
    energyThreshold = CONFIG.vad.energyThreshold,
    silenceTimeoutMs = CONFIG.vad.silenceTimeoutMs,
    sampleRate = CONFIG.vad.sampleRate
  ) {
    this.energyThreshold = energyThreshold;
    this.bargeInThreshold = 0.14; // Acoustic echo guard
    this.silenceTimeoutMs = silenceTimeoutMs;
    // For 512 samples at 16kHz, each frame is ~32ms
    this.frameDurationMs = (CONFIG.vad.frameSize / sampleRate) * 1000;
  }

  /**
   * Process a chunk of 16-bit PCM mono audio
   * @param pcmBuffer Buffer of 16-bit signed PCM
   * @param isAiCurrentlySpeaking whether the AI is currently outputting audio or generating
   */
  public processAudioChunk(pcmBuffer: Buffer, isAiCurrentlySpeaking = false): VadEvent | null {
    const rms = this.calculateRms(pcmBuffer);

    // 1. ACOUSTIC ECHO GUARD: While AI is speaking, ignore ambient speaker bleed
    if (isAiCurrentlySpeaking) {
      if (rms >= this.bargeInThreshold) {
        this.consecutiveSpeechFrames++;
        if (this.consecutiveSpeechFrames >= this.minBargeInFrames) {
          this.consecutiveSpeechFrames = 0;
          return {
            type: 'barge_in',
            timestamp: Date.now(),
          };
        }
      } else {
        this.consecutiveSpeechFrames = 0;
      }
      return null;
    }

    // 2. NORMAL SPEECH DETECTION (when AI is silent)
    if (rms >= this.energyThreshold) {
      this.consecutiveSpeechFrames++;
      this.silenceFrames = 0;

      // Check for Speech Start
      if (!this.isSpeaking && this.consecutiveSpeechFrames >= this.minSpeechFrames) {
        this.isSpeaking = true;
        this.speechStartTimestamp = Date.now();
        this.audioChunks = [pcmBuffer];

        return {
          type: 'speech_start',
          timestamp: this.speechStartTimestamp,
        };
      }

      if (this.isSpeaking) {
        this.audioChunks.push(pcmBuffer);
      }
    } else {
      // Below threshold (silence/background)
      this.consecutiveSpeechFrames = 0;

      if (this.isSpeaking) {
        this.audioChunks.push(pcmBuffer);
        this.silenceFrames++;

        const silenceDurationMs = this.silenceFrames * this.frameDurationMs;
        if (silenceDurationMs >= this.silenceTimeoutMs) {
          // Utterance finished
          this.isSpeaking = false;
          const totalBuffer = Buffer.concat(this.audioChunks);
          const durationMs = Date.now() - this.speechStartTimestamp;
          this.audioChunks = [];
          this.silenceFrames = 0;

          return {
            type: 'speech_end',
            timestamp: Date.now(),
            audioBuffer: totalBuffer,
            durationMs,
          };
        }
      }
    }

    return null;
  }

  /**
   * Calculates Root-Mean-Square (RMS) of 16-bit linear PCM
   */
  public calculateRms(buffer: Buffer): number {
    const sampleCount = Math.floor(buffer.length / 2);
    if (sampleCount === 0) return 0;

    let sumSquares = 0;
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768.0;
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  /**
   * Resets VAD state and clears internal audio buffers
   */
  public reset(): void {
    this.isSpeaking = false;
    this.consecutiveSpeechFrames = 0;
    this.silenceFrames = 0;
    this.speechStartTimestamp = 0;
    this.audioChunks = [];
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}
