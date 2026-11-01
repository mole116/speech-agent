import { streamText, CoreMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { CONFIG } from '../config.js';
import { createAgentTools } from './tools.js';
import { SentenceSegmenter } from '../tts/sentenceSegmenter.js';

export interface AgentCallbacks {
  onTextDelta?: (delta: string, fullText: string) => void;
  onSentence?: (sentence: string, sentenceIndex: number, isFinal: boolean) => void;
  onToolCallStart?: (toolCallId: string, toolName: string, args: Record<string, unknown>) => void;
  onToolCallComplete?: (toolCallId: string, toolName: string, result: unknown, durationMs: number) => void;
  onFinish?: (fullText: string, interrupted: boolean) => void;
  onError?: (error: Error) => void;
}

export class VoiceAgentOrchestrator {
  private ollama;
  private conversationHistory: CoreMessage[] = [];
  private currentAbortController: AbortController | null = null;
  private isProcessing = false;

  constructor() {
    this.ollama = createOllama({
      baseURL: `${CONFIG.ollama.baseUrl}/api`,
    });

    // Seed system prompt
    this.conversationHistory.push({
      role: 'system',
      content: CONFIG.systemPrompt,
    });
  }

  /**
   * Processes a user speech transcript through the Vercel AI SDK streamText pipeline
   */
  public async streamResponse(userText: string, callbacks: AgentCallbacks): Promise<void> {
    // If already processing, cancel previous turn first
    if (this.currentAbortController) {
      this.abortCurrentTurn('superceded_by_new_speech');
    }

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.isProcessing = true;

    // Append user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userText,
    });

    const segmenter = new SentenceSegmenter();
    let accumulatedText = '';
    let interrupted = false;

    // Setup server-side tools with event tracking
    const tools = createAgentTools((event) => {
      if (abortController.signal.aborted) return;

      if (event.status === 'start') {
        callbacks.onToolCallStart?.(event.toolCallId, event.toolName, event.args || {});
      } else {
        callbacks.onToolCallComplete?.(
          event.toolCallId,
          event.toolName,
          event.result,
          Date.now() - parseInt(event.toolCallId.split('_')[1] || `${Date.now()}`, 10)
        );
      }
    });

    try {
      const model = this.ollama(CONFIG.ollama.model);

      console.log(`[Agent] Calling Ollama model: ${CONFIG.ollama.model}`);

      const result = streamText({
        model,
        messages: this.conversationHistory,
        tools,
        maxSteps: 5, // Allow tool-calling loops
        temperature: CONFIG.ollama.temperature,
        abortSignal: abortController.signal,
      });

      // Stream chunks using the fullStream event source
      for await (const part of result.fullStream) {
        if (abortController.signal.aborted) {
          interrupted = true;
          break;
        }

        if (part.type === 'text-delta') {
          const delta = part.textDelta;
          accumulatedText += delta;
          callbacks.onTextDelta?.(delta, accumulatedText);

          // Stream sentence boundaries for TTS
          const sentences = segmenter.push(delta);
          for (const sentence of sentences) {
            callbacks.onSentence?.(sentence, segmenter.getIndex(), false);
          }
        } else if (part.type === 'tool-call') {
          console.log(`[Agent] Tool requested: ${part.toolName}`, part.args);
        } else if (part.type === 'tool-result') {
          console.log(`[Agent] Tool executed: ${part.toolName}`);
        } else if (part.type === 'error') {
          console.error('[Agent] Stream part error:', part.error);
        }
      }

      // Flush remaining segmenter buffer if not interrupted
      if (!abortController.signal.aborted) {
        const remaining = segmenter.flush();
        if (remaining) {
          callbacks.onSentence?.(remaining, segmenter.getIndex(), true);
        }

        // Save assistant output to conversation history
        if (accumulatedText.trim()) {
          this.conversationHistory.push({
            role: 'assistant',
            content: accumulatedText,
          });
        }
      }
    } catch (err: unknown) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (err as { message?: string })?.message?.includes('aborted');

      if (isAbort || abortController.signal.aborted) {
        interrupted = true;
        console.log('[Agent] Generation aborted mid-stream (Barge-in / Interrupt).');
        // Record partial response marked as interrupted
        if (accumulatedText.trim()) {
          this.conversationHistory.push({
            role: 'assistant',
            content: `${accumulatedText} [interrupted]`,
          });
        }
      } else {
        console.error('[Agent] Execution error:', err);
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
        this.isProcessing = false;
      }
      callbacks.onFinish?.(accumulatedText, interrupted);
    }
  }

  /**
   * Violent kill switch / Barge-in trigger: Aborts active LLM stream immediately.
   */
  public abortCurrentTurn(reason = 'barge_in'): boolean {
    if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
      console.log(`[Agent] ABORTING active stream: reason=${reason}`);
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.isProcessing = false;
      return true;
    }
    return false;
  }

  public isBusy(): boolean {
    return this.isProcessing;
  }

  public getHistory(): CoreMessage[] {
    return [...this.conversationHistory];
  }

  public clearHistory(): void {
    this.conversationHistory = [
      {
        role: 'system',
        content: CONFIG.systemPrompt,
      },
    ];
  }
}
