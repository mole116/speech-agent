import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AgentStatus,
  TranscriptEntry,
  ToolCallLog,
  ServerMessage,
  ClientMessage,
} from '../../types/protocol.js';
import { ClientVAD } from '../vad/clientVad.js';
import { useAudioQueuePlayer } from './useAudioQueuePlayer.js';

interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export function useVoiceAgent() {
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected');
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [modelName, setModelName] = useState<string>('qwen2.5-coder:32b');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentAssistantText, setCurrentAssistantText] = useState<string>('');
  const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([]);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const vadRef = useRef<ClientVAD | null>(null);
  const recognitionRef = useRef<any>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const isAiSpeakingRef = useRef<boolean>(false);
  const isCallingRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Audio queue player
  const audioPlayer = useAudioQueuePlayer({
    onPlaybackStateChange: (isPlaying) => {
      isAiSpeakingRef.current = isPlaying;
      if (vadRef.current) {
        vadRef.current.setAiSpeaking(isPlaying);
      }
      if (!isPlaying) {
        setAgentStatus((prev) => (prev === 'speaking' ? 'idle' : prev));
      }
    },
  });

  const audioPlayerRef = useRef(audioPlayer);
  audioPlayerRef.current = audioPlayer;

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  /**
   * Universal Barge-in Kill Switch
   */
  const triggerBargeIn = useCallback((reason: 'vad_barge_in' | 'manual' = 'manual') => {
    console.warn(`[VoiceAgent] 🚨 BARGE-IN TRIGGERED: ${reason}`);

    audioPlayerRef.current.cancelAllPlayback();
    isAiSpeakingRef.current = false;
    if (vadRef.current) {
      vadRef.current.setAiSpeaking(false);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_interrupt',
          reason,
          timestamp: Date.now(),
        })
      );
    }

    setCurrentAssistantText((prev) => (prev ? `${prev} [interrupted]` : ''));
    setAgentStatus('interrupted');
    setStatusDetail('Interrupted by user');
  }, []);

  /**
   * Message handler from server
   */
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'session_info':
        setModelName(msg.model);
        setAgentStatus('idle');
        break;

      case 'agent_status':
        setAgentStatus(msg.status);
        if (msg.detail) setStatusDetail(msg.detail);
        break;

      case 'text_delta':
        currentTurnIdRef.current = msg.turnId;
        setCurrentAssistantText(msg.fullText);
        break;

      case 'tts_sentence':
        audioPlayerRef.current.enqueueSentence(msg.text, msg.turnId, msg.sentenceIndex);
        break;

      case 'audio_chunk':
        audioPlayerRef.current.enqueueAudioChunk(msg.data, msg.turnId, msg.sentenceIndex);
        break;

      case 'tool_call_start': {
        const log: ToolCallLog = {
          id: msg.toolCallId,
          name: msg.toolName,
          args: msg.args,
          status: 'calling',
          timestamp: msg.timestamp,
        };
        setToolLogs((prev) => [...prev, log]);
        break;
      }

      case 'tool_call_complete':
        setToolLogs((prev) =>
          prev.map((log) =>
            log.id === msg.toolCallId
              ? {
                  ...log,
                  status: 'success',
                  result: msg.result,
                  durationMs: msg.durationMs,
                }
              : log
          )
        );
        break;

      case 'interrupt_confirmed':
        audioPlayerRef.current.cancelAllPlayback();
        isAiSpeakingRef.current = false;
        setAgentStatus('listening');
        setStatusDetail('Interrupted. Listening...');
        break;

      case 'transcript_update':
        setTranscript((prev) => {
          const idx = prev.findIndex((e) => e.id === msg.entry.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = msg.entry;
            return updated;
          }
          return [...prev, msg.entry];
        });
        if (msg.entry.role === 'assistant') {
          setCurrentAssistantText('');
        }
        break;

      case 'error':
        setError(msg.message);
        setAgentStatus('idle');
        break;
    }
  }, []);

  const handleServerMessageRef = useRef(handleServerMessage);
  handleServerMessageRef.current = handleServerMessage;

  /**
   * Connect WebSocket directly to Port 3001
   */
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || '127.0.0.1';
    const wsUrl = `${wsProtocol}//${host}:3001/ws`;

    console.log(`[VoiceAgent] Connecting WebSocket directly to ${wsUrl}...`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[VoiceAgent] Socket instantiation error:', e);
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[VoiceAgent] WebSocket connection established successfully.');
      setIsConnected(true);
      setError(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessageRef.current(msg);
      } catch (err) {
        console.error('[VoiceAgent] Failed to parse server message:', err);
      }
    };

    ws.onclose = (event) => {
      console.log(`[VoiceAgent] WebSocket closed (code=${event.code}). Retrying in 2s...`);
      setIsConnected(false);
      setAgentStatus('disconnected');
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[VoiceAgent] WebSocket error:', err);
      setError('Cannot connect to local Voice Agent server (Port 3001). Retrying...');
      setIsConnected(false);
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!reconnectTimerRef.current) {
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWebSocket();
      }, 2000);
    }
  }, [connectWebSocket]);

  /**
   * Initializes local continuous speech recognition (Web Speech API)
   */
  const initSpeechRecognition = useCallback(() => {
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] SpeechRecognition not supported in this browser.');
      setError('Browser speech recognition unavailable. Please use Google Chrome or Safari.');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      console.log('[STT] Speech recognition started actively listening.');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      // Echo guard: ignore microphone input while AI is outputting speech
      if (isAiSpeakingRef.current) {
        return;
      }

      if (interim) {
        setStatusDetail(`Hearing: "${interim}"...`);
      }

      if (finalTranscript.trim()) {
        const text = finalTranscript.trim();
        const userMsgId = `user_${Date.now()}`;
        console.log('[STT] Final Recognized Speech:', text);
        setStatusDetail(`You said: "${text}"`);

        // Optimistically render in Live Transcript immediately!
        setTranscript((prev) => [
          ...prev,
          {
            id: userMsgId,
            role: 'user',
            text,
            timestamp: Date.now(),
            isFinal: true,
          },
        ]);

        sendMessage({
          type: 'user_transcript',
          id: userMsgId,
          text,
          isFinal: true,
          timestamp: Date.now(),
        });
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[STT] Speech recognition warning:', e.error);
        if (e.error === 'not-allowed') {
          setError('Microphone permission for Speech Recognition was blocked. Please allow mic access in your browser.');
        } else if (e.error === 'network') {
          console.warn('[STT] Speech recognition network service momentary blip.');
        }
      }
    };

    // CRITICAL: Ensure continuous listening across Chrome silence timeouts using isCallingRef!
    recognition.onend = () => {
      console.log('[STT] Recognition session ended. isCalling:', isCallingRef.current);
      if (isCallingRef.current) {
        try {
          recognition.start();
          console.log('[STT] Recognition session auto-restarted.');
        } catch (err) {
          console.warn('[STT] Auto-restart collision:', err);
        }
      }
    };

    return recognition;
  }, [sendMessage]);

  /**
   * Starts a voice call session
   */
  const startCall = async () => {
    try {
      setError(null);
      isCallingRef.current = true;
      setIsCalling(true);

      // 1. Initialize Client VAD with acoustic echo suppression
      const vad = new ClientVAD({
        energyThreshold: 0.030,
        bargeInThreshold: 0.14,
        silenceTimeoutMs: 750,
        onSpeechStart: () => {
          sendMessage({ type: 'user_speech_start', timestamp: Date.now() });
        },
        onSpeechEnd: () => {
          sendMessage({ type: 'user_speech_end', timestamp: Date.now() });
        },
        onBargeIn: () => {
          triggerBargeIn('vad_barge_in');
        },
        onAudioChunk: (_pcm, base64) => {
          sendMessage({
            type: 'audio_chunk',
            data: base64,
            sampleRate: 16000,
            timestamp: Date.now(),
          });
        },
        onVolumeChange: (vol) => {
          setVolumeLevel(vol);
        },
      });

      await vad.start();
      vadRef.current = vad;

      // 2. Start STT recognition
      const recognition = initSpeechRecognition();
      if (recognition) {
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch (err) {
          console.warn('[STT] Start call recognition error:', err);
        }
      }

      setAgentStatus('listening');
      setStatusDetail('Listening for your voice...');
    } catch (err: unknown) {
      console.error('[VoiceAgent] Failed to start call:', err);
      isCallingRef.current = false;
      setIsCalling(false);
      setError((err as Error).message || 'Microphone access denied or audio device unavailable.');
    }
  };

  /**
   * Ends the voice call session
   */
  const endCall = () => {
    isCallingRef.current = false;
    setIsCalling(false);

    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    audioPlayerRef.current.cancelAllPlayback();
    setVolumeLevel(0);
    setAgentStatus('idle');
    setStatusDetail('Call ended.');
  };

  /**
   * Manual text query injection (also adds optimistically to transcript)
   */
  const sendTextQuery = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (isAiSpeakingRef.current) {
      triggerBargeIn('manual');
    }

    const userMsgId = `user_${Date.now()}`;
    setTranscript((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
        isFinal: true,
      },
    ]);

    sendMessage({
      type: 'user_transcript',
      id: userMsgId,
      text: trimmed,
      isFinal: true,
      timestamp: Date.now(),
    });
  };

  const clearTranscript = () => {
    setTranscript([]);
    setToolLogs([]);
    setCurrentAssistantText('');
  };

  // Mount effect: connects ONCE on initial mount
  useEffect(() => {
    connectWebSocket();
    return () => {
      isCallingRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const s = wsRef.current;
        wsRef.current = null;
        s.close();
      }
      if (vadRef.current) {
        vadRef.current.stop();
        vadRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, [connectWebSocket]);

  return {
    isConnected,
    isCalling,
    agentStatus,
    statusDetail,
    modelName,
    transcript,
    currentAssistantText,
    toolLogs,
    volumeLevel,
    isAiSpeaking: isAiSpeakingRef.current,
    error,
    startCall,
    endCall,
    triggerBargeIn,
    sendTextQuery,
    clearTranscript,
    reconnect: connectWebSocket,
  };
}
