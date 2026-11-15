// Audio CINDERQUAY — WebAudio synthesis only, no files, no network.
// The context is created lazily by ensure(), which main.js calls from the
// first user gesture (never in shot mode). Every method is a no-op until
// ensure() has run, and every body is wrapped in try/catch so a sound
// failure can never break the game loop.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  // Distance in metres -> gain. 0 m is the player's own shot (full).
  function atten(dist) {
    const d = typeof dist === 'number' && dist > 0 ? dist : 0;
    return Math.max(0, Math.min(1, 1 - d / 40));
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Short burst of filtered noise. Returns the source so callers can stop it.
  function noiseHit(dur, filterType, freq, gainVal, when) {
    const t0 = when || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  // Simple oscillator blip, optionally sliding down in pitch.
  function tone(freq, dur, type, gainVal, slideTo, when) {
    const t0 = when || ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Per-weapon shot character: crack length, thump depth, overall loudness.
  const SHOT = {
    pistol: { noise: 0.09, freq: 2400, thump: 140, gain: 0.45 },
    rifle: { noise: 0.12, freq: 1800, thump: 110, gain: 0.6 },
    smg: { noise: 0.08, freq: 2600, thump: 150, gain: 0.5 },
    sniper: { noise: 0.28, freq: 1200, thump: 70, gain: 0.9 },
    shotgun: { noise: 0.22, freq: 900, thump: 60, gain: 0.85 },
  };

  return {
    ensure() {
      try {
        if (ctx) {
          if (ctx.state === 'suspended') ctx.resume();
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
      }
    },

    shot(weaponId, dist) {
      if (!ctx || !master) return;
      try {
        const w = SHOT[weaponId] || SHOT.rifle;
        const g = atten(dist) * w.gain;
        if (g <= 0.005) return;
        noiseHit(w.noise, 'lowpass', w.freq, g);
        // Low thump underneath the crack.
        tone(w.thump, 0.12, 'sine', g * 0.8, 45);
      } catch (e) { /* no-op */ }
    },

    dry() {
      if (!ctx || !master) return;
      try {
        tone(1400, 0.04, 'square', 0.12);
      } catch (e) { /* no-op */ }
    },

    reload() {
      if (!ctx || !master) return;
      try {
        const t0 = ctx.currentTime;
        tone(500, 0.05, 'square', 0.15, null, t0);
        tone(700, 0.05, 'square', 0.18, null, t0 + 0.22);
      } catch (e) { /* no-op */ }
    },

    explosion(dist) {
      if (!ctx || !master) return;
      try {
        const g = atten(dist);
        if (g <= 0.005) return;
        const t0 = ctx.currentTime;
        // Filtered noise swell, 0.8 s, lowpass sweeping down as it decays.
        const src = ctx.createBufferSource();
        src.buffer = getNoise();
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, t0);
        filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.8);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9 * g, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(t0);
        src.stop(t0 + 0.85);
        tone(55, 0.5, 'sine', 0.7 * g, 30, t0);
      } catch (e) { /* no-op */ }
    },

    beep() {
      if (!ctx || !master) return;
      try {
        tone(880, 0.07, 'square', 0.18);
      } catch (e) { /* no-op */ }
    },

    hit() {
      if (!ctx || !master) return;
      try {
        tone(1200, 0.05, 'square', 0.2);
      } catch (e) { /* no-op */ }
    },

    kill() {
      if (!ctx || !master) return;
      try {
        const t0 = ctx.currentTime;
        tone(1200, 0.06, 'square', 0.22, null, t0);
        tone(1600, 0.09, 'square', 0.22, null, t0 + 0.07);
      } catch (e) { /* no-op */ }
    },

    win() {
      if (!ctx || !master) return;
      try {
        const t0 = ctx.currentTime;
        tone(523, 0.16, 'triangle', 0.3, null, t0);
        tone(659, 0.16, 'triangle', 0.3, null, t0 + 0.16);
        tone(784, 0.3, 'triangle', 0.32, null, t0 + 0.32);
      } catch (e) { /* no-op */ }
    },

    lose() {
      if (!ctx || !master) return;
      try {
        const t0 = ctx.currentTime;
        tone(392, 0.16, 'triangle', 0.3, null, t0);
        tone(330, 0.16, 'triangle', 0.3, null, t0 + 0.16);
        tone(262, 0.32, 'triangle', 0.32, null, t0 + 0.32);
      } catch (e) { /* no-op */ }
    },

    click() {
      if (!ctx || !master) return;
      try {
        tone(900, 0.03, 'square', 0.12);
      } catch (e) { /* no-op */ }
    },

    plantTick() {
      if (!ctx || !master) return;
      try {
        tone(660, 0.05, 'square', 0.15);
      } catch (e) { /* no-op */ }
    },

    step() {
      if (!ctx || !master) return;
      try {
        noiseHit(0.05, 'lowpass', 500, 0.05);
      } catch (e) { /* no-op */ }
    },
  };
}
