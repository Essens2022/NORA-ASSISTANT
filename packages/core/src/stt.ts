// Speech-to-text guard. Whisper-family models "hear" phrases in silence
// ("Thank you for watching", "Sottotitoli creati dalla comunità Amara.org",
// "Продолжение следует"…). Such transcripts must never reach the task parser.

import { norm } from './parse.ts';

export interface SttSegment {
  text: string;
  start?: number;
  end?: number;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}

export interface SttResult {
  text: string;
  language?: string | null;
  duration?: number | null;
  segments?: SttSegment[];
}

/** Provider port: Groq whisper-large-v3 today; OpenAI, Apple, Google or on-device later. */
export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audio: Blob, opts: { language?: string | null; prompt?: string; signal?: AbortSignal }): Promise<SttResult>;
}

const HALLUCINATIONS = [
  'thank you for watching', 'thanks for watching', 'thank you', 'thanks', 'you', 'bye', 'bye bye', 'subtitles by the amara.org community',
  'please subscribe', 'like and subscribe', 'see you next time',
  'multumesc pentru vizionare', 'multumesc', 'va multumesc', 'abonati-va', 'subtitrarea',
  'sottotitoli creati dalla comunita amara.org', 'sottotitoli e revisione a cura di qtss', 'grazie per la visione', 'grazie', 'grazie a tutti',
  'продолжение следует', 'спасибо за просмотр', 'субтитры сделал dimatorzok', 'субтитры создавал dimatorzok', 'редактор субтитров', 'спасибо',
].map(norm);

export const MIN_SPEECH_SECONDS = 0.35;

export type SttVerdict = { ok: true; text: string } | { ok: false; reason: 'too_short' | 'empty' | 'no_speech' | 'hallucination' };

export function acceptTranscript(r: SttResult): SttVerdict {
  const text = (r.text ?? '').trim();
  if (r.duration != null && r.duration < MIN_SPEECH_SECONDS) return { ok: false, reason: 'too_short' };
  const n = norm(text).replace(/[.\s]+$/g, '');
  if (!n || !/[\p{L}\p{N}]/u.test(n)) return { ok: false, reason: 'empty' };

  const segs = r.segments ?? [];
  if (segs.length) {
    const speechy = segs.filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.5) && (s.compression_ratio ?? 1) < 2.6);
    if (!speechy.length) return { ok: false, reason: 'no_speech' };
  }
  const stripped = n.replace(/[^\p{L}\p{N}\s.]/gu, '').trim();
  if (HALLUCINATIONS.some((h) => stripped === h || (stripped.startsWith(h) && stripped.length < h.length + 4))) return { ok: false, reason: 'hallucination' };
  if (/amara\.?org|dimatorzok|qtss/.test(stripped)) return { ok: false, reason: 'hallucination' };
  return { ok: true, text };
}
