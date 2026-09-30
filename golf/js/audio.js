// Mini Golf — sound effects (Web Audio, no files, no music)
let ctx, master, noiseBuf;
let muted = (() => { try { return localStorage.getItem('golfMuted') === '1'; } catch { return false; } })();
export const isMuted = () => muted;

export function unlockAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setMuted(m) {
    muted = m; try { localStorage.setItem('golfMuted', m ? '1' : '0'); } catch {}
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.03);
}

function tone(f0, f1, dur, type, vol, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq, q, type = 'bandpass', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

let lastWall = 0;
export const sfx = {
    putt(p) { noise(0.05, 0.25 + p * 0.35, 2600, 1.2); tone(900, 500, 0.06, 'triangle', 0.1 + p * 0.1); },
    wall(speed) {
        if (!ctx || ctx.currentTime - lastWall < 0.04) return; lastWall = ctx.currentTime;
        const v = Math.min(1, speed / 5);
        noise(0.07, 0.08 + v * 0.3, 900 + v * 500, 2); tone(320 + v * 120, 180, 0.08, 'sine', 0.05 + v * 0.12);
    },
    bumper() { tone(420, 880, 0.12, 'square', 0.07); tone(660, 1320, 0.16, 'sine', 0.12, 0.02); },
    lip() { tone(1200, 900, 0.05, 'triangle', 0.08); tone(1500, 1100, 0.05, 'triangle', 0.06, 0.06); },
    cup() {
        for (let i = 0; i < 4; i++) noise(0.05, 0.22 - i * 0.04, 1800 - i * 200, 3, 'bandpass', i * 0.07);
        tone(180, 90, 0.18, 'sine', 0.25, 0.3);
    },
    splash() { noise(0.6, 0.35, 700, 0.6, 'lowpass'); noise(0.3, 0.2, 2500, 1, 'bandpass', 0.05); },
    sand() { noise(0.18, 0.15, 3200, 0.7, 'highpass'); },
    cheer(big) {
        const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
        notes.forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.13, i * 0.09));
        if (big) noise(1.2, 0.08, 3000, 0.5, 'highpass', 0.1);
    },
    click() { tone(700, 500, 0.04, 'square', 0.04); },
    tick() { tone(1000, 1000, 0.04, 'square', 0.05); },
    join() { tone(500, 750, 0.12, 'sine', 0.12); },
};
