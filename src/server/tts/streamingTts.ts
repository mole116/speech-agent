import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CONFIG } from '../config.js';

export interface SynthesizedChunk {
  sentenceIndex: number;
  format: 'wav' | 'aiff';
  dataBase64: string;
}

export class LocalStreamingTTS {
  private activeProcess: ChildProcess | null = null;
  private isMac = process.platform === 'darwin';

  /**
   * Synthesize text to an audio buffer using native macOS 'say' or return null if using client-side synth.
   */
  public async synthesize(text: string, sentenceIndex: number, abortSignal?: AbortSignal): Promise<SynthesizedChunk | null> {
    if (CONFIG.tts.engine !== 'say' || !this.isMac) {
      // Browser synth selected
      return null;
    }

    if (abortSignal?.aborted) {
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
