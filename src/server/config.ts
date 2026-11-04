import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  port: parseInt(process.env.PORT || '3001', 10),
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7'),
  },
  vad: {
    energyThreshold: parseFloat(process.env.VAD_ENERGY_THRESHOLD || '0.035'),
    silenceTimeoutMs: parseInt(process.env.VAD_SILENCE_TIMEOUT_MS || '750', 10),
    sampleRate: 16000,
    frameSize: 512,
  },
  tts: {
    engine: (process.env.TTS_ENGINE || 'browser') as 'browser' | 'say' | 'clone',
    voice: process.env.TTS_VOICE || 'Samantha', // for macOS 'say'
  },
  systemPrompt: `You are a real-time conversational voice assistant running entirely locally on a MacBook Pro M4 powered by qwen2.5-coder:32b.
Guidelines for your voice responses:
- Keep answers concise, natural, and conversational (1 to 3 sentences where possible) because the user is listening to speech.
- Avoid markdown formatting like tables, headers, code blocks, or bullet lists unless specifically requested, as they sound unnatural when spoken.
- Use your tools proactively whenever the user asks about local system metrics, database records, server logs, or notes.
- If a tool is executed, summarize the result smoothly into natural spoken dialogue.
- Be direct, friendly, and helpful.`,
};
