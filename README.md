# Local Voice Agent (MacBook Pro M4 + Ollama + Vercel AI SDK)

A 100% local, free, zero-cloud real-time Voice Agent application built with Node.js, WebSockets, the Vercel AI SDK (`ollama-ai-provider`), and a React frontend. Designed for low-latency voice loops and instant **barge-in interruption** on Apple Silicon (M4).

---

## 🌟 Key Features

1. **Local LLM Orchestration**:
   - Powered by [Ollama](https://ollama.com/) running `qwen2.5-coder:32b` on MacBook Pro M4 Unified Memory.
   - Built with Vercel AI SDK (`ai` and `ollama-ai-provider`) using `streamText` and dynamic tool calling.
2. **Bidirectional WebSocket Audio Channel**:
   - Streams raw 16kHz mono linear PCM audio chunks between client and backend over a persistent WebSocket connection (`ws://localhost:3001/ws`).
   - No sequential HTTP polling or cloud STT/TTS APIs.
3. **Instant Barge-in Interruption**:
   - Dual Voice Activity Detection (VAD) system: client-side continuous RMS/energy monitor + server-side audio frame accumulator.
   - The **MOMENT** human speech onset is detected while the AI is speaking, an immediate `user_interrupt` signal fires.
   - Violently aborts the active Vercel AI SDK text stream via `AbortController`, cancels pending TTS generation, purges client audio queues, and immediately silences the speaker output.
4. **Server-Side Tool Calling (Zod Schema)**:
   - Mid-call tool execution directly within the voice stream:
     - `checkMockDatabase`: Inspects local mock records (users, IoT devices, orders, inventory).
     - `getSystemMetrics`: Real-time M4 telemetry (CPU cores, memory usage, load averages, uptime).
     - `querySystemLogs`: Searches recent system/voice engine logs.
     - `saveNote` & `listNotes`: Creates in-memory notes and reminders mid-conversation.
   - Live streaming UI tool cards displaying input arguments, execution latencies, and JSON outputs.
5. **Streaming Text-to-Speech (TTS)**:
   - Low-latency Sentence Segmenter: Token stream is segmented at clause/sentence boundaries (`.`, `!`, `?`, `\n`) and immediately emitted to TTS without waiting for the full response.
   - Supports instant-cancellable browser Web Speech synthesis and macOS native `say` audio chunk streaming.

---

## 🏗️ Architecture Overview

```
                                      [ Browser Client (Port 5173) ]
                                                    │
                                  ┌─────────────────┴─────────────────┐
                                  │   Continuous Mic Stream (16kHz)   │
                                  │   Client VAD (RMS Energy Monitor) │
                                  │   Instant Audio Queue & Kill      │
                                  └─────────────────┬─────────────────┘
                                                    │
                                      Bidirectional WebSocket
                                      (ws://localhost:3001/ws)
                                                    │
                                                    ▼
                                   [ Node.js Server (Port 3001) ]
                        ┌──────────────────────────────────────────────────┐
                        │ - Server VAD Frame Accumulator & Barge-in Monitor│
                        │ - Real-Time Sentence Segmenter (TTFA ~150ms)     │
                        │ - Vercel AI SDK Stream Orchestrator              │
                        │ - AbortController Signal Dispatcher              │
                        └─────────────────┬───────────────┬────────────────┘
                                          │               │
                 Tool Invocations (Zod)   │               │ Ollama REST API (11434)
                                          ▼               ▼
                             ┌─────────────────┐ ┌─────────────────┐
                             │ Local System    │ │ Local Ollama    │
                             │ Telemetry & DB  │ │ qwen2.5-coder   │
                             └─────────────────┘ └─────────────────┘
```

---

## 🚀 Quickstart

### 1. Prerequisites
Ensure you have [Ollama](https://ollama.com/) installed and the `qwen2.5-coder:32b` model pulled:
```bash
# Pull the model (or use qwen2.5-coder:7b / qwen2.5:14b if memory constrained)
ollama pull qwen2.5-coder:32b

# Start Ollama service (if not already running in background)
ollama serve
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Servers
Run both the Node.js backend and the React frontend concurrently:
```bash
npm run dev
```

- **Frontend Client**: [http://localhost:5173](http://localhost:5173)
- **Backend WebSocket Server**: `ws://localhost:3001/ws`
- **Health Endpoint**: [http://localhost:3001/api/health](http://localhost:3001/api/health)

---

## 🎙️ Testing Barge-in & Tool Calling

1. Click **"Start Live Voice Call"** and grant microphone permissions.
2. Speak to the agent (e.g., *"What are our current system metrics on this Mac?"*).
3. Observe:
   - The visualizer turns amber as the `getSystemMetrics` tool executes in ~20ms.
   - The tool execution panel updates with live CPU, memory, and uptime data.
   - The agent responds conversationally with the telemetry data.
4. **Test Barge-in**:
   - Ask: *"Tell me a long story about how artificial intelligence works."*
   - While the agent is speaking, **start talking** or click **"🛑 Barge-in (Kill Active Audio)"**.
   - Notice that the agent audio cuts off **INSTANTLY (<25ms)**, the LLM token generation aborts on the server, and the agent immediately pivots to listen to your new speech!

---

## 📁 Project Structure

```
speech-agent/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── src/
│   ├── types/
│   │   └── protocol.ts           # Shared WebSocket messages & types
│   ├── server/
│   │   ├── index.ts              # HTTP & WebSocket Server entry
│   │   ├── config.ts             # Config & environment options
│   │   ├── llm/
│   │   │   ├── agent.ts          # Vercel AI SDK streamText & abort handler
│   │   │   └── tools.ts          # Zod-based server tools (DB, Metrics, Logs)
│   │   ├── vad/
│   │   │   └── serverVad.ts      # Server-side RMS audio frame monitor
│   │   └── tts/
│   │       ├── sentenceSegmenter.ts # Token-to-sentence streaming segmenter
│   │       └── streamingTts.ts   # Local macOS 'say' / audio chunk generator
│   └── client/
│       ├── main.tsx              # React DOM entry
│       ├── App.tsx               # Root component
│       ├── vad/
│       │   └── clientVad.ts      # Web Audio RMS VAD & mic chunk streamer
│       ├── hooks/
│       │   ├── useVoiceAgent.ts  # Master voice agent hook
│       │   └── useAudioQueuePlayer.ts # Instant-cancellable playback queue
│       └── components/
│           ├── VoiceAgent.tsx    # Master dashboard UI
│           ├── AudioVisualizer.tsx # Dynamic reactive waveform orb
│           ├── TranscriptView.tsx  # Live conversation bubbles & tokens
│           └── ToolExecLog.tsx   # Server tool inspector with JSON viewer
```
