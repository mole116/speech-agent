import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ServerVAD } from '../src/server/vad/serverVad.js';

describe('ServerVAD Engine & Acoustic Echo Guard', () => {
  it('should compute zero RMS on silent buffer', () => {
    const vad = new ServerVAD();
    const silentBuffer = Buffer.alloc(1024, 0);
    const rms = vad.calculateRms(silentBuffer);
    assert.strictEqual(rms, 0);
  });

  it('should detect speech start when energy exceeds normal threshold', () => {
    const vad = new ServerVAD(0.035, 750, 16000);
    
    // Generate simulated loud speech waveform (sine wave, peak ~0.5)
    const samples = 512;
    const loudBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const val = Math.round(Math.sin((i / 16) * Math.PI) * 16000);
      loudBuffer.writeInt16LE(val, i * 2);
    }

    const rms = vad.calculateRms(loudBuffer);
    assert.ok(rms > 0.035, `RMS ${rms} should exceed 0.035`);

    // Frame 1
    let ev1 = vad.processAudioChunk(loudBuffer, false);
    // Frame 2 triggers speech_start (minSpeechFrames = 2)
    let ev2 = vad.processAudioChunk(loudBuffer, false);
    assert.ok(ev1 !== null || ev2 !== null);
    const ev = ev1 || ev2;
    assert.strictEqual(ev?.type, 'speech_start');
  });

  it('should NOT trigger barge-in while AI is speaking when audio is below bargeInThreshold (0.28)', () => {
    const vad = new ServerVAD(0.035, 750, 16000);
    
    // Simulated moderate speaker bleed (sine wave, peak ~0.15 RMS)
    const samples = 512;
    const speakerBleedBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const val = Math.round(Math.sin((i / 16) * Math.PI) * 4500);
      speakerBleedBuffer.writeInt16LE(val, i * 2);
    }

    const rms = vad.calculateRms(speakerBleedBuffer);
    assert.ok(rms < 0.28, `RMS ${rms} should be below barge-in threshold 0.28`);

    // Process 10 frames of speaker bleed while AI is speaking
    for (let i = 0; i < 10; i++) {
      const ev = vad.processAudioChunk(speakerBleedBuffer, true);
      assert.strictEqual(ev, null, 'Speaker bleed must not trigger barge-in');
    }
  });

  it('should trigger intentional barge-in when loud sustained speech exceeds 0.28 RMS for 8 frames', () => {
    const vad = new ServerVAD(0.035, 750, 16000);
    
    // Simulated human shout (sine wave, peak ~0.75 RMS)
    const samples = 512;
    const shoutBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const val = Math.round(Math.sin((i / 16) * Math.PI) * 26000);
      shoutBuffer.writeInt16LE(val, i * 2);
    }

    const rms = vad.calculateRms(shoutBuffer);
    assert.ok(rms > 0.28, `RMS ${rms} should exceed barge-in threshold 0.28`);

    let bargeInTriggered = false;
    for (let i = 0; i < 10; i++) {
      const ev = vad.processAudioChunk(shoutBuffer, true);
      if (ev?.type === 'barge_in') {
        bargeInTriggered = true;
        break;
      }
    }

    assert.strictEqual(bargeInTriggered, true, 'Intentional sustained loud speech must trigger barge-in');
  });
});
