import { streamText } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { CONFIG } from '../config.js';
import { createAgentTools } from './tools.js';
import { SentenceSegmenter } from '../tts/sentenceSegmenter.js';
export class VoiceAgentOrchestrator {
    ollama;
    openaiOllama;
    conversationHistory = [];
    currentAbortController = null;
    isProcessing = false;
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
    async streamResponse(userText, callbacks) {
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
            if (abortController.signal.aborted)
                return;
            if (event.status === 'start') {
                callbacks.onToolCallStart?.(event.toolCallId, event.toolName, event.args || {});
            }
            else {
                callbacks.onToolCallComplete?.(event.toolCallId, event.toolName, event.result, Date.now() - parseInt(event.toolCallId.split('_')[1] || `${Date.now()}`, 10));
            }
        });
        try {
            // Use OpenAI-compatible model endpoint for maximum Ollama streaming compatibility
            const model = this.openaiOllama(CONFIG.ollama.model);
            console.log(`[Agent] Calling Ollama model: ${CONFIG.ollama.model}`);
            const result = streamText({
                model,
                messages: this.conversationHistory,
                tools: toolHandlers,
                maxSteps: 5,
                temperature: CONFIG.ollama.temperature,
                abortSignal: abortController.signal,
            });
            let detectedToolCall = null;
            for await (const part of result.fullStream) {
                if (abortController.signal.aborted) {
                    interrupted = true;
                    break;
                }
                if (part.type === 'text-delta') {
                    accumulatedText += part.textDelta;
                    // Check if Ollama emitted a JSON tool call block in text
                    const trimmed = accumulatedText.trim();
                    if (trimmed.startsWith('{') && trimmed.includes('"name"') && (trimmed.includes('"arguments"') || trimmed.endsWith('}'))) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed.name && typeof parsed.name === 'string') {
                                detectedToolCall = parsed;
                            }
                        }
                        catch {
                            // Incomplete JSON chunk, keep accumulating
                        }
                    }
                    if (!detectedToolCall) {
                        callbacks.onTextDelta?.(part.textDelta, accumulatedText);
                        const sentences = segmenter.push(part.textDelta);
                        for (const sentence of sentences) {
                            callbacks.onSentence?.(sentence, segmenter.getIndex(), false);
                        }
                    }
                }
                else if (part.type === 'tool-call') {
                    console.log(`[Agent] Native tool call: ${part.toolName}`, part.args);
                }
                else if (part.type === 'tool-result') {
                    console.log(`[Agent] Native tool executed: ${part.toolName}`);
                }
                else if (part.type === 'error') {
                    console.error('[Agent] Stream part error:', part.error);
                }
            }
            // If Ollama returned a tool call JSON string, execute it mid-call and summarize
            if (detectedToolCall && !abortController.signal.aborted) {
                const { name, arguments: args } = detectedToolCall;
                const toolCallId = `call_${Date.now()}_${name}`;
                console.log(`[Agent] Executing tool '${name}' with args:`, args);
                callbacks.onToolCallStart?.(toolCallId, name, args || {});
                const startTime = Date.now();
                let toolResult = null;
                const toolDef = toolHandlers[name];
                if (toolDef && typeof toolDef.execute === 'function') {
                    try {
                        toolResult = await toolDef.execute(args || {});
                    }
                    catch (execErr) {
                        toolResult = { error: execErr.message };
                    }
                }
                else {
                    toolResult = { error: `Tool ${name} not found` };
                }
                const durationMs = Date.now() - startTime;
                callbacks.onToolCallComplete?.(toolCallId, name, toolResult, durationMs);
                // Feed tool output back to Ollama to generate final spoken voice answer
                console.log(`[Agent] Tool '${name}' completed in ${durationMs}ms. Generating voice summary...`);
                accumulatedText = '';
                segmenter.reset();
                const followUpMessages = [
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
        }
        catch (err) {
            const isAbort = (err instanceof Error && err.name === 'AbortError') ||
                err?.message?.includes('aborted');
            if (isAbort || abortController.signal.aborted) {
                interrupted = true;
                console.log('[Agent] Generation aborted mid-stream (Barge-in / Interrupt).');
                if (accumulatedText.trim()) {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: `${accumulatedText} [interrupted]`,
                    });
                }
            }
            else {
                console.error('[Agent] Execution error:', err);
                callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
            }
        }
        finally {
            if (this.currentAbortController === abortController) {
                this.currentAbortController = null;
                this.isProcessing = false;
            }
            callbacks.onFinish?.(accumulatedText, interrupted);
        }
    }
    abortCurrentTurn(reason = 'barge_in') {
        if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
            console.log(`[Agent] ABORTING active stream: reason=${reason}`);
            this.currentAbortController.abort();
            this.currentAbortController = null;
            this.isProcessing = false;
            return true;
        }
        return false;
    }
    isBusy() {
        return this.isProcessing;
    }
    getHistory() {
        return [...this.conversationHistory];
    }
    clearHistory() {
        this.conversationHistory = [
            {
                role: 'system',
                content: CONFIG.systemPrompt,
            },
        ];
    }
}
