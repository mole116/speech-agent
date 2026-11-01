import { streamText, CoreMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { CONFIG } from '../config.js';
import { createAgentTools } from './tools.js';
import { SentenceSegmenter } from '../tts/sentenceSegmenter.js';

function logAgent(tag: string, ...args: unknown[]) {
  console.log(`[AGENT:${tag}]`, ...args);
}

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
  private openaiOllama;
  private conversationHistory: CoreMessage[] = [];
  private currentAbortController: AbortController | null = null;
  private isProcessing = false;

  constructor() {
    this.ollama = createOllama({
      baseURL: `${CONFIG.ollama.baseUrl}/api`,
    });

    // OpenAI-compatible endpoint fallback for Ollama
    this.openaiOllama = createOpenAI({
      baseURL: `${CONFIG.ollama.baseUrl}/v1`,
      apiKey: 'ollama',
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
    if (this.currentAbortController) {
      this.abortCurrentTurn('superceded_by_new_speech');
    }

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.isProcessing = true;

    this.conversationHistory.push({
      role: 'user',
      content: userText,
    });

    const segmenter = new SentenceSegmenter();
    let accumulatedText = '';
    let interrupted = false;

    // Instantiate tool set
    const toolHandlers = createAgentTools((event) => {
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
      // Use OpenAI-compatible model endpoint for maximum Ollama streaming compatibility
      const model = this.openaiOllama(CONFIG.ollama.model);

      logAgent('Start', `Calling Ollama model ${CONFIG.ollama.model} with history length ${this.conversationHistory.length}`);

      const result = streamText({
        model,
        messages: this.conversationHistory,
        tools: toolHandlers,
        maxSteps: 5,
        temperature: CONFIG.ollama.temperature,
        abortSignal: abortController.signal,
      });

      let detectedToolCall: { name: string; arguments: Record<string, unknown> } | null = null;

      for await (const part of result.fullStream) {
        if (abortController.signal.aborted) {
          interrupted = true;
          logAgent('Aborted', 'Stream loop aborted via signal');
          break;
        }

        if (part.type === 'text-delta') {
          accumulatedText += part.textDelta;

          // Check if Ollama emitted a JSON tool call block in text
          const trimmed = accumulatedText.trim();
          const looksLikeToolJson =
            trimmed.startsWith('{') ||
            trimmed.startsWith('```json') ||
            trimmed.startsWith('```') ||
            trimmed.includes('"name":');

          if (looksLikeToolJson) {
            // Try parsing JSON block directly or extracting from code fences
            try {
              let jsonStr = trimmed;
              if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
              } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
              }
              const parsed = JSON.parse(jsonStr);
              if (parsed.name && typeof parsed.name === 'string') {
                detectedToolCall = parsed;
              }
            } catch {
              // Incomplete JSON chunk, keep accumulating without emitting to TTS
            }
          }

          // Only stream text deltas down to user/TTS if this is NOT a tool call payload
          if (!detectedToolCall && !looksLikeToolJson) {
            callbacks.onTextDelta?.(part.textDelta, accumulatedText);
            const sentences = segmenter.push(part.textDelta);
            for (const sentence of sentences) {
              callbacks.onSentence?.(sentence, segmenter.getIndex(), false);
            }
          }
        } else if (part.type === 'tool-call') {
          logAgent('ToolCall', `Native tool call: ${part.toolName}`, part.args);
        } else if (part.type === 'tool-result') {
          logAgent('ToolResult', `Native tool executed: ${part.toolName}`);
        } else if (part.type === 'error') {
          logAgent('Error', 'Stream part error:', part.error);
        }
      }

      logAgent('LoopDone', `fullStream complete. detectedToolCall=${!!detectedToolCall}, accumulatedLength=${accumulatedText.length}`);

      // If Ollama returned a tool call JSON string, execute it mid-call and summarize
      if (detectedToolCall && !abortController.signal.aborted) {
        const { name, arguments: args } = detectedToolCall;
        console.log(`[Agent] Executing tool '${name}' with args:`, args);

        const startTime = Date.now();
        let toolResult: unknown = null;
        const toolDef = (toolHandlers as Record<string, any>)[name];
        if (toolDef && typeof toolDef.execute === 'function') {
          try {
            toolResult = await toolDef.execute(args || {});
          } catch (execErr) {
            toolResult = { error: (execErr as Error).message };
          }
        } else {
          toolResult = { error: `Tool ${name} not found` };
        }

        const durationMs = Date.now() - startTime;

        // Feed tool output back to Ollama to generate final spoken voice answer
        console.log(`[Agent] Tool '${name}' completed in ${durationMs}ms. Generating voice summary...`);
        accumulatedText = '';
        segmenter.reset();

        const followUpMessages: CoreMessage[] = [
          ...this.conversationHistory,
          { role: 'assistant', content: JSON.stringify(detectedToolCall) },
          {
            role: 'user',
            content: `Tool '${name}' returned: ${JSON.stringify(toolResult)}. Summarize this in 1-2 concise spoken sentences for the voice user.`,
          },
        ];

        const secondPass = streamText({
          model,
          messages: followUpMessages,
          temperature: CONFIG.ollama.temperature,
          abortSignal: abortController.signal,
        });

        for await (const delta of secondPass.textStream) {
          if (abortController.signal.aborted) {
            interrupted = true;
            break;
          }
          accumulatedText += delta;
          callbacks.onTextDelta?.(delta, accumulatedText);

          const sentences = segmenter.push(delta);
          for (const s of sentences) {
            callbacks.onSentence?.(s, segmenter.getIndex(), false);
          }
        }
      }

      // Flush remaining segmenter buffer if not interrupted
      if (!abortController.signal.aborted) {
        const remaining = segmenter.flush();
        if (remaining) {
          callbacks.onSentence?.(remaining, segmenter.getIndex(), true);
        }

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
