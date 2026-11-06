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

  it('should segment conversational clauses on commas to stream TTS early', () => {
    const segmenter = new SentenceSegmenter();
    const clauses = segmenter.push(
      'Your MacBook Pro M4 is running macOS version 27.2.0, with 48 GB of memory, and CPU at 2.4 GHz. '
    );
    assert.ok(clauses.length >= 2, `Should segment into multiple phrases for early TTS (got ${clauses.length})`);
    assert.strictEqual(clauses[0], 'Your MacBook Pro M4 is running macOS version 27.2.0,');
  });

  it('should not break decimal numbers across segments', () => {
    const segmenter = new SentenceSegmenter();
    const res = segmenter.push('CPU is running at 2.4 GHz with 99.7% memory. ');
    assert.deepStrictEqual(res, ['CPU is running at 2.4 GHz with 99.7% memory.']);
  });

  it('should segment short conversational openers on comma immediately', () => {
    const segmenter = new SentenceSegmenter();
    const clauses = segmenter.push('Hello Moshe, how can I help you today?');
    assert.ok(clauses.length >= 1);
    assert.strictEqual(clauses[0], 'Hello Moshe,');
  });
});
