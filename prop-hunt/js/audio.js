// Prop Hunt — synthesized audio (Web Audio API, no files)
let ctx, master;
let _muted = false;

try { _muted = JSON.parse(localStorage.getItem('prophuntMuted') || 'false'); } catch {}

export const isMuted = () => _muted;
export const getCtx = () => ctx;
export const getMaster = () => master;

export function unlockAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = _muted ? 0 : 0.5;
    master.connect(ctx.destination);
}

export function setMuted(m) {
    _muted = !!m;
    try { localStorage.setItem('prophuntMuted', JSON.stringify(_muted)); } catch {}
    if (master) master.gain.setTargetAtTime(_muted ? 0 : 0.5, ctx.currentTime, 0.05);
}

function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.01);
}

function noise(dur, vol, freq, q = 1, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const bufLen = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.01);
}

export const sfx = {
    click() {
        tone(800, 600, 0.06, 'square', 0.08);
    },
    join() {
        tone(400, 600, 0.15, 'sine', 0.18);
        tone(600, 800, 0.12, 'sine', 0.12, 0.12);
    },
    shoot() {
        if (!ctx) return;
        // Sharp pop/crack
        tone(1200, 200, 0.08, 'sawtooth', 0.3);
        noise(0.06, 0.35, 3000, 2);
        tone(400, 100, 0.12, 'square', 0.15, 0.02);
    },
    hitPlayer() {
        if (!ctx) return;
        // Dramatic reveal - ascending sting
        tone(300, 900, 0.3, 'sawtooth', 0.3);
        tone(400, 1200, 0.25, 'sine', 0.25, 0.05);
        noise(0.2, 0.2, 2000, 3);
        tone(200, 100, 0.4, 'sine', 0.2, 0.15);
    },
    hitProp() {
        if (!ctx) return;
        // Dull thud + damage indicator
        tone(80, 40, 0.2, 'sine', 0.3);
        noise(0.15, 0.25, 200, 0.8);
        tone(200, 150, 0.15, 'square', 0.1, 0.05);
    },
    propSelect() {
        if (!ctx) return;
        // Morphing/transforming sound
        tone(300, 800, 0.2, 'sine', 0.2);
        tone(500, 300, 0.15, 'triangle', 0.15, 0.08);
        tone(400, 600, 0.12, 'sine', 0.12, 0.15);
    },
    _stepAlt: false,
    footstep() {
        if (!ctx) return;
        const freq = this._stepAlt ? 55 : 48;
        this._stepAlt = !this._stepAlt;
        noise(0.08, 0.15, freq, 0.6);
        tone(freq, freq * 0.6, 0.08, 'sine', 0.08);
    },
    found() {
        if (!ctx) return;
        // Alarm - you've been found
        tone(600, 900, 0.15, 'square', 0.3);
        tone(900, 600, 0.15, 'square', 0.25, 0.15);
        tone(600, 900, 0.12, 'square', 0.2, 0.3);
    },
    count() {
        tone(880, 880, 0.08, 'square', 0.12);
    },
    go() {
        tone(440, 660, 0.25, 'sine', 0.22);
        tone(660, 880, 0.2, 'sine', 0.18, 0.1);
        tone(880, 1100, 0.15, 'sine', 0.15, 0.2);
    },
    win() {
        tone(523, 523, 0.2, 'sine', 0.25);
        tone(659, 659, 0.2, 'sine', 0.22, 0.2);
        tone(784, 784, 0.3, 'sine', 0.25, 0.4);
        tone(1047, 1047, 0.5, 'sine', 0.2, 0.6);
    },
    heartbeat() {
        if (!ctx) return;
        // Double thump
        tone(50, 35, 0.12, 'sine', 0.3);
        noise(0.1, 0.15, 60, 0.4);
        tone(45, 30, 0.1, 'sine', 0.25, 0.14);
        noise(0.08, 0.12, 55, 0.4, 0.14);
    },
};
