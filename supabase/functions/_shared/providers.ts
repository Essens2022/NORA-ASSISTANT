// AI / STT providers. The rest of NORA only sees the AIProvider and
// SpeechToTextProvider interfaces, so Groq can be swapped for OpenAI,
// Anthropic, a local model, Apple or Google without touching the app.

import type { AIProvider, ChatMessage, SpeechToTextProvider, SttResult } from './core/index.ts';

/** Any OpenAI-compatible chat endpoint (Groq, OpenAI, Together, vLLM, …). */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly name: string,
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private extra: Record<string, unknown> = {},
  ) {}

  async completeJSON(messages: ChatMessage[], opts: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: opts.signal ?? AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2,
        max_completion_tokens: opts.maxTokens ?? 800,
        response_format: { type: 'json_object' },
        ...this.extra,
      }),
    });
    if (!res.ok) throw new Error(`ai_http_${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('ai_empty');
    return content;
  }
}

/** Whisper via an OpenAI-compatible /audio/transcriptions endpoint (Groq whisper-large-v3 by default). */
export class WhisperProvider implements SpeechToTextProvider {
  constructor(
    readonly name: string,
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  async transcribe(audio: Blob, opts: { language?: string | null; prompt?: string; signal?: AbortSignal }): Promise<SttResult> {
    const form = new FormData();
    const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : 'webm';
    form.append('file', audio, `speech.${ext}`);
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (opts.language) form.append('language', opts.language);
    if (opts.prompt) form.append('prompt', opts.prompt);
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: opts.signal ?? AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`stt_http_${res.status}: ${(await res.text()).slice(0, 300)}`);
    const d = await res.json();
    return {
      text: d.text ?? '',
      language: d.language ?? null,
      duration: typeof d.duration === 'number' ? d.duration : null,
      segments: Array.isArray(d.segments) ? d.segments : [],
    };
  }
}

const env = (k: string, d = '') => Deno.env.get(k) ?? d;

export function aiFromEnv(): AIProvider | null {
  const provider = env('AI_PROVIDER', 'groq');
  if (provider === 'groq') {
    const key = env('GROQ_API_KEY');
    if (!key) return null;
    // gpt-oss is a reasoning model – keep reasoning short for voice latency.
    return new OpenAICompatibleProvider('groq', 'https://api.groq.com/openai/v1', key, env('AI_MODEL', 'openai/gpt-oss-120b'), { reasoning_effort: env('AI_REASONING', 'low') });
  }
  if (provider === 'openai') {
    const key = env('OPENAI_API_KEY');
    if (!key) return null;
    return new OpenAICompatibleProvider('openai', env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), key, env('AI_MODEL', 'gpt-4.1-mini'));
  }
  return null;
}

export function sttFromEnv(): SpeechToTextProvider | null {
  const provider = env('STT_PROVIDER', 'groq');
  if (provider === 'groq') {
    const key = env('GROQ_API_KEY');
    return key ? new WhisperProvider('groq', 'https://api.groq.com/openai/v1', key, env('STT_MODEL', 'whisper-large-v3')) : null;
  }
  if (provider === 'openai') {
    const key = env('OPENAI_API_KEY');
    return key ? new WhisperProvider('openai', env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), key, env('STT_MODEL', 'whisper-1')) : null;
  }
  return null;
}
