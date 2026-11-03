/**
 * Real-Time Sentence Segmenter for Low-Latency Streaming TTS
 * Slices an incoming token stream into speech-ready sentences or natural clauses
 * without waiting for full generation to complete.
 */

export class SentenceSegmenter {
  private buffer = '';
  private sentenceIndex = 0;
  private readonly minSentenceLength = 12; // Terminal sentence boundary
  private readonly minClauseLength = 25;   // Natural conversational clause boundary

  /**
   * Appends incoming text chunk and returns any newly completed sentences or clauses.
   */
  public push(chunk: string): string[] {
    this.buffer += chunk;
    const sentences: string[] = [];

    // Match either:
    // 1. Terminal punctuation (.!?\n) followed by whitespace
    // 2. Clause punctuation (,;:\u2014) or " - " followed by whitespace
    const boundaryRegex = /([.!?\n]+|[,;:\u2014]+|\s+-\s+)\s+/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = boundaryRegex.exec(this.buffer)) !== null) {
      const matchEnd = match.index + match[0].length;
      const delimiter = match[1];
      const isTerminal = /[.!?\n]/.test(delimiter);
      const candidate = this.buffer.slice(lastIndex, match.index + delimiter.length).trim();

      // Guard 1: Ignore numbers with decimals (e.g., "version 27.2.0" or "at 2.4 GHz")
      if (/\d\.\d+$/.test(candidate) || candidate.endsWith('%')) {
        continue;
      }

      // Guard 2: Require minSentenceLength for terminal punctuation, minClauseLength for clauses
      const requiredLength = isTerminal ? this.minSentenceLength : this.minClauseLength;

      if (candidate.length >= requiredLength && !this.isAbbreviation(candidate)) {
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
