/**
 * Real-Time Sentence Segmenter for Low-Latency Streaming TTS
 * Slices an incoming token stream into speech-ready sentences or phrases
 * without waiting for full generation to complete.
 */
export class SentenceSegmenter {
    buffer = '';
    sentenceIndex = 0;
    minSentenceLength = 12; // Avoid emitting tiny fragments like "Mr."
    /**
     * Appends incoming text chunk and returns any newly completed sentences.
     */
    push(chunk) {
        this.buffer += chunk;
        const sentences = [];
        // Match punctuation followed by whitespace or end of line
        // Regex looks for ., !, ?, or newline
        const sentenceEndRegex = /([.!?\n]+)\s+/g;
        let match;
        let lastIndex = 0;
        while ((match = sentenceEndRegex.exec(this.buffer)) !== null) {
            const matchEnd = match.index + match[0].length;
            const candidate = this.buffer.slice(lastIndex, match.index + match[1].length).trim();
            // Ensure candidate isn't an abbreviation like 'e.g.', 'i.e.', 'Dr.', 'vs.'
            if (candidate.length >= this.minSentenceLength && !this.isAbbreviation(candidate)) {
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
    flush() {
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
    reset() {
        this.buffer = '';
        this.sentenceIndex = 0;
    }
    getIndex() {
        return this.sentenceIndex;
    }
    isAbbreviation(text) {
        const abbreviations = ['mr.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'approx.'];
        const lower = text.toLowerCase();
        return abbreviations.some((abbr) => lower.endsWith(abbr));
    }
}
