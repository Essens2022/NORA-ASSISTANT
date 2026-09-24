// Text-to-speech: OpenAI's /audio/speech endpoint. The model infers the
// spoken language/accent from the text itself, so one voice can move
// between ro/it/en/ru without per-language switching logic.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getSecret } from './secrets.ts';

export const TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];
export const DEFAULT_TTS_VOICE: TtsVoice = 'nova';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;

export interface CloudTTS {
  readonly name: string;
  speak(text: string, voice: TtsVoice, opts?: { signal?: AbortSignal }): Promise<Response>;
}

class OpenAITTS implements CloudTTS {
  readonly name = 'openai';
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  async speak(text: string, voice: TtsVoice, opts: { signal?: AbortSignal } = {}): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: opts.signal ?? AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: this.model, voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`tts_http_${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
}

/** Cloud TTS provider from config; the key comes from env (OPENAI_API_KEY) or Vault (openai_api_key). */
export async function getTTS(admin: SupabaseClient): Promise<CloudTTS | null> {
  const provider = env('TTS_PROVIDER', 'openai');
  if (provider === 'openai') {
    const key = await getSecret(admin, 'openai_api_key', 'OPENAI_API_KEY');
    if (!key) return null;
    return new OpenAITTS(env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), key, env('TTS_MODEL', 'tts-1'));
  }
  return null;
}
