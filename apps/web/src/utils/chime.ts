// NORA's signature sound, synthesised on the fly (no audio file to download):
// three soft bell tones rising a fifth – clear, calm, unmistakable.
let ctx: AudioContext | null = null;

export function playChime(level: 'normal' | 'important' = 'normal') {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = level === 'important' ? 0.32 : 0.22;
    master.connect(ctx.destination);
    // E5 → B5 → E6
    const notes: Array<[number, number]> = [
      [659.25, 0],
      [987.77, 0.14],
      [1318.51, 0.28],
    ];
    const repeat = level === 'important' ? 2 : 1;
    for (let r = 0; r < repeat; r++) {
      for (const [freq, at] of notes) {
        const start = t0 + at + r * 0.9;
        for (const [mult, amp] of [
          [1, 1],
          [2, 0.18],
          [3, 0.06],
        ] as const) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq * mult;
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(amp, start + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
          osc.connect(g).connect(master);
          osc.start(start);
          osc.stop(start + 1);
        }
      }
    }
  } catch {
    /* audio not available – the visual reminder still shows */
  }
}
