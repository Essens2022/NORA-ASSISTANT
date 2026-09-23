// Microphone capture with voice-activity detection.
//
// Silence never leaves the device: if no speech energy is detected, nothing is
// uploaded (spec §16). The noise floor is calibrated during the first 250 ms,
// recording stops automatically ~1.2 s after the user stops talking, and very
// short blips are discarded.

export interface RecordingResult {
  blob: Blob;
  durationSec: number;
  speechMs: number;
}

export type StopReason = 'silence_after_speech' | 'no_speech' | 'manual' | 'max_length' | 'cancelled';

export interface RecorderOptions {
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  maxMs?: number;
  noSpeechTimeoutMs?: number;
  endSilenceMs?: number;
}

export class MicUnavailableError extends Error {
  constructor(public reason: 'denied' | 'unsupported' | 'busy') {
    super(reason);
  }
}

const MIN_SPEECH_MS = 280;

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  return '';
}

export async function micPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const s = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return s.state;
  } catch {
    return 'unknown';
  }
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stopReason: StopReason = 'manual';
  private resolveDone!: (r: { result: RecordingResult | null; reason: StopReason }) => void;
  readonly done: Promise<{ result: RecordingResult | null; reason: StopReason }>;

  constructor(private opts: RecorderOptions = {}) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new MicUnavailableError('unsupported');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      const name = (err as DOMException)?.name;
      throw new MicUnavailableError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotReadableError' ? 'busy' : 'unsupported');
    }
    const mime = pickMime();
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => this.finish();
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.monitor();
  }

  private monitor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream!);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const maxMs = this.opts.maxMs ?? 30_000;
    const noSpeechMs = this.opts.noSpeechTimeoutMs ?? 6_000;
    const endSilenceMs = this.opts.endSilenceMs ?? 1_200;
    let floor = 0.01;
    let calibrated = false;
    let speechStart = 0;
    let lastVoice = 0;
    this.speechMs = 0;
    let lastT = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const elapsed = now - this.startedAt;

      if (!calibrated) {
        floor = Math.max(floor * 0.8 + rms * 0.2, 0.004);
        if (elapsed > 250) calibrated = true;
      }
      const threshold = Math.max(floor * 3, 0.015);
      const voiced = calibrated && rms > threshold;
      if (voiced) {
        this.speechMs += dt;
        lastVoice = now;
        if (!speechStart && this.speechMs > 120) {
          speechStart = now;
          this.opts.onSpeechStart?.();
        }
      } else if (calibrated && !speechStart) {
        floor = floor * 0.98 + rms * 0.02; // track slowly changing background noise
      }
      this.opts.onLevel?.(Math.min(1, rms / (threshold * 4)));

      if (elapsed > maxMs) return this.stop('max_length');
      if (!speechStart && elapsed > noSpeechMs) return this.stop('no_speech');
      if (speechStart && now - lastVoice > endSilenceMs) return this.stop('silence_after_speech');
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private speechMs = 0;

  stop(reason: StopReason = 'manual') {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    this.stopReason = reason;
    cancelAnimationFrame(this.raf);
    this.recorder.stop();
  }

  cancel() {
    this.stop('cancelled');
  }

  private finish() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.opts.onLevel?.(0);
    const durationSec = (performance.now() - this.startedAt) / 1000;
    const reason = this.stopReason;
    if (reason === 'cancelled' || this.speechMs < MIN_SPEECH_MS) {
      this.resolveDone({ result: null, reason: reason === 'cancelled' ? 'cancelled' : 'no_speech' });
      return;
    }
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
    this.resolveDone({ result: { blob, durationSec, speechMs: this.speechMs }, reason });
  }
}
