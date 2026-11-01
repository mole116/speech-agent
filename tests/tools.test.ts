import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createAgentTools } from '../src/server/llm/tools.js';

describe('Server-Side Zod Tools', () => {
  const events: Array<{ type: string; name: string }> = [];
  const tools = createAgentTools((ev) => {
    events.push({ type: ev.status, name: ev.toolName });
  });

  it('should execute getSystemMetrics and return M4 hardware telemetry', async () => {
    const result = await tools.getSystemMetrics.execute({ includeCpuDetails: true });
    assert.ok(result);
    assert.strictEqual(typeof result.hostname, 'string');
    assert.strictEqual(typeof result.memory.total, 'string');
    assert.strictEqual(typeof result.memory.used, 'string');
    assert.ok(result.cpuCount > 0);
  });

  it('should execute checkMockDatabase for inventory collection', async () => {
    const result = await tools.checkMockDatabase.execute({
      collection: 'inventory',
      searchTerm: 'MacBook Pro M4',
    });
    assert.ok(result);
    assert.strictEqual(result.collection, 'inventory');
    assert.strictEqual(result.totalMatches, 1);
    assert.strictEqual((result.data[0] as any).item, 'MacBook Pro M4');
    assert.strictEqual((result.data[0] as any).stock, 14);
  });

  it('should execute querySystemLogs and return filtered entries', async () => {
    const result = await tools.querySystemLogs.execute({
      level: 'warn',
    });
    assert.ok(result);
    assert.ok(result.count >= 1);
    assert.strictEqual(result.logs[0].level, 'warn');
  });

  it('should execute saveNote and listNotes', async () => {
    const saved = await tools.saveNote.execute({
      noteText: 'Evaluation note test',
      category: 'testing',
    });
    assert.ok(saved.success);
    assert.strictEqual(saved.savedNote.text, 'Evaluation note test');

    const listed = await tools.listNotes.execute({});
    assert.ok(listed.count >= 1);
    const found = listed.notes.some((n: any) => n.text === 'Evaluation note test');
    assert.ok(found);
  });
});
