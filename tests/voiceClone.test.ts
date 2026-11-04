import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  estimateFramePitch,
  analyzeAudioBuffer,
  pickRecommendedBaseVoice,
} from '../src/client/vad/pitchEstimator.js';
import { VoiceCloneProfile, VoiceSettings } from '../src/types/protocol.js';

/**
 * Generate a synthetic pure tone sine wave buffer for testing pitch estimation
 */
function generateSineWave(freqHz: number, durationSec: number, sampleRate = 16000): Float32Array {
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    // 0.6 amplitude sine wave with gentle fade in/out
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(i / 100, (numSamples - i) / 100));
    buffer[i] = 0.6 * Math.sin(2 * Math.PI * freqHz * t) * envelope;
  }
  return buffer;
}

describe('Voice Cloning & Acoustic Profile Estimator', () => {
  const sampleRate = 16000;
  const mockVoices = ['Samantha', 'Daniel', 'Alex', 'Victoria', 'Fred', 'Karen'];

  it('should accurately detect 120 Hz fundamental frequency (deep / male vocal range)', () => {
    const tone = generateSineWave(120, 0.05, sampleRate);
    const result = estimateFramePitch(tone, sampleRate);
    assert.ok(result.pitchHz > 0, 'Should detect a pitch');
    assert.ok(
      Math.abs(result.pitchHz - 120) <= 4,
      `Expected pitch ~120 Hz, got ${result.pitchHz}`
    );
    assert.ok(result.confidence > 0.8, `Confidence should be high, got ${result.confidence}`);
  });

  it('should accurately detect 210 Hz fundamental frequency (higher / soprano vocal range)', () => {
    const tone = generateSineWave(210, 0.05, sampleRate);
    const result = estimateFramePitch(tone, sampleRate);
    assert.ok(result.pitchHz > 0, 'Should detect a pitch');
    assert.ok(
      Math.abs(result.pitchHz - 210) <= 5,
      `Expected pitch ~210 Hz, got ${result.pitchHz}`
    );
    assert.ok(result.confidence > 0.8, `Confidence should be high, got ${result.confidence}`);
  });

  it('should return pitch 0 and confidence 0 on silent audio frame', () => {
    const silence = new Float32Array(1000);
    const result = estimateFramePitch(silence, sampleRate);
    assert.strictEqual(result.pitchHz, 0);
    assert.strictEqual(result.confidence, 0);
  });

  it('should classify deep voice as low pitch and recommend Daniel/Alex base voice', () => {
    // 3.5 seconds of 115 Hz voice
    const buffer = generateSineWave(115, 3.5, sampleRate);
    const analysis = analyzeAudioBuffer(buffer, sampleRate, mockVoices);

    assert.strictEqual(analysis.pitchClassification, 'low');
    assert.ok(analysis.meanPitchHz >= 110 && analysis.meanPitchHz <= 122);
    assert.ok(analysis.calibratedPitch <= 1.0, 'Low pitch voice should have pitch factor <= 1.0');
    assert.ok(
      analysis.recommendedBaseVoice === 'Daniel' || analysis.recommendedBaseVoice === 'Alex',
      `Expected Daniel or Alex, got ${analysis.recommendedBaseVoice}`
    );
  });

  it('should classify higher voice as high pitch and recommend Samantha/Victoria base voice', () => {
    // 4.0 seconds of 215 Hz voice
    const buffer = generateSineWave(215, 4.0, sampleRate);
    const analysis = analyzeAudioBuffer(buffer, sampleRate, mockVoices);

    assert.strictEqual(analysis.pitchClassification, 'high');
    assert.ok(analysis.meanPitchHz >= 208 && analysis.meanPitchHz <= 222);
    assert.ok(analysis.calibratedPitch >= 1.0, 'High pitch voice should have pitch factor >= 1.0');
    assert.ok(
      analysis.recommendedBaseVoice === 'Samantha' || analysis.recommendedBaseVoice === 'Victoria',
      `Expected Samantha or Victoria, got ${analysis.recommendedBaseVoice}`
    );
  });

  it('should calibrate speaking rate based on reading duration', () => {
    // Fast speaker (2.5 seconds reading)
    const fastBuffer = generateSineWave(140, 2.5, sampleRate);
    const fastAnalysis = analyzeAudioBuffer(fastBuffer, sampleRate, mockVoices);
    assert.strictEqual(fastAnalysis.calibratedRate, 1.15, 'Fast reading should calibrate to 1.15x');

    // Deliberate speaker (6.0 seconds reading)
    const slowBuffer = generateSineWave(140, 6.0, sampleRate);
    const slowAnalysis = analyzeAudioBuffer(slowBuffer, sampleRate, mockVoices);
    assert.strictEqual(slowAnalysis.calibratedRate, 0.95, 'Deliberate reading should calibrate to 0.95x');
  });

  it('should construct valid VoiceCloneProfile and integrate with VoiceSettings', () => {
    const profile: VoiceCloneProfile = {
      id: 'clone_test_123',
      name: 'My Voice',
      createdAt: Date.now(),
      sampleAudioDurationSec: 4.2,
      detectedPitchHz: 125,
      pitch: 0.92,
      rate: 1.05,
      baseVoiceName: 'Daniel',
      classification: 'low',
    };

    const settings: VoiceSettings = {
      voiceName: profile.baseVoiceName,
      rate: profile.rate,
      pitch: profile.pitch,
      isClonedVoice: true,
      clonedProfile: profile,
    };

    assert.strictEqual(settings.isClonedVoice, true);
    assert.strictEqual(settings.clonedProfile?.detectedPitchHz, 125);
    assert.strictEqual(settings.clonedProfile?.baseVoiceName, 'Daniel');
    assert.strictEqual(settings.rate, 1.05);
    assert.strictEqual(settings.pitch, 0.92);
  });

  it('should verify file persistence for voice profile JSON', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-clone-test-'));
    const profilePath = path.join(tempDir, 'profile.json');

    const profile: VoiceCloneProfile = {
      id: 'clone_persist',
      name: 'My Voice',
      createdAt: Date.now(),
      sampleAudioDurationSec: 3.8,
      detectedPitchHz: 185,
      pitch: 1.06,
      rate: 1.05,
      baseVoiceName: 'Samantha',
    };

    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
    assert.ok(fs.existsSync(profilePath));

    const loaded: VoiceCloneProfile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    assert.strictEqual(loaded.id, 'clone_persist');
    assert.strictEqual(loaded.detectedPitchHz, 185);

    fs.unlinkSync(profilePath);
    fs.rmdirSync(tempDir);
  });
});
