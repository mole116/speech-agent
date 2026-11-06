import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { NeuralTTSBridge } from '../src/server/tts/neuralTtsBridge.js';

describe('Qwen3-TTS Neural Voice Cloning Bridge', () => {
  const refWav = path.resolve(process.cwd(), 'storage/voice_profiles/user_voice.wav');

  after(() => {
    NeuralTTSBridge.getInstance().shutdown();
  });

  test('should initialize worker and report ready status', async () => {
    const bridge = NeuralTTSBridge.getInstance();
    const ready = await bridge.ensureWorker();
    assert.equal(ready, true, 'Worker should report ready');
  });

  test('should synthesize a spoken sentence in cloned voice', async () => {
    if (!fs.existsSync(refWav)) {
      console.log('Skipping synthesis test: no user_voice.wav present');
      return;
    }
    const bridge = NeuralTTSBridge.getInstance();
    const chunk = await bridge.synthesize('Hello from Qwen 3 TTS!', 0, refWav);

    assert.ok(chunk, 'Chunk should be returned');
    assert.equal(chunk?.sentenceIndex, 0);
    assert.equal(chunk?.format, 'wav');
    assert.ok(chunk?.dataBase64 && chunk.dataBase64.length > 100, 'Base64 audio should be populated');

    // Verify RIFF header
    const raw = Buffer.from(chunk.dataBase64, 'base64');
    assert.equal(raw.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(raw.subarray(8, 12).toString('ascii'), 'WAVE');
  });
});
