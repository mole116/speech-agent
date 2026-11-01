import { CONFIG } from '../config.js';
export class ServerVAD {
    isSpeaking = false;
    consecutiveSpeechFrames = 0;
    silenceFrames = 0;
    speechStartTimestamp = 0;
    audioChunks = [];
    energyThreshold;
    silenceTimeoutMs;
    minSpeechFrames = 2; // ~40ms minimum to trigger speech
    frameDurationMs;
    constructor(energyThreshold = CONFIG.vad.energyThreshold, silenceTimeoutMs = CONFIG.vad.silenceTimeoutMs, sampleRate = CONFIG.vad.sampleRate) {
        this.energyThreshold = energyThreshold;
        this.silenceTimeoutMs = silenceTimeoutMs;
        // For 512 samples at 16kHz, each frame is ~32ms
        this.frameDurationMs = (CONFIG.vad.frameSize / sampleRate) * 1000;
    }
    /**
     * Process a chunk of 16-bit PCM mono audio
     * @param pcmBuffer Buffer of 16-bit signed PCM
     * @param isAiCurrentlySpeaking whether the AI is currently outputting audio or generating
     */
    processAudioChunk(pcmBuffer, isAiCurrentlySpeaking = false) {
        const rms = this.calculateRms(pcmBuffer);
        if (rms >= this.energyThreshold) {
            this.consecutiveSpeechFrames++;
            this.silenceFrames = 0;
            // Check for Speech Start
            if (!this.isSpeaking && this.consecutiveSpeechFrames >= this.minSpeechFrames) {
                this.isSpeaking = true;
                this.speechStartTimestamp = Date.now();
                this.audioChunks = [pcmBuffer];
                // If AI is speaking, this is an IMMEDIATE BARGE-IN!
                if (isAiCurrentlySpeaking) {
                    return {
                        type: 'barge_in',
                        timestamp: this.speechStartTimestamp,
                    };
                }
                return {
                    type: 'speech_start',
                    timestamp: this.speechStartTimestamp,
                };
            }
            if (this.isSpeaking) {
                this.audioChunks.push(pcmBuffer);
            }
        }
        else {
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
    calculateRms(buffer) {
        const sampleCount = Math.floor(buffer.length / 2);
        if (sampleCount === 0)
            return 0;
        let sumSquares = 0;
        for (let i = 0; i < buffer.length - 1; i += 2) {
            // 16-bit signed integer [-32768, 32767]
            const sample = buffer.readInt16LE(i) / 32768.0;
            sumSquares += sample * sample;
        }
        return Math.sqrt(sumSquares / sampleCount);
    }
    /**
     * Resets VAD state and clears internal audio buffers
     */
    reset() {
        this.isSpeaking = false;
        this.consecutiveSpeechFrames = 0;
        this.silenceFrames = 0;
        this.speechStartTimestamp = 0;
        this.audioChunks = [];
    }
    getIsSpeaking() {
        return this.isSpeaking;
    }
}
