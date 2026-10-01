// Synthesized audio for Dodgeball. No audio files.

let ctx = null;
let master = null;
let muted = (() => { try { return localStorage.getItem('dodgeballMuted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function setMuted(m) {
    muted = m;
    try { localStorage.setItem('dodgeballMuted', m ? '1' : '0'); } catch {}
    if (master) master.gain.value = m ? 0 : 0.8;
}

export function unlockAudio() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : 0.8;
            master.connect(ctx.destination);
        } catch { return; }
    }
    if (ctx.state === 'suspended') ctx.resume();
}

function tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.3, freq = 1000, q = 1, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(master); src.start(t);
}

export const sfx = {
    click: () => tone(900, 700, 0.05, 'triangle', 0.05),
    join: () => tone(600, 900, 0.12, 'triangle', 0.08),
    throw: () => {
        // Whoosh: rising noise sweep
        noise(0.22, 0.18, 2500, 2);
        tone(200, 900, 0.2, 'sine', 0.06);
    },
    hit: () => {
        // Impact thud: low tone + noise burst
        tone(90, 40, 0.15, 'sine', 0.28);
        noise(0.12, 0.22, 500, 3);
    },
    catch: () => {
        // Satisfying ping: rising chime
        tone(600, 600, 0.06, 'triangle', 0.12);
        tone(900, 900, 0.06, 'triangle', 0.12, 0.05);
        tone(1200, 1200, 0.1, 'triangle', 0.1, 0.1);
    },
    bounce: () => {
        // Ball bouncing: short thud
        tone(200, 100, 0.08, 'sine', 0.1);
        noise(0.05, 0.08, 800, 4);
    },
    eliminated: () => {
        // Descending tone: out
        tone(500, 100, 0.35, 'sine', 0.12);
        tone(400, 80, 0.4, 'triangle', 0.06, 0.05);
    },
    count: () => {
        // Countdown beep
        tone(520, 520, 0.18, 'square', 0.08);
    },
    go: () => {
        // Start sound: rising two-tone
        tone(523, 523, 0.1, 'triangle', 0.12);
        tone(784, 784, 0.15, 'triangle', 0.12, 0.08);
    },
    win: () => {
        // Victory fanfare
        tone(523, 523, 0.12, 'triangle', 0.1);
        tone(659, 659, 0.12, 'triangle', 0.1, 0.1);
        tone(784, 784, 0.12, 'triangle', 0.1, 0.2);
        tone(1047, 1047, 0.25, 'triangle', 0.12, 0.3);
    },
};
