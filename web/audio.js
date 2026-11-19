// Synthesized sound effects with Web Audio; starts after the first tap because browsers block earlier audio.
import { CONFIG } from './config.js';

export function createAudio(isOn) {
  let ctx = null, busyUntil = 0, busyPrio = 0;
  const last = {};
  const unlock = () => {
    try { ctx ??= new AudioContext(); ctx.resume(); } catch { ctx = null; }
  };
  // Phones suspend audio when the screen locks or the app is switched; any later tap brings it back.
  addEventListener('pointerdown', () => { if (ctx && ctx.state !== 'running') ctx.resume(); });

  return {
    unlock,
    // Plays one sound at a time: a sound waits out its own cooldown and never talks over an equal or more important one.
    play(name, pitch = 1) {
      const sfx = CONFIG.sfx.sounds[name];
      if (!ctx || !sfx || !isOn()) return;
      const now = ctx.currentTime;
      if (now < (last[name] ?? -Infinity) + sfx.cool || (now < busyUntil && sfx.prio <= busyPrio)) return;
      last[name] = now;
      busyUntil = now + sfx.gap * (sfx.notes.length - 1) + sfx.dur;
      busyPrio = sfx.prio;
      sfx.notes.forEach((freq, i) => {
        const t = ctx.currentTime + i * sfx.gap, osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = sfx.wave;
        osc.frequency.setValueAtTime(freq * pitch, t);
        gain.gain.setValueAtTime(CONFIG.sfx.volume, t);
        gain.gain.exponentialRampToValueAtTime(CONFIG.sfx.floor, t + sfx.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + sfx.dur);
      });
    },
  };
}
