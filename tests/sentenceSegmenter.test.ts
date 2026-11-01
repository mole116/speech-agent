import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SentenceSegmenter } from '../src/server/tts/sentenceSegmenter.js';

describe('SentenceSegmenter (Streaming TTS Tokenizer)', () => {
  it('should segment complete sentences by punctuation', () => {
    const segmenter = new SentenceSegmenter();
    
    // Push chunks incrementally
    let s1 = segmenter.push('Hello ');
    assert.deepStrictEqual(s1, []);

    let s2 = segmenter.push('world. How ');
    assert.deepStrictEqual(s2, ['Hello world.']);

    let s3 = segmenter.push('are you doing? ');
    assert.deepStrictEqual(s3, ['How are you doing?']);

    let remaining = segmenter.flush();
    assert.strictEqual(remaining, null);
  });

  it('should flush unpunctuated trailing text at the end of stream', () => {
    const segmenter = new SentenceSegmenter();
    segmenter.push('This has no punctuation');
    const remaining = segmenter.flush();
    assert.strictEqual(remaining, 'This has no punctuation');
  });

  it('should track sequential sentence indices correctly', () => {
    const segmenter = new SentenceSegmenter();
    segmenter.push('First sentence! Second sentence? Third sentence. ');
    assert.strictEqual(segmenter.getIndex(), 3);
  });
});
