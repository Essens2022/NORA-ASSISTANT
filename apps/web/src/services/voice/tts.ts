// Text-to-speech behind a provider interface. Cloud (OpenAI, server-side)
// when available – natural, professional, auto-switches accent by language
// from the text alone – falling back to the browser's speechSynthesis.

import type { Lang } from '@nora/core';
import { config } from '../../config/brand.ts';
import { accessToken } from '../auth.ts';

export interface TTSProvider {
  readonly name: string;
  available(): boolean;
  speak(text: string, lang: Lang, opts?: { voiceURI?: string | null; signal?: AbortSignal }): Promise<void>;
  stop(): void;
  voices(lang: Lang): Promise<Array<{ uri: string; name: string }>>;
}

const BCP47: Record<Lang, string> = { en: 'en-US', ro: 'ro-RO', it: 'it-IT', ru: 'ru-RU' };

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 800);
  });
}

// Prefer natural-sounding voices when the platform offers several.
const QUALITY = /(natural|neural|premium|enhanced|siri|google|online)/i;

export class BrowserTTS implements TTSProvider {
  readonly name = 'browser';

  available() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  async voices(lang: Lang) {
    if (!this.available()) return [];
    const list = await loadVoices();
    return list
      .filter((v) => v.lang.toLowerCase().startsWith(lang))
      .sort((a, b) => Number(QUALITY.test(b.name)) - Number(QUALITY.test(a.name)))
      .map((v) => ({ uri: v.voiceURI, name: v.name }));
  }

  async speak(text: string, lang: Lang, opts: { voiceURI?: string | null; signal?: AbortSignal } = {}) {
    if (!this.available() || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      await new Promise((r) => setTimeout(r, 80)); // Safari drops an utterance queued right after cancel()
    }
    synth.resume(); // Safari can be left paused after the page was in the background
    const list = await loadVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[lang];
    const byUri = opts.voiceURI ? list.find((v) => v.voiceURI === opts.voiceURI && v.lang.toLowerCase().startsWith(lang)) : null;
    const candidates = list.filter((v) => v.lang.toLowerCase().startsWith(lang));
    u.voice = byUri ?? candidates.find((v) => QUALITY.test(v.name)) ?? candidates[0] ?? null;
    u.rate = 1.05;
    u.pitch = 1;
    await new Promise<void>((resolve) => {
      const end = () => resolve();
      u.onend = end;
      u.onerror = end;
      opts.signal?.addEventListener('abort', () => {
        synth.cancel();
        end();
      });
      // Chrome sometimes never fires onend for long texts – safety timeout.
      setTimeout(end, Math.min(20_000, 1500 + text.length * 90));
      synth.speak(u);
    });
  }

  stop() {
    if (this.available()) window.speechSynthesis.cancel();
  }
}

// Fixed OpenAI voice list – one voice speaks every language NORA supports,
// picking up the accent from the text itself, so this list doesn't vary by lang.
const CLOUD_VOICES: Array<{ uri: string; name: string }> = [
  { uri: 'nova', name: 'Nova' },
  { uri: 'alloy', name: 'Alloy' },
  { uri: 'ash', name: 'Ash' },
  { uri: 'coral', name: 'Coral' },
  { uri: 'echo', name: 'Echo' },
  { uri: 'fable', name: 'Fable' },
  { uri: 'onyx', name: 'Onyx' },
  { uri: 'sage', name: 'Sage' },
  { uri: 'shimmer', name: 'Shimmer' },
];

class CloudTTS implements TTSProvider {
  readonly name = 'cloud';
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  available() {
    return typeof Audio !== 'undefined';
  }

  async voices(_lang: Lang) {
    return CLOUD_VOICES;
  }

  async speak(text: string, _lang: Lang, opts: { voiceURI?: string | null; signal?: AbortSignal } = {}) {
    if (!text.trim()) return;
    this.stop();
    const token = await accessToken();
    if (!token) throw new Error('unauthorized');
    const res = await fetch(`${config.apiUrl}/v1/speak`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: opts.voiceURI || undefined }),
      signal: opts.signal ?? AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`tts_http_${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    const audio = new Audio(url);
    this.audio = audio;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      audio.onended = done;
      audio.onerror = done;
      opts.signal?.addEventListener('abort', () => {
        audio.pause();
        done();
      });
      audio.play().catch(done);
    });
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

/** Cloud TTS when the backend has it configured, falling back to the browser otherwise. */
class HybridTTS implements TTSProvider {
  readonly name = 'hybrid';
  private cloud = new CloudTTS();
  private browser = new BrowserTTS();
  private cloudEnabled = false;

  setCloudEnabled(v: boolean) {
    this.cloudEnabled = v;
  }

  available() {
    return this.cloudEnabled ? this.cloud.available() || this.browser.available() : this.browser.available();
  }

  async voices(lang: Lang) {
    return this.cloudEnabled ? this.cloud.voices(lang) : this.browser.voices(lang);
  }

  async speak(text: string, lang: Lang, opts: { voiceURI?: string | null; signal?: AbortSignal } = {}) {
    if (this.cloudEnabled) {
      try {
        await this.cloud.speak(text, lang, opts);
        return;
      } catch {
        if (opts.signal?.aborted) return; // the user cancelled – don't fall back and speak anyway
      }
    }
    await this.browser.speak(text, lang, opts);
  }

  stop() {
    this.cloud.stop();
    this.browser.stop();
  }
}

export const tts: TTSProvider & { setCloudEnabled(v: boolean): void } = new HybridTTS();

let primed = false;
/**
 * iOS only lets a page speak after it has spoken once inside a user gesture; NORA's
 * replies arrive seconds after the tap, so speak a silent utterance on the first touch.
 */
export function primeSpeech() {
  if (primed || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    primed = false;
  }
}

export const VOICE_KEY = 'nora.voice';
export function savedVoice(lang: Lang): string | null {
  try {
    return localStorage.getItem(`${VOICE_KEY}.${lang}`);
  } catch {
    return null;
  }
}
export function saveVoice(lang: Lang, uri: string | null) {
  try {
    if (uri) localStorage.setItem(`${VOICE_KEY}.${lang}`, uri);
    else localStorage.removeItem(`${VOICE_KEY}.${lang}`);
  } catch {
    /* ignore */
  }
}
