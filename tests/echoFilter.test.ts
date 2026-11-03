import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isSelfEcho } from '../src/client/vad/echoFilter.js';

describe('Semantic Anti-Echo Cancellation Filter', () => {
  const assistantResponse =
    "Your MacBook Pro M4 is running macOS version 27.2.0 with 48 GB of total memory, and it's currently using 99.7% of that memory. The CPU is an Apple M4 Pro with 12 cores, all running at 2.4 GHz, and the system has been up for about 49 hours.";

  it('should detect and filter out exact or slightly degraded speaker echo', () => {
    // The exact feedback text from the user report
    const echoTranscript =
      "your MacBook Pro is running Mac OS version 27.2.0 with 48 GB of total memory and it's currently using 99.7% of that memory the CPU is an apple M4 Pro with 12 cores all running a 2.4 GHz and the system has been up for about 49 hours";

    assert.strictEqual(isSelfEcho(echoTranscript, [assistantResponse]), true);
  });

  it('should filter out partial clause echo picked up at the tail end of playback', () => {
    const partialEcho = "12 cores all running at 2.4 GHz and the system has been up";
    assert.strictEqual(isSelfEcho(partialEcho, [assistantResponse]), true);
  });

  it('should NOT filter out genuine new user questions or commands', () => {
    const genuineUtterances = [
      'What is our local inventory for MacBook Pro M4 stock?',
      'Check system logs for warnings',
      'Save a note about low latency',
      'okay stop stop',
      'Hi how are you',
      'thank you very much',
    ];

    for (const text of genuineUtterances) {
      assert.strictEqual(
        isSelfEcho(text, [assistantResponse]),
        false,
        `Expected "${text}" to NOT be marked as echo`
      );
    }
  });

  it('should return false when recent assistant utterances list is empty', () => {
    assert.strictEqual(isSelfEcho('Hello world', []), false);
  });
});
