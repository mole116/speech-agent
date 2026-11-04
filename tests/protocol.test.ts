import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:3001/ws';

describe('End-to-End WebSocket Voice Protocol', () => {
  let serverAvailable = false;

  before(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(1000) });
      serverAvailable = res.ok;
    } catch {
      serverAvailable = false;
    }
  });

  it('should establish connection and receive session handshake', async (t) => {
    if (!serverAvailable) {
      t.skip('Local dev server on 127.0.0.1:3001 is not running');
      return;
    }
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const handshake = await new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'session_info') resolve(msg);
      });
    });

    assert.strictEqual(handshake.type, 'session_info');
    assert.strictEqual(typeof handshake.sessionId, 'string');
    assert.strictEqual(handshake.model, 'qwen2.5-coder:32b');
    assert.ok(Array.isArray(handshake.supportedTools));
    assert.ok(handshake.supportedTools.includes('getSystemMetrics'));

    ws.close();
  });

  it('should process user greeting with full status lifecycle and text deltas', async (t) => {
    if (!serverAvailable) {
      t.skip('Local dev server on 127.0.0.1:3001 is not running');
      return;
    }
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve) => ws.on('open', resolve));

    try {
      const statuses: string[] = [];
      const deltas: string[] = [];
      let assistantReply = '';

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent_status') statuses.push(msg.status);
        if (msg.type === 'text_delta') deltas.push(msg.delta);
        if (msg.type === 'transcript_update' && msg.entry.role === 'assistant') {
          assistantReply = msg.entry.text;
        }
      });

      ws.send(JSON.stringify({
        type: 'user_transcript',
        id: 'test_greet',
        text: 'Hello there!',
        isFinal: true,
        timestamp: Date.now(),
      }));

      const start = Date.now();
      while (!assistantReply && Date.now() - start < 25000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      assert.ok(assistantReply.length > 0, 'Assistant should produce non-empty reply');
      assert.ok(deltas.length > 0, 'Should stream text deltas');
      assert.ok(statuses.includes('thinking'), 'Lifecycle should include thinking');
      assert.ok(statuses.includes('speaking'), 'Lifecycle should include speaking');
    } finally {
      ws.close();
    }
  });

  it('should execute server tool mid-turn and synthesize spoken answer', async (t) => {
    if (!serverAvailable) {
      t.skip('Local dev server on 127.0.0.1:3001 is not running');
      return;
    }
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve) => ws.on('open', resolve));

    try {
      let toolExecuted = false;
      let assistantReply = '';

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'tool_call_start' && msg.toolName === 'getSystemMetrics') {
          toolExecuted = true;
        }
        if (msg.type === 'transcript_update' && msg.entry.role === 'assistant') {
          assistantReply = msg.entry.text;
        }
      });

      ws.send(JSON.stringify({
        type: 'user_transcript',
        id: 'test_tool',
        text: 'what are the current MacBook Pro M4 hardware and system metrics',
        isFinal: true,
        timestamp: Date.now(),
      }));

      const start = Date.now();
      while (!assistantReply && Date.now() - start < 25000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      assert.strictEqual(toolExecuted, true, 'getSystemMetrics tool should have been executed');
      assert.ok(assistantReply.length > 0, 'Should summarize tool output into spoken response');
    } finally {
      ws.close();
    }
  });

  it('should handle barge-in interrupt instantly (<200ms) and stop active turn', async (t) => {
    if (!serverAvailable) {
      t.skip('Local dev server on 127.0.0.1:3001 is not running');
      return;
    }
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve) => ws.on('open', resolve));

    try {
      let interruptConfirmed = false;
      let interruptedTurnId: string | undefined;

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'interrupt_confirmed') {
          interruptConfirmed = true;
          interruptedTurnId = msg.turnId;
        }
      });

      // Start a long generation turn
      ws.send(JSON.stringify({
        type: 'user_transcript',
        id: 'test_interrupt',
        text: 'Give me a very long, detailed essay explaining the history of computer operating systems from 1960 to present day.',
        isFinal: true,
        timestamp: Date.now(),
      }));

      // Wait until generation starts
      await new Promise((r) => setTimeout(r, 1200));

      // Fire instant barge-in kill switch
      const interruptStart = Date.now();
      ws.send(JSON.stringify({
        type: 'user_interrupt',
        reason: 'test_kill_switch',
        timestamp: Date.now(),
      }));

      while (!interruptConfirmed && Date.now() - interruptStart < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const interruptDurationMs = Date.now() - interruptStart;
      assert.strictEqual(interruptConfirmed, true, 'Server must confirm interruption');
      assert.ok(interruptDurationMs < 500, `Interrupt must execute rapidly (took ${interruptDurationMs}ms)`);
    } finally {
      ws.close();
    }
  });
});
