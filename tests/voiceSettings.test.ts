import { describe, it } from 'node:test';
import assert from 'node:assert';
import { VoiceSettings, ClientSetConfigMessage } from '../src/types/protocol.js';

interface MockVoice {
  name: string;
  lang: string;
  default?: boolean;
}

function resolveVoice(
  settings: VoiceSettings,
  availableVoices: MockVoice[]
): MockVoice | undefined {
  // 1. Explicit user selected voice name
  if (settings.voiceName) {
    const match = availableVoices.find((v) => v.name === settings.voiceName);
    if (match) return match;
  }

  // 2. Natural English voice fallback
  const naturalFallback = availableVoices.find(
    (v) =>
      v.lang.startsWith('en') &&
      (v.name.includes('Samantha') ||
        v.name.includes('Daniel') ||
        v.name.includes('Natural') ||
        v.name.includes('Google') ||
        v.name.includes('Alex'))
  );
  if (naturalFallback) return naturalFallback;

  // 3. Any English voice
  return availableVoices.find((v) => v.lang.startsWith('en'));
}

function sanitizeVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  const rate = Math.min(1.5, Math.max(0.8, settings.rate ?? 1.05));
  const pitch = Math.min(1.3, Math.max(0.8, settings.pitch ?? 1.0));
  return {
    voiceName: settings.voiceName || '',
    rate,
    pitch,
    lang: settings.lang,
  };
}

describe('Voice Settings and Heuristics', () => {
  const mockSystemVoices: MockVoice[] = [
    { name: 'Alex', lang: 'en-US' },
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Daniel', lang: 'en-GB' },
    { name: 'Fred', lang: 'en-US' },
    { name: 'Victoria', lang: 'en-US' },
    { name: 'Thomas', lang: 'fr-FR' },
    { name: 'Anna', lang: 'de-DE' },
  ];

  it('should resolve explicit user-selected voice when matched', () => {
    const settings: VoiceSettings = {
      voiceName: 'Daniel',
      rate: 1.1,
      pitch: 1.0,
      lang: 'en-GB',
    };
    const resolved = resolveVoice(settings, mockSystemVoices);
    assert.strictEqual(resolved?.name, 'Daniel');
    assert.strictEqual(resolved?.lang, 'en-GB');
  });

  it('should fallback to natural English voice (Samantha/Daniel/Alex) if voiceName not specified', () => {
    const settings: VoiceSettings = {
      voiceName: '',
      rate: 1.05,
      pitch: 1.0,
    };
    const resolved = resolveVoice(settings, mockSystemVoices);
    assert.ok(resolved);
    assert.ok(['Alex', 'Samantha', 'Daniel'].includes(resolved.name));
  });

  it('should fallback gracefully to any English voice if preferred names are absent', () => {
    const exoticVoices: MockVoice[] = [
      { name: 'CustomEnglishVoice', lang: 'en-AU' },
      { name: 'Amelie', lang: 'fr-CA' },
    ];
    const settings: VoiceSettings = {
      voiceName: 'NonExistentVoice',
      rate: 1.05,
      pitch: 1.0,
    };
    const resolved = resolveVoice(settings, exoticVoices);
    assert.strictEqual(resolved?.name, 'CustomEnglishVoice');
  });

  it('should clamp rate and pitch within natural conversational bounds', () => {
    // Too fast / too high
    const extremeHigh = sanitizeVoiceSettings({ rate: 2.5, pitch: 2.0 });
    assert.strictEqual(extremeHigh.rate, 1.5);
    assert.strictEqual(extremeHigh.pitch, 1.3);

    // Too slow / too deep
    const extremeLow = sanitizeVoiceSettings({ rate: 0.3, pitch: 0.4 });
    assert.strictEqual(extremeLow.rate, 0.8);
    assert.strictEqual(extremeLow.pitch, 0.8);

    // Normal values preserved
    const normal = sanitizeVoiceSettings({ rate: 1.15, pitch: 1.05 });
    assert.strictEqual(normal.rate, 1.15);
    assert.strictEqual(normal.pitch, 1.05);
  });

  it('should construct valid ClientSetConfigMessage with ttsVoice payload', () => {
    const msg: ClientSetConfigMessage = {
      type: 'set_config',
      config: {
        ttsEngine: 'browser',
        ttsVoice: 'Daniel',
      },
    };
    assert.strictEqual(msg.type, 'set_config');
    assert.strictEqual(msg.config.ttsVoice, 'Daniel');
    assert.strictEqual(msg.config.ttsEngine, 'browser');
  });
});
