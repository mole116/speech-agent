import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { VoiceAgentOrchestrator } from './llm/agent.js';
import { ServerVAD } from './vad/serverVad.js';
import { LocalStreamingTTS } from './tts/streamingTts.js';
const app = express();
app.use(cors());
app.use(express.json());
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
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessions = new Map();
function sendJson(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
wss.on('connection', (ws) => {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`[WebSocket] Client connected: ${sessionId}`);
    const session = {
        ws,
        id: sessionId,
        agent: new VoiceAgentOrchestrator(),
        vad: new ServerVAD(),
        tts: new LocalStreamingTTS(),
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
    const updateStatus = (status, detail) => {
        session.status = status;
        sendJson(ws, {
            type: 'agent_status',
            status,
            turnId: session.currentTurnId || undefined,
            detail,
        });
    };
    /**
     * Universal Barge-in / Interruption Handler
     * Stops active LLM generation, halts TTS subprocesses, and notifies client to purge audio buffers immediately.
     */
    const executeBargeIn = (reason) => {
        const isAiActive = session.status === 'speaking' || session.status === 'thinking' || session.status === 'tool_executing' || session.agent.isBusy();
        if (isAiActive) {
            console.log(`[Barge-in] Triggered: ${reason}. Forcibly halting AI stream.`);
            session.agent.abortCurrentTurn(reason);
            session.tts.abort();
            session.vad.reset();
            updateStatus('interrupted', reason);
            sendJson(ws, {
                type: 'interrupt_confirmed',
                turnId: session.currentTurnId || undefined,
                timestamp: Date.now(),
            });
            session.status = 'listening';
        }
    };
    /**
     * Handle user utterance text (from client speech recognition or STT)
     */
    const handleUserUtterance = async (text) => {
        const trimmed = text.trim();
        if (!trimmed)
            return;
        // Barge-in check: if AI was speaking, kill it first
        executeBargeIn('new_user_utterance');
        const turnId = `turn_${Date.now()}`;
        session.currentTurnId = turnId;
        session.activeToolCalls.clear();
        console.log(`[Utterance] User [${turnId}]: "${trimmed}"`);
        // Broadcast user transcript entry
        sendJson(ws, {
            type: 'transcript_update',
            turnId,
            entry: {
                id: `user_${Date.now()}`,
                role: 'user',
                text: trimmed,
                timestamp: Date.now(),
                isFinal: true,
            },
        });
        updateStatus('thinking');
        // Run Vercel AI SDK pipeline
        await session.agent.streamResponse(trimmed, {
            onTextDelta: (delta, fullText) => {
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
                // Send sentence metadata down the WebSocket
                sendJson(ws, {
                    type: 'tts_sentence',
                    turnId,
                    sentenceIndex,
                    text: sentence,
                    isFinal,
                });
                // If server-side TTS audio chunks are enabled (e.g. macOS 'say'), synthesize and stream raw audio chunk
                if (CONFIG.tts.engine === 'say') {
                    const chunk = await session.tts.synthesize(sentence, sentenceIndex);
                    if (chunk) {
                        sendJson(ws, {
                            type: 'audio_chunk',
                            turnId,
                            sentenceIndex,
                            format: 'wav',
                            data: chunk.dataBase64,
                        });
                    }
                }
            },
            onToolCallStart: (toolCallId, toolName, args) => {
                updateStatus('tool_executing', `Executing ${toolName}...`);
                const toolLog = {
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
            onFinish: (fullText, interrupted) => {
                console.log(`[Finish] Assistant [${turnId}]: length=${fullText.length}, interrupted=${interrupted}`);
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
                if (session.status !== 'interrupted') {
                    updateStatus('idle');
                }
            },
            onError: (err) => {
                console.error(`[Error] Agent error [${turnId}]:`, err.message);
                sendJson(ws, {
                    type: 'error',
                    message: `Ollama inference error: ${err.message}`,
                });
                updateStatus('idle');
            },
        });
    };
    // Process incoming messages from browser client
    ws.on('message', async (data, isBinary) => {
        try {
            // 1. Raw Binary Audio Chunk (e.g. PCM 16-bit 16kHz from AudioWorklet)
            if (isBinary && Buffer.isBuffer(data)) {
                const isAiSpeaking = session.status === 'speaking' || session.status === 'thinking' || session.agent.isBusy();
                const vadEvent = session.vad.processAudioChunk(data, isAiSpeaking);
                if (vadEvent) {
                    if (vadEvent.type === 'barge_in') {
                        executeBargeIn('server_vad_audio_threshold');
                    }
                    else if (vadEvent.type === 'speech_start') {
                        if (isAiSpeaking) {
                            executeBargeIn('server_vad_speech_start');
                        }
                        else {
                            updateStatus('listening');
                        }
                    }
                }
                return;
            }
            // 2. JSON Control Messages
            const msgStr = data.toString('utf-8');
            const message = JSON.parse(msgStr);
            switch (message.type) {
                case 'user_interrupt':
                    // Violent client-side VAD barge-in signal
                    executeBargeIn(`client_vad_${message.reason}`);
                    break;
                case 'user_speech_start':
                    // Client VAD onset detected
                    if (session.status === 'speaking' || session.status === 'thinking' || session.agent.isBusy()) {
                        executeBargeIn('client_vad_speech_onset');
                    }
                    else {
                        updateStatus('listening');
                    }
                    break;
                case 'user_speech_end':
                    // Client VAD silence detected
                    break;
                case 'user_transcript':
                    if (message.isFinal) {
                        await handleUserUtterance(message.text);
                    }
                    else {
                        // Interim speech feedback
                        if (session.status === 'speaking' || session.status === 'thinking') {
                            executeBargeIn('client_interim_transcript');
                        }
                    }
                    break;
                case 'audio_chunk':
                    // Base64-encoded PCM audio chunk over JSON
                    if (message.data) {
                        const pcmBuffer = Buffer.from(message.data, 'base64');
                        const isAiSpeaking = session.status === 'speaking' || session.status === 'thinking' || session.agent.isBusy();
                        const vadEvent = session.vad.processAudioChunk(pcmBuffer, isAiSpeaking);
                        if (vadEvent?.type === 'barge_in') {
                            executeBargeIn('server_vad_base64_barge_in');
                        }
                    }
                    break;
                case 'set_config':
                    if (message.config.model) {
                        CONFIG.ollama.model = message.config.model;
                        console.log(`[Config] Model changed to: ${CONFIG.ollama.model}`);
                    }
                    if (message.config.ttsEngine) {
                        CONFIG.tts.engine = message.config.ttsEngine;
                    }
                    break;
                case 'ping':
                    sendJson(ws, { type: 'pong', timestamp: Date.now() });
                    break;
            }
        }
        catch (err) {
            console.error('[WebSocket] Message handling error:', err);
        }
    });
    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${sessionId}`);
        session.agent.abortCurrentTurn('client_disconnect');
        session.tts.abort();
        sessions.delete(ws);
    });
    ws.on('error', (err) => {
        console.error(`[WebSocket] Socket error (${sessionId}):`, err);
    });
});
server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🎙️  Local Voice Agent Server running on http://localhost:${CONFIG.port} and http://127.0.0.1:${CONFIG.port}`);
    console.log(`📡 WebSocket Channel listening at ws://127.0.0.1:${CONFIG.port}/ws`);
    console.log(`🧠 LLM Backend: Ollama (${CONFIG.ollama.baseUrl}) -> ${CONFIG.ollama.model}`);
    console.log(`⚡ VAD Sensitivity: RMS threshold = ${CONFIG.vad.energyThreshold}`);
    console.log(`🔊 Streaming TTS Engine: ${CONFIG.tts.engine}`);
    console.log(`=======================================================`);
});
