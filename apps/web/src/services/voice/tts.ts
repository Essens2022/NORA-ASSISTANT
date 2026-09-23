// Text-to-speech behind a provider interface. Browser speechSynthesis today;
// a natural neural voice (server-side) can replace it without touching the UI.

import type { Lang } from '@nora/core';

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
    synth.cancel();
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

export const tts: TTSProvider = new BrowserTTS();

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
