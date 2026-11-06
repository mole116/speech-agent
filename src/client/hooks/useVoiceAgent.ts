import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AgentStatus,
  TranscriptEntry,
  ToolCallLog,
  ServerMessage,
  ClientMessage,
  VoiceSettings,
  VoiceCloneProfile,
} from '../../types/protocol.js';
import { ClientVAD } from '../vad/clientVad.js';
import { useAudioQueuePlayer } from './useAudioQueuePlayer.js';
import { isSelfEcho } from '../vad/echoFilter.js';

interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export function useVoiceAgent() {
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected');
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [modelName, setModelName] = useState<string>('ministral-3:8b');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentAssistantText, setCurrentAssistantText] = useState<string>('');
  const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([]);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Persistent voice configuration
  const [voiceSettings, setVoiceSettingsState] = useState<VoiceSettings>(() => {
    try {
      const saved = localStorage.getItem('voice_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      voiceName: '',
      rate: 1.05,
      pitch: 1.0,
    };
  });
  const voiceSettingsRef = useRef(voiceSettings);
  voiceSettingsRef.current = voiceSettings;

  const wsRef = useRef<WebSocket | null>(null);
  const vadRef = useRef<ClientVAD | null>(null);
  const recognitionRef = useRef<any>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const isAiSpeakingRef = useRef<boolean>(false);
  const aiSpeechEndTimeRef = useRef<number>(0);
  const isCallingRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const turnTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recentAssistantUtterancesRef = useRef<string[]>([]);

  // Audio queue player with user-selected voice
  const audioPlayer = useAudioQueuePlayer({
    voiceSettings,
    onPlaybackStateChange: (isPlaying) => {
      isAiSpeakingRef.current = isPlaying;
      if (isPlaying) {
        // Active speaker bleed guard: abort pending recognition buffer so mic doesn't capture speaker output
        try {
          if (recognitionRef.current) {
            recognitionRef.current.abort();
          }
        } catch {}
      } else {
        aiSpeechEndTimeRef.current = Date.now();
        setAgentStatus((prev) => (prev === 'speaking' ? 'idle' : prev));

        // Restart recognition cleanly after speaker audio has cleared
        if (isCallingRef.current && recognitionRef.current) {
          setTimeout(() => {
            if (isCallingRef.current && !isAiSpeakingRef.current) {
              try {
                recognitionRef.current.start();
              } catch {}
            }
          }, 350);
        }
      }
      if (vadRef.current) {
        vadRef.current.setAiSpeaking(isPlaying);
      }
    },
  });

  const audioPlayerRef = useRef(audioPlayer);
  audioPlayerRef.current = audioPlayer;

  const connectWebSocketRef = useRef<() => void>(() => {});

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn(`[VoiceAgent] WebSocket not open (readyState=${wsRef.current?.readyState}). Buffering message:`, msg.type);
      pendingMessagesRef.current.push(msg);
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connectWebSocketRef.current();
      }
    }
  }, []);

  const setVoiceSettings = useCallback(
    (newSettings: Partial<VoiceSettings>) => {
      setVoiceSettingsState((prev) => {
        const updated = { ...prev, ...newSettings };
        try {
          localStorage.setItem('voice_settings', JSON.stringify(updated));
        } catch {}
        voiceSettingsRef.current = updated;
        audioPlayerRef.current.setVoiceSettings(updated);

        // If user changed away from cloned voice, cancel any pending playback instantly
        if (!updated.isClonedVoice) {
          audioPlayerRef.current.cancelAllPlayback();
        }

        sendMessage({
          type: 'set_config',
          config: {
            ttsEngine: updated.isClonedVoice ? 'clone' : 'browser',
            ttsVoice: updated.isClonedVoice
              ? (updated.clonedProfile?.baseVoiceName || updated.voiceName)
              : updated.voiceName,
            voiceProfile: updated.isClonedVoice ? updated.clonedProfile : undefined,
          },
        });
        return updated;
      });
    },
    [sendMessage]
  );

  const saveClonedProfile = useCallback(
    async (profile: VoiceCloneProfile, audioBase64?: string) => {
      try {
        await fetch('/api/voice-clone/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, audioBase64 }),
        });
      } catch (err) {
        console.warn('[VoiceAgent] Failed syncing cloned profile to server:', err);
      }

      setVoiceSettings({
        isClonedVoice: true,
        clonedProfile: profile,
        voiceName: profile.baseVoiceName,
        pitch: profile.pitch,
        rate: profile.rate,
      });
    },
    [setVoiceSettings]
  );

  const deleteClonedProfile = useCallback(async () => {
    try {
      await fetch('/api/voice-clone/profile', { method: 'DELETE' });
    } catch (err) {
      console.warn('[VoiceAgent] Failed deleting profile on server:', err);
    }

    setVoiceSettings({
      isClonedVoice: false,
      clonedProfile: undefined,
      voiceName: '',
      pitch: 1.0,
      rate: 1.05,
    });
  }, [setVoiceSettings]);

  // Load server-persisted voice clone profile if available
  useEffect(() => {
    fetch('/api/voice-clone/profile')
      .then((res) => res.json())
      .then((data) => {
        if (data.enrolled && data.profile) {
          setVoiceSettingsState((prev) => {
            if (!prev.clonedProfile) {
              const updated = {
                ...prev,
                clonedProfile: data.profile,
              };
              try {
                localStorage.setItem('voice_settings', JSON.stringify(updated));
              } catch {}
              return updated;
            }
            return prev;
          });
        }
      })
      .catch(() => {});

    // Fetch locally installed Ollama models
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data.models && Array.isArray(data.models)) {
          const names: string[] = data.models.map((m: any) => m.name);
          setAvailableModels(names);
          if (data.activeModel) {
            setModelName(data.activeModel);
          }
        }
      })
      .catch(() => {});
  }, []);

  const selectModel = useCallback(
    (newModel: string) => {
      setModelName(newModel);
      sendMessage({
        type: 'set_config',
        config: {
          model: newModel,
        },
      });
    },
    [sendMessage]
  );

  // Discover and track available system speech synthesis voices
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          setAvailableVoices(voices);
        }
      }
    };

    loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
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
    // Clear watchdog timer whenever active response updates arrive
    if (msg.type !== 'pong' && msg.type !== 'session_info' && turnTimeoutRef.current) {
      clearTimeout(turnTimeoutRef.current);
      turnTimeoutRef.current = null;
    }

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
        if (!voiceSettingsRef.current.isClonedVoice) {
          audioPlayerRef.current.enqueueSentence(msg.text, msg.turnId, msg.sentenceIndex);
        }
        recentAssistantUtterancesRef.current.push(msg.text);
        if (recentAssistantUtterancesRef.current.length > 10) {
          recentAssistantUtterancesRef.current.shift();
        }
        break;

      case 'audio_chunk':
        // Only enqueue neural audio chunk if user is currently using their cloned voice
        if (voiceSettingsRef.current.isClonedVoice) {
          audioPlayerRef.current.enqueueAudioChunk(msg.data, msg.turnId, msg.sentenceIndex);
        }
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
          if (msg.entry.text) {
            recentAssistantUtterancesRef.current.push(msg.entry.text);
            if (recentAssistantUtterancesRef.current.length > 10) {
              recentAssistantUtterancesRef.current.shift();
            }
          }
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
    // Force IPv4 loopback 127.0.0.1 on localhost to avoid macOS IPv6 ::1 ECONNREFUSED issues
    const host = window.location.hostname === 'localhost' || !window.location.hostname ? '127.0.0.1' : window.location.hostname;
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
      // Guard against old/zombie sockets from previous React mounts
      if (wsRef.current !== ws) {
        try { ws.close(); } catch {}
        return;
      }

      console.log('[VoiceAgent] WebSocket connection established successfully.');
      setIsConnected(true);
      setError(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Flush any queued messages that were attempted while connecting
      while (pendingMessagesRef.current.length > 0) {
        const queued = pendingMessagesRef.current.shift()!;
        console.log(`[VoiceAgent] 🚀 Sending buffered message: ${queued.type}`);
        ws.send(JSON.stringify(queued));
      }

      // Sync active voice configuration with server immediately upon connection
      const activeSettings = voiceSettingsRef.current;
      ws.send(
        JSON.stringify({
          type: 'set_config',
          config: {
            ttsEngine: activeSettings.isClonedVoice ? 'clone' : 'browser',
            ttsVoice: activeSettings.isClonedVoice
              ? (activeSettings.clonedProfile?.baseVoiceName || activeSettings.voiceName)
              : activeSettings.voiceName,
            voiceProfile: activeSettings.isClonedVoice ? activeSettings.clonedProfile : undefined,
          },
        })
      );

      // Heartbeat ping every 10s to keep connection alive
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      pingIntervalRef.current = setInterval(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'pong') {
          console.log(`[VoiceAgent] ⬇️ Server event: ${msg.type}`, msg.status || msg.toolName || '');
        }
        handleServerMessageRef.current(msg);
      } catch (err) {
        console.error('[VoiceAgent] Failed to parse server message:', err);
      }
    };

    ws.onclose = (event) => {
      // Guard against unmounted sockets stomping on active connections
      if (wsRef.current !== ws) return;

      console.log(`[VoiceAgent] WebSocket closed (code=${event.code}). Retrying in 2s...`);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      setIsConnected(false);
      setAgentStatus('disconnected');
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.warn('[VoiceAgent] WebSocket error:', err);
      setError('Cannot connect to local Voice Agent server (Port 3001). Retrying...');
      setIsConnected(false);
    };
  }, []);

  connectWebSocketRef.current = connectWebSocket;

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

      // Echo guard 1: ignore microphone input while AI is outputting speech or within 1200ms cooldown
      const now = Date.now();
      if (isAiSpeakingRef.current || now < aiSpeechEndTimeRef.current + 1200) {
        return;
      }

      if (interim) {
        setStatusDetail(`Hearing: "${interim}"...`);
      }

      if (finalTranscript.trim()) {
        const text = finalTranscript.trim();

        // Echo guard 2: Semantic anti-echo cancellation filter
        if (isSelfEcho(text, recentAssistantUtterancesRef.current)) {
          console.warn('[STT] 🛡️ Ignored acoustic echo bleed from speaker output:', text);
          return;
        }

        const userMsgId = `user_${Date.now()}`;
        console.log('[STT] Final Recognized Speech:', text);
        setAgentStatus('thinking');
        setStatusDetail(`Processing: "${text}"`);

        // Turn watchdog: prevent UI from getting stuck if server hangs (45s for local 32B model inference)
        if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = setTimeout(() => {
          console.warn('[VoiceAgent] Turn timeout after 45s');
          setAgentStatus((prev) => (prev === 'thinking' || prev === 'tool_executing' ? 'idle' : prev));
          setStatusDetail('Response timed out. Please try again.');
        }, 45000);

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

      // Resume Web Audio context on user gesture
      audioPlayerRef.current.resumeContext();

      // Ensure server has latest voice config for this call
      sendMessage({
        type: 'set_config',
        config: {
          ttsEngine: voiceSettingsRef.current.isClonedVoice ? 'clone' : 'browser',
          ttsVoice: voiceSettingsRef.current.isClonedVoice
            ? (voiceSettingsRef.current.clonedProfile?.baseVoiceName || voiceSettingsRef.current.voiceName)
            : voiceSettingsRef.current.voiceName,
          voiceProfile: voiceSettingsRef.current.isClonedVoice ? voiceSettingsRef.current.clonedProfile : undefined,
        },
      });

      // 1. Initialize Client VAD with acoustic echo suppression
      const vad = new ClientVAD({
        energyThreshold: 0.030,
        bargeInThreshold: 0.28,
        silenceTimeoutMs: 750,
        enableAutoBargeIn: true,
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

    // Resume Web Audio context on user gesture
    audioPlayerRef.current.resumeContext();

    // Ensure server has latest voice config
    sendMessage({
      type: 'set_config',
      config: {
        ttsEngine: voiceSettingsRef.current.isClonedVoice ? 'clone' : 'browser',
        ttsVoice: voiceSettingsRef.current.isClonedVoice
          ? (voiceSettingsRef.current.clonedProfile?.baseVoiceName || voiceSettingsRef.current.voiceName)
          : voiceSettingsRef.current.voiceName,
        voiceProfile: voiceSettingsRef.current.isClonedVoice ? voiceSettingsRef.current.clonedProfile : undefined,
      },
    });

    if (isAiSpeakingRef.current) {
      triggerBargeIn('manual');
    }

    const userMsgId = `user_${Date.now()}`;
    setAgentStatus('thinking');
    setStatusDetail(`Processing: "${trimmed}"`);

    // Turn watchdog: prevent UI from getting stuck if server hangs (45s for local 32B model inference)
    if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
    turnTimeoutRef.current = setTimeout(() => {
      console.warn('[VoiceAgent] Turn timeout after 45s');
      setAgentStatus((prev) => (prev === 'thinking' || prev === 'tool_executing' ? 'idle' : prev));
      setStatusDetail('Response timed out. Please try again.');
    }, 45000);

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
      if (turnTimeoutRef.current) {
        clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
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
    availableModels,
    selectModel,
    transcript,
    currentAssistantText,
    toolLogs,
    volumeLevel,
    isAiSpeaking: isAiSpeakingRef.current,
    error,
    voiceSettings,
    setVoiceSettings,
    availableVoices,
    saveClonedProfile,
    deleteClonedProfile,
    previewVoice: audioPlayer.previewVoice,
    startCall,
    endCall,
    triggerBargeIn,
    sendTextQuery,
    clearTranscript,
    reconnect: connectWebSocket,
  };
}
