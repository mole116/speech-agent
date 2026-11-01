/**
 * Bidirectional WebSocket Protocol Definitions for Local Voice Agent
 */

export type AgentStatus =
  | 'disconnected'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'tool_executing'
  | 'interrupted';

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCallLog {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'calling' | 'success' | 'error';
  timestamp: number;
  durationMs?: number;
}

export interface TranscriptEntry {
  id: string;
  role: Role;
  text: string;
  timestamp: number;
  isFinal?: boolean;
  interrupted?: boolean;
  toolCalls?: ToolCallLog[];
}

// ==========================================
// Client -> Server Messages
// ==========================================

export interface ClientAudioChunkMessage {
  type: 'audio_chunk';
  data: string; // Base64 encoded PCM 16-bit 16kHz mono
  sampleRate: number;
  timestamp: number;
}

export interface ClientSpeechStartMessage {
  type: 'user_speech_start';
  timestamp: number;
}

export interface ClientSpeechEndMessage {
  type: 'user_speech_end';
  timestamp: number;
}

export interface ClientInterruptMessage {
  type: 'user_interrupt';
  reason: 'vad_barge_in' | 'manual';
  timestamp: number;
}

export interface ClientTranscriptMessage {
  type: 'user_transcript';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface ClientSetConfigMessage {
  type: 'set_config';
  config: {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    ttsEngine?: 'browser' | 'say';
  };
}

export interface ClientPingMessage {
  type: 'ping';
  timestamp: number;
}

export type ClientMessage =
  | ClientAudioChunkMessage
  | ClientSpeechStartMessage
  | ClientSpeechEndMessage
  | ClientInterruptMessage
  | ClientTranscriptMessage
  | ClientSetConfigMessage
  | ClientPingMessage;

// ==========================================
// Server -> Client Messages
// ==========================================

export interface ServerSessionInfoMessage {
  type: 'session_info';
  sessionId: string;
  model: string;
  ttsEngine: string;
  supportedTools: string[];
}

export interface ServerAgentStatusMessage {
  type: 'agent_status';
  status: AgentStatus;
  turnId?: string;
  detail?: string;
}

export interface ServerTextDeltaMessage {
  type: 'text_delta';
  turnId: string;
  delta: string;
  fullText: string;
}

export interface ServerTtsSentenceMessage {
  type: 'tts_sentence';
  turnId: string;
  sentenceIndex: number;
  text: string;
  isFinal: boolean;
}

export interface ServerAudioChunkMessage {
  type: 'audio_chunk';
  turnId: string;
  sentenceIndex: number;
  format: 'wav' | 'pcm' | 'mp3';
  data: string; // Base64 audio data
}

export interface ServerToolCallStartMessage {
  type: 'tool_call_start';
  turnId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface ServerToolCallCompleteMessage {
  type: 'tool_call_complete';
  turnId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  durationMs: number;
  timestamp: number;
}

export interface ServerInterruptConfirmedMessage {
  type: 'interrupt_confirmed';
  turnId?: string;
  timestamp: number;
}

export interface ServerTranscriptUpdateMessage {
  type: 'transcript_update';
  turnId: string;
  entry: TranscriptEntry;
}

export interface ServerErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export interface ServerPongMessage {
  type: 'pong';
  timestamp: number;
}

export type ServerMessage =
  | ServerSessionInfoMessage
  | ServerAgentStatusMessage
  | ServerTextDeltaMessage
  | ServerTtsSentenceMessage
  | ServerAudioChunkMessage
  | ServerToolCallStartMessage
  | ServerToolCallCompleteMessage
  | ServerInterruptConfirmedMessage
  | ServerTranscriptUpdateMessage
  | ServerErrorMessage
  | ServerPongMessage;
