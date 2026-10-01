// Procedural background music for Dodgeball.

import { getCtx, getMaster } from './audio.js?v=1';

let musicGain = null;
let current = null;
let volume = 0.3;

export function setMusicVolume(v) {
    volume = v;
    if (musicGain) musicGain.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
    try { localStorage.setItem('dodgeballMusicVol', v.toFixed(2)); } catch {}
}
export function getMusicVolume() { return volume; }

function init() {
    const ctx = getCtx();
    if (!ctx || musicGain) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = volume;
    musicGain.connect(getMaster());
}

function stopCurrent() {
    if (!current) return;
    clearInterval(current.interval);
    for (const o of current.oscs) {
        try { o.gain.gain.setTargetAtTime(0, getCtx().currentTime, 0.1); } catch {}
        try { setTimeout(() => { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); }, 300); } catch {}
    }
    current = null;
}

function voice(type, freq, vol, filterFreq = 2000) {
    const ctx = getCtx();
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq; filter.Q.value = 1;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(musicGain); osc.start();
    return { osc, gain, filter };
}

function playNote(v, freq, vol, dur) {
    const ctx = getCtx(); const t = ctx.currentTime;
    v.osc.frequency.setValueAtTime(freq, t);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(vol, t);
    v.gain.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.1);
    v.gain.gain.setTargetAtTime(0, t + dur - 0.05, 0.08);
}

// Menu: chill, relaxed (~90 BPM) - C pentatonic
function startMenu() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 90 / 2;
    const bass = voice('sawtooth', 65.4, 0, 350);
    const pad1 = voice('triangle', 130.8, 0, 700);
    const pad2 = voice('triangle', 164.8, 0, 700);
    const arp = voice('triangle', 262, 0, 1000);
    const oscs = [bass, pad1, pad2, arp];
    const bassNotes = [65.4, 73.4, 82.4, 73.4];
    const padChords = [
        { p1: 130.8, p2: 196 },   // C + G
        { p1: 146.8, p2: 220 },   // D + A
        { p1: 164.8, p2: 246.9 }, // E + B
        { p1: 146.8, p2: 220 },   // D + A
    ];
    const arpNotes = [262, 294, 330, 392, 440, 392, 330, 294];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = padChords[bar];
        if (beat === 0 || beat === 4) playNote(bass, bassNotes[bar], 0.09, stepDur * 3);
        if (beat === 0) { playNote(pad1, ch.p1, 0.03, stepDur * 8); playNote(pad2, ch.p2, 0.02, stepDur * 8); }
        playNote(arp, arpNotes[beat], 0.02, stepDur * 0.8);
        step++;
    }, stepDur * 1000);
    current = { name: 'menu', interval, oscs };
}

// Game: energetic, pumping (~140 BPM) - A minor pentatonic
function startGame() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 140 / 4;
    const bass = voice('sawtooth', 110, 0, 500);
    const lead = voice('triangle', 440, 0, 1500);
    const kick = voice('sine', 60, 0, 200);
    const hihat = voice('sawtooth', 8000, 0, 12000);
    const oscs = [bass, lead, kick, hihat];
    const bassNotes = [110, 130.8, 146.8, 130.8];
    const melody = [
        [440, 0, 523, 0, 587, 0, 659, 0, 784, 0, 659, 0, 587, 0, 523, 0],
        [587, 0, 784, 0, 659, 0, 587, 0, 523, 0, 440, 0, 523, 0, 587, 0],
        [659, 0, 587, 0, 523, 0, 440, 0, 523, 0, 587, 0, 659, 0, 784, 0],
        [523, 0, 440, 0, 587, 0, 659, 0, 784, 0, 587, 0, 523, 0, 440, 0],
    ];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 16) % 4;
        const beat = step % 16;
        if (beat % 4 === 0) playNote(kick, 60, 0.14, stepDur * 2);
        if (beat % 2 === 1) playNote(hihat, 8000 + Math.random() * 2000, 0.014, stepDur * 0.5);
        if (beat === 0 || beat === 8) playNote(bass, bassNotes[bar], 0.1, stepDur * 6);
        const note = melody[bar][beat];
        if (note > 0) playNote(lead, note, 0.035, stepDur * 1.5);
        step++;
    }, stepDur * 1000);
    current = { name: 'game', interval, oscs };
}

// Results: triumphant, major key, 110 BPM
function startResults() {
    const ctx = getCtx(); if (!ctx) return;
    const stepDur = 60 / 110 / 2;
    const bass = voice('sawtooth', 130.8, 0, 450);
    const pad1 = voice('triangle', 262, 0, 900);
    const pad2 = voice('triangle', 330, 0, 900);
    const lead = voice('triangle', 523, 0, 1400);
    const oscs = [bass, pad1, pad2, lead];
    const chords = [
        { b: 130.8, p1: 262, p2: 330 },  // C major
        { b: 174.6, p1: 349, p2: 440 },  // F major
        { b: 196, p1: 392, p2: 494 },    // G major
        { b: 130.8, p1: 262, p2: 392 },  // C (with 5th)
    ];
    const melodyNotes = [523, 659, 784, 880, 784, 659, 784, 1047];
    let step = 0;
    const interval = setInterval(() => {
        if (!getCtx()) return;
        const bar = Math.floor(step / 8) % 4;
        const beat = step % 8;
        const ch = chords[bar];
        if (beat === 0 || beat === 4) playNote(bass, ch.b, 0.1, stepDur * 3.5);
        if (beat === 0) {
            playNote(pad1, ch.p1, 0.035, stepDur * 8);
            playNote(pad2, ch.p2, 0.025, stepDur * 8);
        }
        playNote(lead, melodyNotes[beat] * (bar === 3 ? 1.0 : (bar === 1 ? 1.335 : 1.0)), 0.025, stepDur * 0.9);
        step++;
    }, stepDur * 1000);
    current = { name: 'results', interval, oscs };
}

export function play(trackName) {
    init();
    if (current && current.name === trackName) return;
    stopCurrent();
    if (!getCtx()) return;
    if (trackName === 'menu') startMenu();
    else if (trackName === 'game') startGame();
    else if (trackName === 'results') startResults();
}

export function stop() { stopCurrent(); }

try { const saved = localStorage.getItem('dodgeballMusicVol'); if (saved !== null) volume = parseFloat(saved) || 0.3; } catch {}
