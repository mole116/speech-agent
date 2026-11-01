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

// Extend window for Web Speech API
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
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Send message helper
  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Audio queue player for streamed TTS sentences and audio chunks
  const audioPlayer = useAudioQueuePlayer({
    onPlaybackStateChange: (isPlaying) => {
      isAiSpeakingRef.current = isPlaying;
      if (vadRef.current) {
        vadRef.current.setAiSpeaking(isPlaying);
      }
      if (!isPlaying && agentStatus === 'speaking') {
        setAgentStatus('idle');
      }
    },
  });

  /**
   * Universal Barge-in Kill Switch
   * Immediately clears client audio queue, halts speech output, and notifies backend.
   */
  const triggerBargeIn = useCallback(
    (reason: 'vad_barge_in' | 'manual' = 'manual') => {
      console.warn(`[VoiceAgent] 🚨 BARGE-IN TRIGGERED: ${reason}`);

      // 1. Instantly kill audio playback and clear queue
      audioPlayer.cancelAllPlayback();
      isAiSpeakingRef.current = false;
      if (vadRef.current) {
        vadRef.current.setAiSpeaking(false);
      }

      // 2. Fire immediate interrupt signal to WebSocket server
      sendMessage({
        type: 'user_interrupt',
        reason,
        timestamp: Date.now(),
      });

      // 3. Update current assistant response in transcript as interrupted
      setCurrentAssistantText((prev) => (prev ? `${prev} [interrupted]` : ''));
      setAgentStatus('interrupted');
      setStatusDetail('Interrupted by user');
    },
    [audioPlayer, sendMessage, agentStatus]
  );

  /**
   * Initializes local speech recognition (Web Speech API) for fast, free STT on macOS
   */
  const initSpeechRecognition = useCallback(() => {
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[STT] Web Speech API not supported in this browser. Using raw audio VAD stream only.');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

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

      // If user starts talking while AI is outputting, trigger barge-in!
      if ((interim.length > 0 || finalTranscript.length > 0) && isAiSpeakingRef.current) {
        triggerBargeIn('vad_barge_in');
      }

      if (interim) {
        sendMessage({
          type: 'user_transcript',
          text: interim,
          isFinal: false,
          timestamp: Date.now(),
        });
      }

      if (finalTranscript.trim()) {
        sendMessage({
          type: 'user_transcript',
          text: finalTranscript.trim(),
          isFinal: true,
          timestamp: Date.now(),
        });
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[STT] Speech recognition warning:', e.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart recognition if call is still active
      if (isCalling) {
        try {
          recognition.start();
        } catch {
          // Ignore restart collisions
        }
      }
    };

    return recognition;
  }, [isCalling, sendMessage, triggerBargeIn]);

  /**
   * Handles incoming WebSocket messages from the server
   */
  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
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
          // Streamed sentence for TTS playback
          audioPlayer.enqueueSentence(msg.text, msg.turnId, msg.sentenceIndex);
          break;

        case 'audio_chunk':
          // Raw synthesized audio buffer from backend (e.g. macOS 'say')
          audioPlayer.enqueueAudioChunk(msg.data, msg.turnId, msg.sentenceIndex);
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
          // Server confirmed generation abort
          audioPlayer.cancelAllPlayback();
          isAiSpeakingRef.current = false;
          setAgentStatus('listening');
          setStatusDetail('Interrupted. Listening...');
          break;

        case 'transcript_update':
          setTranscript((prev) => {
            // Check if this entry already exists to update it
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
    },
    [audioPlayer]
  );

  /**
   * Connect WebSocket to local backend with multi-endpoint fallback and auto-reconnect
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
    // If running via Vite (e.g. port 5173), route via Vite's proxy (/ws) or direct to 127.0.0.1:3001
    const wsUrl =
      window.location.port === '5173'
        ? `${wsProtocol}//${window.location.host}/ws`
        : `${wsProtocol}//127.0.0.1:3001/ws`;

    console.log(`[VoiceAgent] Connecting WebSocket to ${wsUrl}...`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[VoiceAgent] Failed to instantiate WebSocket:', e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[VoiceAgent] WebSocket connected successfully.');
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
        handleServerMessage(msg);
      } catch (err) {
        console.error('[VoiceAgent] Failed to parse server message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[VoiceAgent] WebSocket closed. Retrying in 2s...');
      setIsConnected(false);
      setAgentStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[VoiceAgent] WebSocket connection error (waiting for server to start):', err);
      setError('Cannot connect to local Voice Agent server (Port 3001). Retrying...');
      setIsConnected(false);
      try {
        ws.close();
      } catch {}
    };

    wsRef.current = ws;
  }, [handleServerMessage]);

  const scheduleReconnect = useCallback(() => {
    if (!reconnectTimerRef.current) {
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWebSocket();
      }, 2000);
    }
  }, [connectWebSocket]);

  /**
   * Starts a voice call session: opens mic, activates VAD, connects STT
   */
  const startCall = async () => {
    try {
      setError(null);

      // 1. Initialize Client VAD
      const vad = new ClientVAD({
        energyThreshold: 0.035,
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
          // Stream raw audio chunks over WebSocket
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
        } catch {
          // Ignore if already started
        }
      }

      setIsCalling(true);
      setAgentStatus('listening');
      setStatusDetail('Listening for speech...');
    } catch (err: unknown) {
      console.error('[VoiceAgent] Failed to start call:', err);
      setError((err as Error).message || 'Microphone access denied or audio device unavailable.');
    }
  };

  /**
   * Ends the voice call session
   */
  const endCall = () => {
    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    audioPlayer.cancelAllPlayback();
    setIsCalling(false);
    setVolumeLevel(0);
    setAgentStatus('idle');
    setStatusDetail('Call ended.');
  };

  /**
   * Manual text query injection for testing without mic
   */
  const sendTextQuery = (text: string) => {
    if (isAiSpeakingRef.current) {
      triggerBargeIn('manual');
    }
    sendMessage({
      type: 'user_transcript',
      text,
      isFinal: true,
      timestamp: Date.now(),
    });
  };

  const clearTranscript = () => {
    setTranscript([]);
    setToolLogs([]);
    setCurrentAssistantText('');
  };

  // Connect on mount
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (vadRef.current) {
        vadRef.current.stop();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
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
