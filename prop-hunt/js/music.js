// Prop Hunt — procedural music (Web Audio API oscillators)
import { getCtx, getMaster } from './audio.js';

let musicGain = null;
let droneNodes = [];
let currentTrack = null;
let seqTimer = null;

let _vol = 0.5;
try { _vol = parseFloat(localStorage.getItem('prophuntMusicVol') || '0.5'); } catch {}

export function play(track) {
    if (currentTrack === track && musicGain) return;
    const ctx = getCtx();
    if (!ctx) return;
    currentTrack = track;
    stopAll();

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(getMaster());

    const targetVol = { menu: 0.06, hiding: 0.07, seeking: 0.09, results: 0.06 }[track] || 0.06;
    musicGain.gain.setTargetAtTime(targetVol * _vol * 2, ctx.currentTime, 1.2);

    if (track === 'menu') buildMenu(ctx);
    else if (track === 'hiding') buildHiding(ctx);
    else if (track === 'seeking') buildSeeking(ctx);
    else if (track === 'results') buildResults(ctx);
}

export function stop() {
    if (!musicGain) return;
    const ctx = getCtx();
    if (ctx) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(stopAll, 1800);
    currentTrack = null;
}

function stopAll() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    for (const n of droneNodes) { try { n.stop(); } catch {} }
    droneNodes = [];
    if (musicGain) { try { musicGain.disconnect(); } catch {} musicGain = null; }
}

function makeDrone(ctx, freq, detune, type, vol) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.value = vol;
    osc.connect(g);
    g.connect(musicGain);
    osc.start();
    droneNodes.push(osc);
    return osc;
}

function buildMenu(ctx) {
    // Mysterious, playful ~85 BPM minor key
    makeDrone(ctx, 73.4, 0, 'sine', 0.3);      // D2
    makeDrone(ctx, 73.4, 8, 'sine', 0.15);      // D2 detuned
    makeDrone(ctx, 110, 0, 'triangle', 0.12);    // A2
    makeDrone(ctx, 146.8, -5, 'sine', 0.08);     // D3

    // Slow LFO wobble
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoG.gain.value = 5;
    lfo.connect(lfoG);
    lfoG.connect(droneNodes[0].frequency);
    lfo.start();
    droneNodes.push(lfo);

    // Plucky notes on interval
    const notes = [293.7, 349.2, 440, 392, 329.6, 293.7, 261.6, 293.7]; // D4, F4, A4, G4, E4, D4, C4, D4
    let ni = 0;
    seqTimer = setInterval(() => {
        if (!musicGain) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.value = notes[ni % notes.length];
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.65);
        ni++;
    }, 60000 / 85); // ~85 BPM
}

function buildHiding(ctx) {
    // Suspenseful, tense ~70 BPM
    makeDrone(ctx, 55, 0, 'sawtooth', 0.08);
    makeDrone(ctx, 55, 15, 'sawtooth', 0.08);
    makeDrone(ctx, 82.4, 0, 'sine', 0.15);     // E2
    makeDrone(ctx, 110, -3, 'sine', 0.1);       // A2

    // Faster LFO for tension
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.2;
    lfoG.gain.value = 8;
    lfo.connect(lfoG);
    lfoG.connect(droneNodes[0].frequency);
    lfo.start();
    droneNodes.push(lfo);

    // Filtered noise for unease
    const bufLen = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = buf; nSrc.loop = true;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = 300; nFilt.Q.value = 5;
    const nGain = ctx.createGain(); nGain.gain.value = 0.03;
    nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(musicGain);
    nSrc.start(); droneNodes.push(nSrc);

    // Tick-tock on interval
    let tick = 0;
    seqTimer = setInterval(() => {
        if (!musicGain) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime;
        osc.type = 'triangle';
        osc.frequency.value = tick % 2 === 0 ? 1200 : 900;
        g.gain.setValueAtTime(0.04, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.1);
        tick++;
    }, 60000 / 70);
}

function buildSeeking(ctx) {
    // Intense, driving ~120 BPM
    makeDrone(ctx, 41.2, 0, 'sawtooth', 0.1);   // E1
    makeDrone(ctx, 41.2, 10, 'sawtooth', 0.1);
    makeDrone(ctx, 82.4, 0, 'sine', 0.18);       // E2
    makeDrone(ctx, 123.5, 0, 'sine', 0.08);      // B2
    makeDrone(ctx, 164.8, -5, 'triangle', 0.06); // E3

    // Aggressive LFO
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.4;
    lfoG.gain.value = 10;
    lfo.connect(lfoG);
    lfoG.connect(droneNodes[0].frequency);
    lfo.start();
    droneNodes.push(lfo);

    // Driving beat
    let beat = 0;
    seqTimer = setInterval(() => {
        if (!musicGain) return;
        const t = ctx.currentTime;
        // Kick on 1 and 3
        if (beat % 4 === 0 || beat % 4 === 2) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(120, t);
            osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
            osc.connect(g); g.connect(musicGain);
            osc.start(t); osc.stop(t + 0.15);
        }
        // Hi-hat on every beat
        {
            const bufLen = Math.ceil(ctx.sampleRate * 0.04);
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
            const src = ctx.createBufferSource(); src.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = 'highpass'; filt.frequency.value = 6000;
            const g = ctx.createGain();
            g.gain.setValueAtTime(beat % 2 === 0 ? 0.06 : 0.03, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
            src.connect(filt); filt.connect(g); g.connect(musicGain);
            src.start(t); src.stop(t + 0.05);
        }
        beat++;
    }, 60000 / 120 / 2); // eighth notes at 120 BPM
}

function buildResults(ctx) {
    // Triumphant/reveal
    makeDrone(ctx, 130.8, 0, 'sine', 0.2);      // C3
    makeDrone(ctx, 164.8, 0, 'sine', 0.12);      // E3
    makeDrone(ctx, 196, 0, 'sine', 0.1);         // G3

    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoG.gain.value = 3;
    lfo.connect(lfoG);
    lfoG.connect(droneNodes[0].frequency);
    lfo.start();
    droneNodes.push(lfo);

    // Gentle arpeggiated notes
    const notes = [523.3, 659.3, 784, 1047, 784, 659.3]; // C5, E5, G5, C6, G5, E5
    let ni = 0;
    seqTimer = setInterval(() => {
        if (!musicGain) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.value = notes[ni % notes.length];
        g.gain.setValueAtTime(0.04, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        osc.connect(g); g.connect(musicGain);
        osc.start(t); osc.stop(t + 0.85);
        ni++;
    }, 500);
}
