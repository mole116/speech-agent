import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CONFIG } from '../config.js';
import { NeuralTTSBridge } from './neuralTtsBridge.js';

export interface SynthesizedChunk {
  sentenceIndex: number;
  format: 'wav' | 'aiff';
  dataBase64: string;
}

export class LocalStreamingTTS {
  private activeProcess: ChildProcess | null = null;
  private isMac = process.platform === 'darwin';

  /**
   * Synthesize text to an audio buffer using F5-TTS neural voice clone or native macOS 'say'.
   */
  public async synthesize(text: string, sentenceIndex: number, abortSignal?: AbortSignal): Promise<SynthesizedChunk | null> {
    if (abortSignal?.aborted) {
      return null;
    }

    // 1. Neural Voice Cloning Engine (F5-TTS)
    if (CONFIG.tts.engine === 'clone') {
      const refWav = path.resolve(process.cwd(), 'storage/voice_profiles/user_voice.wav');
      if (fs.existsSync(refWav)) {
        return NeuralTTSBridge.getInstance().synthesize(text, sentenceIndex, refWav, abortSignal);
      }
    }

    // 2. macOS native 'say'
    if (CONFIG.tts.engine !== 'say' || !this.isMac) {
      // Browser synth selected
      return null;
    }

    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}_${sentenceIndex}.aiff`);

    return new Promise<SynthesizedChunk | null>((resolve) => {
      if (abortSignal?.aborted) {
        return resolve(null);
      }

      // Execute macOS native 'say'
      const proc = spawn('say', ['-v', CONFIG.tts.voice, '-o', tempFile, text]);
      this.activeProcess = proc;

      const abortHandler = () => {
        try {
          proc.kill('SIGKILL');
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch {
          // ignore cleanup error
        }
        resolve(null);
      };

      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      proc.on('close', (code) => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
        this.activeProcess = null;

        if (code === 0 && fs.existsSync(tempFile)) {
          try {
            const buffer = fs.readFileSync(tempFile);
            fs.unlinkSync(tempFile);
            resolve({
              sentenceIndex,
              format: 'aiff',
              dataBase64: buffer.toString('base64'),
            });
          } catch (err) {
            console.error('[TTS] Failed to read audio buffer:', err);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        console.error('[TTS] say process error:', err);
        resolve(null);
      });
    });
  }

  /**
   * Immediately abort any active speech synthesis subprocess
   */
  public abort(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.activeProcess = null;
    }
  }
}
