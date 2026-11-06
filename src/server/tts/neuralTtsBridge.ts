import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { SynthesizedChunk } from './streamingTts.js';

export class NeuralTTSBridge {
  private static instance: NeuralTTSBridge | null = null;
  private workerProc: ChildProcess | null = null;
  private isReady = false;
  private isStarting = false;
  private pendingRequests = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private reqCounter = 0;

  public static getInstance(): NeuralTTSBridge {
    if (!NeuralTTSBridge.instance) {
      NeuralTTSBridge.instance = new NeuralTTSBridge();
    }
    return NeuralTTSBridge.instance;
  }

  private constructor() {}

  /**
   * Start the background Python neural worker process
   */
  public async ensureWorker(): Promise<boolean> {
    if (this.isReady && this.workerProc && !this.workerProc.killed) {
      return true;
    }
    if (this.isStarting) {
      // Wait for existing startup
      const start = Date.now();
      while (this.isStarting && Date.now() - start < 30000) {
        await new Promise((r) => setTimeout(r, 200));
        if (this.isReady) return true;
      }
      return this.isReady;
    }

    this.isStarting = true;
    const pythonExe = path.resolve(process.cwd(), '.venv-voice/bin/python');
    const workerScript = path.resolve(process.cwd(), 'src/server/tts/qwen3_worker.py');

    if (!fs.existsSync(pythonExe)) {
      console.warn('[NeuralTTS] .venv-voice/bin/python not found. Neural TTS unavailable.');
      this.isStarting = false;
      return false;
    }

    try {
      console.log('[NeuralTTS] Starting Qwen3-TTS Neural Worker...');
      const proc = spawn(pythonExe, [workerScript], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      this.workerProc = proc;

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === 'ready') {
            this.isReady = true;
            this.isStarting = false;
            console.log('[NeuralTTS] Python Neural Worker is READY.');
          } else if (msg.id && this.pendingRequests.has(msg.id)) {
            const handlers = this.pendingRequests.get(msg.id);
            this.pendingRequests.delete(msg.id);
            handlers?.resolve(msg);
          }
        } catch (err) {
          console.warn('[NeuralTTS] Failed parsing worker stdout:', line, err);
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          console.log(`[NeuralTTS:py] ${text}`);
        }
      });

      proc.on('close', (code) => {
        console.warn(`[NeuralTTS] Worker process exited with code ${code}`);
        this.isReady = false;
        this.isStarting = false;
        this.workerProc = null;
        // Reject all pending
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error(`Worker exited before responding to ${id}`));
        }
        this.pendingRequests.clear();
      });

      // Send init command
      proc.stdin.write(JSON.stringify({ cmd: 'init' }) + '\n');

      // Wait for ready
      const start = Date.now();
      while (!this.isReady && Date.now() - start < 45000) {
        await new Promise((r) => setTimeout(r, 200));
      }

      this.isStarting = false;
      return this.isReady;
    } catch (err) {
      console.error('[NeuralTTS] Failed spawning worker:', err);
      this.isStarting = false;
      return false;
    }
  }

  /**
   * Precompute speaker voice embedding immediately upon enrollment
   */
  public async setVoiceProfile(refFile: string): Promise<boolean> {
    const ready = await this.ensureWorker();
    if (!ready || !this.workerProc) return false;

    const reqId = `set_voice_${++this.reqCounter}_${Date.now()}`;
    return new Promise<boolean>((resolve) => {
      this.pendingRequests.set(reqId, {
        resolve: (msg) => resolve(msg.status === 'ok'),
        reject: () => resolve(false),
      });
      try {
        this.workerProc?.stdin?.write(JSON.stringify({ cmd: 'set_voice', id: reqId, ref_file: refFile }) + '\n');
      } catch {
        this.pendingRequests.delete(reqId);
        resolve(false);
      }
    });
  }

  /**
   * Synthesize text using cloned voice reference audio
   */
  public async synthesize(
    text: string,
    sentenceIndex: number,
    refFile: string,
    abortSignal?: AbortSignal
  ): Promise<SynthesizedChunk | null> {
    if (abortSignal?.aborted) return null;

    const ready = await this.ensureWorker();
    if (!ready || !this.workerProc) {
      console.warn('[NeuralTTS] Worker not ready for synthesis.');
      return null;
    }

    const reqId = `req_${++this.reqCounter}_${Date.now()}`;
    const payload = {
      cmd: 'infer',
      id: reqId,
      text,
      ref_file: refFile,
      ref_text: 'The quick brown fox jumps over the lazy dog near the calm blue river.',
      nfe_step: 8,
      speed: 1.0,
    };

    return new Promise<SynthesizedChunk | null>((resolve, reject) => {
      const abortHandler = () => {
        this.pendingRequests.delete(reqId);
        resolve(null);
      };

      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pendingRequests.set(reqId, {
        resolve: (msg) => {
          if (abortSignal) {
            abortSignal.removeEventListener('abort', abortHandler);
          }
          if (msg.status === 'ok' && msg.data) {
            resolve({
              sentenceIndex,
              format: 'wav',
              dataBase64: msg.data,
            });
          } else {
            console.error('[NeuralTTS] Synthesis error:', msg.error);
            resolve(null);
          }
        },
        reject: (err) => {
          if (abortSignal) {
            abortSignal.removeEventListener('abort', abortHandler);
          }
          reject(err);
        },
      });

      try {
        this.workerProc?.stdin?.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        this.pendingRequests.delete(reqId);
        reject(err);
      }
    });
  }

  public abortAll(): void {
    for (const [id, req] of this.pendingRequests) {
      req.resolve({ status: 'aborted' });
    }
    this.pendingRequests.clear();
  }

  public shutdown(): void {
    this.abortAll();
    if (this.workerProc && !this.workerProc.killed) {
      try {
        this.workerProc.kill('SIGTERM');
      } catch {}
      this.workerProc = null;
    }
    this.isReady = false;
    this.isStarting = false;
  }
}
