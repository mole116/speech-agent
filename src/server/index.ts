import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { VoiceAgentOrchestrator } from './llm/agent.js';
import { ServerVAD } from './vad/serverVad.js';
import { LocalStreamingTTS } from './tts/streamingTts.js';
import {
  ClientMessage,
  ServerMessage,
  AgentStatus,
  ToolCallLog,
  VoiceCloneProfile,
} from '../types/protocol.js';

function logDebug(tag: string, ...args: unknown[]) {
  console.log(`[${tag}]`, ...args);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const STORAGE_DIR = path.resolve(process.cwd(), 'storage/voice_profiles');
const PROFILE_FILE = path.join(STORAGE_DIR, 'profile.json');
const AUDIO_SAMPLE_FILE = path.join(STORAGE_DIR, 'user_voice.wav');

// Auto-detect existing voice clone profile on server start
if (fs.existsSync(AUDIO_SAMPLE_FILE) && fs.existsSync(PROFILE_FILE)) {
  CONFIG.tts.engine = 'clone';
  try {
    const prof = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
    if (prof.baseVoiceName) {
      CONFIG.tts.voice = prof.baseVoiceName;
    }
    logDebug('VoiceClone', `Enrolled voice profile detected: "${prof.name}". Initialized TTS engine to 'clone'.`);
  } catch (err) {
    logDebug('VoiceClone', 'Could not read existing profile file on boot:', err);
  }
}

async function warmupOllamaModel(modelName: string): Promise<void> {
  try {
    logDebug('Ollama', `Warming up model "${modelName}" with keep_alive: -1...`);
    const res = await fetch(`${CONFIG.ollama.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        keep_alive: -1,
      }),
    });
    if (res.ok) {
      logDebug('Ollama', `Model "${modelName}" successfully locked in memory.`);
    }
  } catch (err) {
    logDebug('Ollama', `Failed warming up model "${modelName}":`, err);
  }
}

// Pre-warm the active model in the background immediately on startup
warmupOllamaModel(CONFIG.ollama.model);

// Basic health & telemetry check endpoint
app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    ollama: {
      baseUrl: CONFIG.ollama.baseUrl,
      model: CONFIG.ollama.model,
    },
    vad: {
      threshold: CONFIG.vad.energyThreshold,
      silenceTimeoutMs: CONFIG.vad.silenceTimeoutMs,
    },
    ttsEngine: CONFIG.tts.engine,
  });
});

// List locally installed Ollama models
app.get('/api/models', async (_req, res) => {
  try {
    const response = await fetch(`${CONFIG.ollama.baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
    const data: any = await response.json();
    const models = (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size,
      details: m.details,
    }));
    return res.json({ models, activeModel: CONFIG.ollama.model });
  } catch (err: any) {
    return res.json({ models: [{ name: CONFIG.ollama.model }], activeModel: CONFIG.ollama.model });
  }
});

// Voice Cloning REST Endpoints
app.get('/api/voice-clone/profile', (_req, res) => {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const data: VoiceCloneProfile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
      return res.json({ enrolled: true, profile: data });
    }
  } catch (err) {
    logDebug('VoiceClone', 'Failed reading profile file:', err);
  }
  return res.json({ enrolled: false, profile: null });
});

app.post('/api/voice-clone/enroll', async (req, res) => {
  try {
    const { profile, audioBase64 } = req.body;
    if (!profile) {
      return res.status(400).json({ error: 'Missing profile data' });
    }
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');

    if (audioBase64) {
      const base64Clean = audioBase64.includes(';base64,')
        ? audioBase64.split(';base64,')[1]
        : audioBase64;
      const rawBuffer = Buffer.from(base64Clean, 'base64');
      const webmPath = path.join(STORAGE_DIR, 'user_voice.webm');
      fs.writeFileSync(webmPath, rawBuffer);

      // Convert to 24kHz mono WAV using local ffmpeg if available
      const ffmpegExe = path.resolve(process.cwd(), '.venv-voice/bin/ffmpeg');
      if (fs.existsSync(ffmpegExe)) {
        try {
          const { spawnSync } = await import('child_process');
          spawnSync(ffmpegExe, ['-y', '-i', webmPath, '-ar', '24000', '-ac', '1', AUDIO_SAMPLE_FILE]);
        } catch {
          fs.writeFileSync(AUDIO_SAMPLE_FILE, rawBuffer);
        }
      } else {
        fs.writeFileSync(AUDIO_SAMPLE_FILE, rawBuffer);
      }
    }

    CONFIG.tts.engine = 'clone';
    if (profile.baseVoiceName) {
      CONFIG.tts.voice = profile.baseVoiceName;
    }

    // Immediately precompute Qwen3-TTS speaker embedding in background
    const { NeuralTTSBridge } = await import('./tts/neuralTtsBridge.js');
    NeuralTTSBridge.getInstance().setVoiceProfile(AUDIO_SAMPLE_FILE).catch((e) => {
      logDebug('VoiceClone', 'Failed precomputing voice embedding:', e);
    });

    logDebug(
      'VoiceClone',
      `Profile enrolled: ${profile.name} (pitch=${profile.pitch}, rate=${profile.rate}, base=${profile.baseVoiceName}). TTS engine set to 'clone'.`
    );
    return res.json({ success: true, profile });
  } catch (err: any) {
    logDebug('VoiceClone', 'Error enrolling voice:', err);
    return res.status(500).json({ error: err.message || 'Failed to save voice profile' });
  }
});

app.post('/api/voice-clone/preview', async (req, res) => {
  try {
    const text = req.body?.text || 'Hello Moshe! This is your voice agent speaking back in your actual cloned voice.';
    const refWav = AUDIO_SAMPLE_FILE;
    if (!fs.existsSync(refWav)) {
      return res.status(400).json({ error: 'No voice sample enrolled yet. Please record a voice sample first.' });
    }

    const { NeuralTTSBridge } = await import('./tts/neuralTtsBridge.js');
    const chunk = await NeuralTTSBridge.getInstance().synthesize(text, 0, refWav);
    if (!chunk || !chunk.dataBase64) {
      return res.status(500).json({ error: 'Neural synthesis failed' });
    }
    return res.json({ success: true, audioBase64: chunk.dataBase64, format: 'wav' });
  } catch (err: any) {
    logDebug('VoiceClone', 'Preview error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/voice-clone/profile', (_req, res) => {
  try {
    if (fs.existsSync(PROFILE_FILE)) fs.unlinkSync(PROFILE_FILE);
    if (fs.existsSync(AUDIO_SAMPLE_FILE)) fs.unlinkSync(AUDIO_SAMPLE_FILE);
    logDebug('VoiceClone', 'Profile deleted');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientSession {
  ws: WebSocket;
  id: string;
  agent: VoiceAgentOrchestrator;
  vad: ServerVAD;
  tts: LocalStreamingTTS;
  ttsEngine: 'browser' | 'say' | 'clone';
  ttsVoice: string;
  status: AgentStatus;
  currentTurnId: string | null;
  activeToolCalls: Map<string, ToolCallLog>;
}

const sessions = new Map<WebSocket, ClientSession>();

function sendJson(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('error', (err) => {
  console.error('[WebSocketServer] Error:', err);
});

wss.on('connection', (ws: WebSocket) => {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  logDebug('WebSocket', `Client connected: ${sessionId}`);

  const session: ClientSession = {
    ws,
    id: sessionId,
    agent: new VoiceAgentOrchestrator(),
    vad: new ServerVAD(),
    tts: new LocalStreamingTTS(),
    ttsEngine: CONFIG.tts.engine,
    ttsVoice: CONFIG.tts.voice,
    status: 'idle',
    currentTurnId: null,
    activeToolCalls: new Map(),
  };

  sessions.set(ws, session);

  // Send initial session handshake
  sendJson(ws, {
    type: 'session_info',
    sessionId,
    model: CONFIG.ollama.model,
    ttsEngine: CONFIG.tts.engine,
    supportedTools: ['checkMockDatabase', 'getSystemMetrics', 'querySystemLogs', 'saveNote', 'listNotes'],
  });

  const updateStatus = (status: AgentStatus, detail?: string) => {
    session.status = status;
    logDebug('AgentStatus', sessionId, status, detail || '');
    sendJson(ws, {
      type: 'agent_status',
      status,
      turnId: session.currentTurnId || undefined,
      detail,
    });
  };

  /**
   * Universal Barge-in / Interruption Handler
   * Stops active speech playback and halts generation when AI is speaking, thinking, or running tools.
   */
  const executeBargeIn = (reason: string) => {
    // Cannot interrupt if already idle or already interrupted
    if (session.status === 'idle' || session.status === 'interrupted') {
      return;
    }

    logDebug('Barge-in', `Triggered: ${reason} (was: ${session.status}). Halting AI.`);
    session.agent.abortCurrentTurn(reason);
    session.tts.abort();
    session.vad.reset();

    updateStatus('interrupted', reason);

    sendJson(ws, {
      type: 'interrupt_confirmed',
      turnId: session.currentTurnId || undefined,
      timestamp: Date.now(),
    });
  };

  /**
   * Handle user utterance text (from client speech recognition or STT)
   */
  const handleUserUtterance = async (text: string, clientMessageId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // If AI was actively processing or speaking a previous turn, immediately abort it
    if (session.status === 'speaking' || session.status === 'thinking' || session.status === 'tool_executing') {
      executeBargeIn('new_user_utterance');
    }

    const turnId = `turn_${Date.now()}`;
    session.currentTurnId = turnId;
    session.activeToolCalls.clear();

    logDebug('Utterance', `User [${turnId}]: "${trimmed}"`);

    // Broadcast user transcript entry
    sendJson(ws, {
      type: 'transcript_update',
      turnId,
      entry: {
        id: clientMessageId || `user_${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
        isFinal: true,
      },
    });

    updateStatus('thinking');

    const pendingTtsPromises: Promise<void>[] = [];

    // Run Vercel AI SDK pipeline
    logDebug('LLM', `Calling streamResponse for turn ${turnId}...`);
    await session.agent.streamResponse(trimmed, {
      onTextDelta: (delta, fullText) => {
        if (session.currentTurnId !== turnId) return;
        if (session.status !== 'speaking') {
          updateStatus('speaking');
        }
        sendJson(ws, {
          type: 'text_delta',
          turnId,
          delta,
          fullText,
        });
      },

      onSentence: async (sentence, sentenceIndex, isFinal) => {
        if (session.currentTurnId !== turnId) return;
        // Send sentence metadata down the WebSocket
        sendJson(ws, {
          type: 'tts_sentence',
          turnId,
          sentenceIndex,
          text: sentence,
          isFinal,
        });

        // If server-side TTS audio chunks are enabled (e.g. macOS 'say' or Qwen3-TTS 'clone'), synthesize and stream raw audio chunk
        if (session.ttsEngine === 'say' || session.ttsEngine === 'clone') {
          if (session.ttsEngine === 'clone') {
            updateStatus('speaking', 'Synthesizing voice with Qwen3-TTS...');
          }
          const synthPromise = (async () => {
            const chunk = await session.tts.synthesize(sentence, sentenceIndex, undefined, session.ttsEngine);
            if (chunk && session.currentTurnId === turnId && session.ttsEngine === 'clone') {
              sendJson(ws, {
                type: 'audio_chunk',
                turnId,
                sentenceIndex,
                format: 'wav',
                data: chunk.dataBase64,
              });
            }
          })();
          pendingTtsPromises.push(synthPromise);
        }
      },

      onToolCallStart: (toolCallId, toolName, args) => {
        if (session.currentTurnId !== turnId) return;
        updateStatus('tool_executing', `Executing ${toolName}...`);
        const toolLog: ToolCallLog = {
          id: toolCallId,
          name: toolName,
          args,
          status: 'calling',
          timestamp: Date.now(),
        };
        session.activeToolCalls.set(toolCallId, toolLog);

        sendJson(ws, {
          type: 'tool_call_start',
          turnId,
          toolCallId,
          toolName,
          args,
          timestamp: Date.now(),
        });
      },

      onToolCallComplete: (toolCallId, toolName, result, durationMs) => {
        if (session.currentTurnId !== turnId) return;
        const existing = session.activeToolCalls.get(toolCallId);
        if (existing) {
          existing.status = 'success';
          existing.result = result;
          existing.durationMs = durationMs;
        }

        sendJson(ws, {
          type: 'tool_call_complete',
          turnId,
          toolCallId,
          toolName,
          result,
          durationMs,
          timestamp: Date.now(),
        });
      },

      onFinish: async (fullText, interrupted) => {
        if (session.currentTurnId !== turnId) return;
        logDebug('Finish', `Assistant [${turnId}]: length=${fullText.length}, interrupted=${interrupted}`);

        // Await all in-flight sentence TTS synthesis tasks for this turn before committing the transcript
        if (pendingTtsPromises.length > 0) {
          try {
            await Promise.all(pendingTtsPromises);
          } catch (e) {
            logDebug('Finish', 'TTS synthesis error during completion:', e);
          }
        }

        if (session.currentTurnId !== turnId) return;

        // Broadcast final assistant transcript entry once synthesis has completed
        sendJson(ws, {
          type: 'transcript_update',
          turnId,
          entry: {
            id: `asst_${Date.now()}`,
            role: 'assistant',
            text: fullText,
            timestamp: Date.now(),
            interrupted,
            toolCalls: Array.from(session.activeToolCalls.values()),
          },
        });

        updateStatus('idle');
      },

      onError: (err) => {
        if (session.currentTurnId !== turnId) return;
        logDebug('Error', `Agent error [${turnId}]:`, err.message);
        sendJson(ws, {
          type: 'error',
          message: `Ollama inference error: ${err.message}`,
        });
        updateStatus('idle');
      },
    });
  };

  // Process incoming messages from browser client
  ws.on('message', async (data: Buffer | string, isBinary: boolean) => {
    try {
      // 1. Raw Binary Audio Chunk (e.g. PCM 16-bit 16kHz from AudioWorklet)
      if (isBinary && Buffer.isBuffer(data)) {
        const isAiSpeaking = session.status === 'speaking';
        const vadEvent = session.vad.processAudioChunk(data, isAiSpeaking);

        if (vadEvent && isAiSpeaking && vadEvent.type === 'barge_in') {
          executeBargeIn('server_vad_audio_threshold');
        }
        return;
      }

      // 2. JSON Control Messages
      const msgStr = data.toString('utf-8');
      const message: ClientMessage = JSON.parse(msgStr);

      if (message.type !== 'audio_chunk' && message.type !== 'ping') {
        logDebug('WS_RECV', session.id, message.type, message.type === 'user_transcript' ? `"${message.text}"` : '');
      }

      switch (message.type) {
        case 'user_interrupt':
          // Explicit barge-in command (from UI button or user voice)
          logDebug('WebSocket', `Explicit user_interrupt received: ${message.reason}`);
          executeBargeIn(`client_vad_${message.reason}`);
          break;

        case 'user_speech_start':
          // NOTE: Do NOT barge-in on standard user_speech_start (RMS >= 0.030) as this causes speaker acoustic feedback loops.
          if (session.status === 'idle') {
            updateStatus('listening');
          }
          break;

        case 'user_speech_end':
          break;

        case 'user_transcript':
          if (message.isFinal && message.text?.trim()) {
            logDebug('WebSocket', `Dispatching user_transcript: "${message.text.trim()}"`);
            await handleUserUtterance(message.text, message.id);
          }
          break;

        case 'audio_chunk':
          if (message.data) {
            const pcmBuffer = Buffer.from(message.data, 'base64');
            const isAiSpeaking = session.status === 'speaking';
            const vadEvent = session.vad.processAudioChunk(pcmBuffer, isAiSpeaking);

            if (vadEvent?.type === 'barge_in' && session.status === 'speaking') {
              logDebug('WebSocket', 'Server VAD detected loud sustained barge-in during AI speech.');
              executeBargeIn('server_vad_base64_barge_in');
            }
          }
          break;

        case 'set_config':
          if (message.config.model) {
            CONFIG.ollama.model = message.config.model;
            session.agent.setModel(message.config.model);
            warmupOllamaModel(message.config.model);
            logDebug('Config', `Model changed to: ${CONFIG.ollama.model}`);
          }
          if (message.config.ttsEngine) {
            session.ttsEngine = message.config.ttsEngine;
            CONFIG.tts.engine = message.config.ttsEngine;
            logDebug('Config', `TTS engine changed to: ${session.ttsEngine}`);
          }
          if (message.config.ttsVoice) {
            session.ttsVoice = message.config.ttsVoice;
            CONFIG.tts.voice = message.config.ttsVoice;
            logDebug('Config', `TTS voice changed to: ${session.ttsVoice}`);
          }
          if (message.config.voiceProfile && message.config.ttsEngine === 'clone') {
            logDebug('Config', `Active voice profile updated: ${message.config.voiceProfile.name}`);
            session.ttsEngine = 'clone';
            CONFIG.tts.engine = 'clone';
            if (message.config.voiceProfile.baseVoiceName) {
              session.ttsVoice = message.config.voiceProfile.baseVoiceName;
              CONFIG.tts.voice = message.config.voiceProfile.baseVoiceName;
            }
          }
          break;

        case 'ping':
          logDebug('PING', `From ${session.id}`);
          sendJson(ws, { type: 'pong', timestamp: Date.now() });
          break;
      }
    } catch (err) {
      logDebug('WebSocket', 'Message handling error:', err);
    }
  });

  ws.on('close', () => {
    logDebug('WebSocket', `Client disconnected: ${sessionId}`);
    session.agent.abortCurrentTurn('client_disconnect');
    session.tts.abort();
    sessions.delete(ws);
  });

  ws.on('error', (err) => {
    logDebug('WebSocket', `Socket error (${sessionId}):`, err);
  });
});

server.listen(CONFIG.port, () => {
  console.log(`=======================================================`);
  console.log(`🎙️  Local Voice Agent Server running on http://127.0.0.1:${CONFIG.port} and http://localhost:${CONFIG.port}`);
  console.log(`📡 WebSocket Channel listening at ws://127.0.0.1:${CONFIG.port}/ws`);
  console.log(`🧠 LLM Backend: Ollama (${CONFIG.ollama.baseUrl}) -> ${CONFIG.ollama.model}`);
  console.log(`⚡ VAD Sensitivity: RMS threshold = ${CONFIG.vad.energyThreshold}`);
  console.log(`🔊 Streaming TTS Engine: ${CONFIG.tts.engine}`);
  console.log(`=======================================================`);
});
