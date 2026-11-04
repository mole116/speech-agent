/**
 * Pitch and Acoustic Profile Estimator for Voice Cloning
 * Uses Normalized Autocorrelation on audio frames to estimate fundamental frequency (F0)
 * and calibrate acoustic speech parameters (pitch, rate, timbre mapping).
 */

export interface AcousticVoiceAnalysis {
  meanPitchHz: number;
  pitchClassification: 'low' | 'medium' | 'high';
  calibratedPitch: number;
  calibratedRate: number;
  recommendedBaseVoice: string;
  durationSec: number;
  confidence: number;
}

/**
 * Estimate fundamental frequency (F0) of a single audio frame using autocorrelation
 * Search range: 65 Hz to 350 Hz
 */
export function estimateFramePitch(
  frame: Float32Array,
  sampleRate: number,
  minFreq = 65,
  maxFreq = 350
): { pitchHz: number; confidence: number } {
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  if (frame.length <= maxLag) {
    return { pitchHz: 0, confidence: 0 };
  }

  // Compute energy of the frame
  let energy0 = 0;
  for (let i = 0; i < frame.length; i++) {
    energy0 += frame[i] * frame[i];
  }
  if (energy0 < 0.001) {
    // Silence frame
    return { pitchHz: 0, confidence: 0 };
  }

  let bestLag = -1;
  let maxCorr = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let energyLag = 0;
    const len = frame.length - lag;

    for (let i = 0; i < len; i++) {
      sum += frame[i] * frame[i + lag];
      energyLag += frame[i + lag] * frame[i + lag];
    }

    const norm = Math.sqrt(energy0 * energyLag);
    const corr = norm > 0 ? sum / norm : 0;

    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && maxCorr > 0.45) {
    return {
      pitchHz: sampleRate / bestLag,
      confidence: maxCorr,
    };
  }

  return { pitchHz: 0, confidence: 0 };
}

/**
 * Analyze an entire audio buffer of recorded speech and extract acoustic profile
 */
export function analyzeAudioBuffer(
  channelData: Float32Array,
  sampleRate: number,
  availableVoiceNames: string[] = []
): AcousticVoiceAnalysis {
  const durationSec = channelData.length / sampleRate;
  const frameSize = Math.floor(sampleRate * 0.04); // 40ms analysis window
  const hopSize = Math.floor(sampleRate * 0.02); // 20ms hop
  const pitches: number[] = [];
  const confidences: number[] = [];

  for (let offset = 0; offset + frameSize < channelData.length; offset += hopSize) {
    const frame = channelData.subarray(offset, offset + frameSize);
    const result = estimateFramePitch(frame, sampleRate);
    if (result.pitchHz > 0 && result.confidence > 0.5) {
      pitches.push(result.pitchHz);
      confidences.push(result.confidence);
    }
  }

  // Calculate median or mean pitch from voiced frames
  let meanPitchHz = 140; // Default fallback neutral pitch
  let avgConfidence = 0.5;

  if (pitches.length > 0) {
    // Sort to remove extreme outliers (bottom 10% and top 10%)
    pitches.sort((a, b) => a - b);
    const startIdx = Math.floor(pitches.length * 0.1);
    const endIdx = Math.ceil(pitches.length * 0.9);
    const trimmed = pitches.slice(startIdx, endIdx);

    const sum = trimmed.reduce((acc, p) => acc + p, 0);
    meanPitchHz = Math.round(sum / (trimmed.length || 1));
    avgConfidence = confidences.reduce((acc, c) => acc + c, 0) / confidences.length;
  }

  // Pitch classification
  let classification: 'low' | 'medium' | 'high' = 'medium';
  if (meanPitchHz < 140) {
    classification = 'low';
  } else if (meanPitchHz > 195) {
    classification = 'high';
  }

  // Calibrate speech synthesis pitch multiplier (0.85 to 1.25)
  // 120Hz -> ~0.90, 160Hz -> 1.00, 220Hz -> ~1.15
  let calibratedPitch = 1.0;
  if (meanPitchHz < 160) {
    calibratedPitch = Math.max(0.85, Math.min(1.0, 0.85 + ((meanPitchHz - 70) / 90) * 0.15));
  } else {
    calibratedPitch = Math.max(1.0, Math.min(1.25, 1.0 + ((meanPitchHz - 160) / 100) * 0.25));
  }
  calibratedPitch = Math.round(calibratedPitch * 100) / 100;

  // Calibrate speaking rate based on duration
  // Target reading duration for sample prompt is ~3.5 to 5.0 seconds
  let calibratedRate = 1.05;
  if (durationSec > 0) {
    if (durationSec < 3.2) {
      calibratedRate = 1.15; // User speaks fast
    } else if (durationSec > 5.5) {
      calibratedRate = 0.95; // User speaks more deliberately
    }
  }

  // Match closest system base voice from available voices
  const recommendedBaseVoice = pickRecommendedBaseVoice(classification, availableVoiceNames);

  return {
    meanPitchHz,
    pitchClassification: classification,
    calibratedPitch,
    calibratedRate,
    recommendedBaseVoice,
    durationSec: Math.round(durationSec * 10) / 10,
    confidence: Math.round(avgConfidence * 100) / 100,
  };
}

/**
 * Select best matching base voice from installed system voices
 */
export function pickRecommendedBaseVoice(
  classification: 'low' | 'medium' | 'high',
  availableVoices: string[]
): string {
  const lowPitchCandidates = ['Daniel', 'Alex', 'Fred', 'Oliver', 'Thomas', 'Aaron'];
  const highPitchCandidates = ['Samantha', 'Victoria', 'Karen', 'Moira', 'Fiona', 'Serena', 'Tessa'];
  const mediumCandidates = ['Samantha', 'Daniel', 'Alex', 'Junior'];

  let preferred = mediumCandidates;
  if (classification === 'low') preferred = lowPitchCandidates;
  if (classification === 'high') preferred = highPitchCandidates;

  if (availableVoices && availableVoices.length > 0) {
    for (const name of preferred) {
      const match = availableVoices.find((v) => v.toLowerCase().includes(name.toLowerCase()));
      if (match) return match;
    }
    // Return any english voice
    const fallback = availableVoices.find((v) => v.toLowerCase().includes('en'));
    if (fallback) return fallback;
  }

  return preferred[0];
}
