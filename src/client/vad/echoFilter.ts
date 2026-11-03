/**
 * Semantic Anti-Echo Cancellation Filter
 * Detects whether an incoming SpeechRecognition transcript is actually acoustic echo bleed
 * from the local speakers playing the assistant's own voice.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into',
  'over', 'after', 'that', 'this', 'it', 'its', 'as'
]);

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Checks if a candidate speech transcript is an acoustic echo bleed of recent assistant utterances.
 */
export function isSelfEcho(candidateText: string, recentAssistantUtterances: string[]): boolean {
  const trimmed = candidateText.trim();
  if (!trimmed || recentAssistantUtterances.length === 0) {
    return false;
  }

  const candidateWords = normalizeWords(trimmed);
  if (candidateWords.length === 0) {
    return false;
  }

  // Significant content words (excluding common stop words)
  const candidateContentWords = candidateWords.filter((w) => !STOP_WORDS.has(w));
  const candidateNormStr = candidateWords.join(' ');

  for (const utterance of recentAssistantUtterances) {
    const utteranceWords = normalizeWords(utterance);
    if (utteranceWords.length === 0) continue;

    const utteranceNormStr = utteranceWords.join(' ');

    // 1. Verbatim substring containment for substantial phrases (20+ chars)
    // E.g. "is running macos version 27 2 0 with 48 gb"
    if (
      candidateNormStr.length >= 20 &&
      (utteranceNormStr.includes(candidateNormStr) || candidateNormStr.includes(utteranceNormStr))
    ) {
      return true;
    }

    // 2. High content word overlap (requires >= 60% match of non-stop words)
    if (candidateContentWords.length >= 3) {
      const utteranceContentWordSet = new Set(utteranceWords.filter((w) => !STOP_WORDS.has(w)));
      let matchCount = 0;
      for (const word of candidateContentWords) {
        if (utteranceContentWordSet.has(word)) {
          matchCount++;
        }
      }

      const overlapRatio = matchCount / candidateContentWords.length;
      if (overlapRatio >= 0.65) {
        return true;
      }
    }
  }

  return false;
}
