/**
 * Real-Time Sentence Segmenter for Low-Latency Streaming TTS
 * Slices an incoming token stream into speech-ready sentences or natural clauses
 * without waiting for full generation to complete.
 */

export class SentenceSegmenter {
  private buffer = '';
  private sentenceIndex = 0;
  private readonly minSentenceLength = 10; // Terminal sentence boundary
  private readonly minClauseLength = 12;   // Natural conversational clause boundary (e.g. "Hello Moshe,")

  /**
   * Appends incoming text chunk and returns any newly completed sentences or clauses.
   */
  public push(chunk: string): string[] {
    this.buffer += chunk;
    const sentences: string[] = [];

    // Match either:
    // 1. Terminal punctuation (.!?\n) followed by whitespace OR terminal ?/! at end of chunk
    // 2. Clause punctuation (,;:\u2014) or " - " followed by whitespace
    const boundaryRegex = /([.!?\n]+)(\s+|$)|([,;:\u2014]+|\s+-\s+)(\s+)/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = boundaryRegex.exec(this.buffer)) !== null) {
      const matchEnd = match.index + match[0].length;
      const delimiter = match[1] || match[3];
      const whitespace = match[2] || match[4] || '';
      const isTerminal = /[.!?\n]/.test(delimiter);
      const isEndOfBuffer = matchEnd === this.buffer.length;
      const candidate = this.buffer.slice(lastIndex, match.index + delimiter.length).trim();

      // Guard 1: Ignore numbers with decimals (e.g., "version 27.2.0" or "at 2.4 GHz")
      if (/\d\.\d+$/.test(candidate) || candidate.endsWith('%')) {
        continue;
      }

      // Guard 2: Don't break on abbreviations (e.g. "Dr.", "e.g.") or ellipsis (e.g. "..")
      if (this.isAbbreviation(candidate) || candidate.endsWith('..')) {
        continue;
      }

      // Guard 3: If delimiter is a single unspaced '.' at the very end of the buffer, wait if preceded by a single letter or digit
      if (whitespace === '' && delimiter === '.' && (/\b[a-zA-Z0-9]\.$/.test(candidate) || candidate.length < this.minSentenceLength)) {
        continue;
      }

      // Guard 4: Require minSentenceLength for terminal punctuation, minClauseLength for clauses
      const requiredLength = isTerminal ? this.minSentenceLength : this.minClauseLength;

      if (candidate.length >= requiredLength) {
        sentences.push(candidate);
        this.sentenceIndex++;
        lastIndex = matchEnd;
      }
    }

    if (lastIndex > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }

    return sentences;
  }

  /**
   * Flushes any remaining text in the buffer when the stream completes.
   */
  public flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (remaining.length > 0) {
      this.sentenceIndex++;
      return remaining;
    }
    return null;
  }

  /**
   * Resets the segmenter buffer and index (e.g., upon user interruption).
   */
  public reset(): void {
    this.buffer = '';
    this.sentenceIndex = 0;
  }

  public getIndex(): number {
    return this.sentenceIndex;
  }

  private isAbbreviation(text: string): boolean {
    const abbreviations = ['mr.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'approx.'];
    const lower = text.toLowerCase();
    return abbreviations.some((abbr) => lower.endsWith(abbr));
  }
}
