// Putt Party — 3D mini golf for up to 8 players (everyone plays each hole at once, ghost balls)
import { HostNet, ClientNet, makeCode } from './net.js?v=1';
import * as C from './course.js?v=1';
import * as gfx from './gfx.js?v=1';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=1';

const track = (name, p) => { if (window.track) window.track(name, p); };
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const MAX_PLAYERS = 8;
const COLORS = ['#f8fafc', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6'];
const BOT_NAMES = ['Birdie Bot', 'Putt Master', 'Sir Chips', 'Bogey Bill', 'Eagle Eye', 'Tee Rex', 'Lil Wedge', 'Captain Par'];
const SEND_EVERY = 1 / 12;
const HOLE_TIMEOUT = 60;           // seconds others get once someone finishes
const ST = { aim: 0, roll: 1, sink: 2, done: 3, splash: 4 };

// ── State ──────────────────────────────────────────────────────────────────
let myName = (() => { try { return localStorage.getItem('golfName') || ''; } catch { return ''; } })();
let role = null, net = null, myId = null, roomCode = '', view = 'menu';
const H = { players: [], phase: 'lobby', hole: -1, scores: {}, done: {}, pos: {}, deadline: 0, ending: false, sendT: 0 };
const roster = new Map();          // id → { id, name, color, bot, strokes, done }
let scores = {};                   // id → strokes per hole
let holeIdx = -1, hole = null, holeT = 0, phase = 'idle', introT = 0, introStart = 0, physAcc = 0;
let deadlineAt = 0, boardTimer = null;
const locals = new Map();          // balls simulated on this machine (mine + host's bots)
const remotes = new Map();         // other players' balls: { x, z, rx, rz, st }
let aim = null, orbit = null, pinch = null, overview = false;
const pointers = new Map();
let sendT = 0, lastSent = '';
let menuHole = null;

// ── Screens / UI ───────────────────────────────────────────────────────────
function show(id) {
    for (const s of ['menu', 'lobby', 'final']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
    if (id !== 'hud') $('board').classList.add('hidden');
}
function toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(() => d.remove(), 3200);
}
function setStatus(el, msg, err = false) { const s = $(el); s.textContent = msg; s.classList.toggle('error', err); }
function banner(text, sub = '', cls = '') {
    const b = $('banner');
    b.className = 'banner ' + cls; b.innerHTML = `<div class="b-main">${esc(text)}</div>${sub ? `<div class="b-sub">${esc(sub)}</div>` : ''}`;
    void b.offsetWidth; b.classList.add('show');
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.remove('show'), 2400);
}

// ── Networking helpers ─────────────────────────────────────────────────────
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

// ── Host ───────────────────────────────────────────────────────────────────
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game already in progress.' }); return; }
            H.players.push({ id: from, name: String(msg.name || 'Player').slice(0, 20), color: freeColor(), ready: false, bot: false });
            if (net && from !== myId) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            if (from !== myId) { toast(`${msg.name || 'Player'} joined`); sfx.join(); }
            break;
        }
        case 'ready': { const p = H.players.find(p => p.id === from); if (p) { p.ready = !!msg.r; emitLobby(); } break; }
        case 'p': {
            if (H.phase !== 'game') return;
            const q = H.pos[from] = { x: +msg.x || 0, z: +msg.z || 0, st: msg.st | 0 };
            const R = remotes.get(from); if (R) { R.x = q.x; R.z = q.z; R.st = q.st; }
            break;
        }
        case 'sk': { const r = roster.get(from); if (r) r.strokes = msg.n | 0; break; }
        case 'done': {
            if (H.phase !== 'game' || H.done[from] !== undefined || !roster.has(from)) return;
            const n = clamp(msg.n | 0, 1, C.MAX_STROKES);
            H.done[from] = n;
            emit({ t: 'fin', id: from, n });
            const left = [...roster.keys()].filter(id => H.done[id] === undefined);
            if (!left.length) hostEndHole();
            else if (!H.deadline) { H.deadline = performance.now() + HOLE_TIMEOUT * 1000; emit({ t: 'timer', s: HOLE_TIMEOUT }); }
            break;
        }
    }
}
function freeColor() { const used = new Set(H.players.map(p => p.color)); return COLORS.find(c => !used.has(c)) || COLORS[H.players.length % COLORS.length]; }
function emitLobby() { emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot })) }); }

function hostLeave(id) {
    const i = H.players.findIndex(p => p.id === id);
    if (i < 0) return;
    toast(`${H.players[i].name} left`);
    H.players.splice(i, 1);
    if (H.phase === 'lobby') emitLobby();
    else {
        emit({ t: 'left', id });
        if (H.phase === 'game' && [...roster.keys()].every(k => H.done[k] !== undefined)) hostEndHole();
    }
}
function kickPlayer(id) {
    const i = H.players.findIndex(p => p.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || i < 0 || id === myId) return;
    if (H.players[i].bot) { H.players.splice(i, 1); emitLobby(); return; }
    if (net) { net.send(id, { t: 'reject', reason: 'The host removed you.' }); setTimeout(() => net && net.kick(id), 500); }
    hostLeave(id);
}
function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const used = new Set(H.players.map(p => p.name));
    H.players.push({ id: 'bot_' + Math.random().toString(36).slice(2, 8), name: BOT_NAMES.find(n => !used.has(n)) || 'Bot', color: freeColor(), ready: true, bot: true });
    emitLobby();
}
function hostStartGame() {
    const notReady = H.players.filter(p => !p.bot && p.id !== myId && !p.ready);
    if (notReady.length) { setStatus('lobby-status', `${notReady[0].name} isn't ready yet.`, true); return; }
    H.phase = 'game'; H.scores = {};
    for (const p of H.players) H.scores[p.id] = [];
    emit({ t: 'start', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot })) });
    hostNextHole(0);
    track('match_start', { players: H.players.length });
}
function hostNextHole(i) {
    H.hole = i; H.done = {}; H.pos = {}; H.deadline = 0; H.ending = false;
    emit({ t: 'hole', i });
}
function hostEndHole() {
    if (H.ending || H.phase !== 'game') return;
    H.ending = true;
    for (const id of roster.keys()) { if (!H.scores[id]) H.scores[id] = []; H.scores[id][H.hole] = H.done[id] ?? C.MAX_STROKES; }
    emit({ t: 'holeEnd', i: H.hole, scores: H.scores });
    const next = H.hole + 1;
    setTimeout(() => {
        if (role !== 'host' || H.phase !== 'game') return;
        if (next < C.HOLE_COUNT) hostNextHole(next);
        else { H.phase = 'final'; emit({ t: 'final', scores: H.scores }); }
    }, 6500);
}
function hostUpdate(dt) {
    if (H.phase !== 'game') return;
    if (H.deadline && performance.now() > H.deadline) hostEndHole();
    H.sendT -= dt;
    if (H.sendT > 0) return;
    H.sendT = SEND_EVERY;
    const a = [];
    for (const [id, r] of roster) {
        const L = locals.get(id);
        const q = L ? { x: L.b.x, z: L.b.z, st: ST[L.state] } : H.pos[id];
        if (!q) continue;
        a.push([id, Math.round(q.x * 100) / 100, Math.round(q.z * 100) / 100, q.st, L ? L.strokes : r.strokes]);
    }
    if (net) net.broadcast({ t: 'bs', a });
    renderPlayersHud();
}

// ── Client ─────────────────────────────────────────────────────────────────
function clientHandle(msg) {
    if (!role) return;
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; break;
        case 'reject': leave(msg.reason); break;
        case 'lobby': renderLobby(msg.players); break;
        case 'start':
            roster.clear(); scores = {};
            for (const p of msg.players) { roster.set(p.id, { ...p, strokes: 0, done: false }); scores[p.id] = []; }
            break;
        case 'hole': startHole(msg.i); break;
        case 'bs':
            for (const [id, x, z, st, n] of msg.a) {
                const r = roster.get(id); if (r && id !== myId) { r.strokes = n; r.done = st === ST.done || st === ST.sink; }
                const R = remotes.get(id); if (!R) continue;
                R.x = x; R.z = z; R.st = st;
            }
            renderPlayersHud();
            break;
        case 'fin': {
            const r = roster.get(msg.id); if (!r) break;
            r.done = true; r.strokes = msg.n;
            if (msg.id !== myId && hole) toast(`${r.name}: ${C.scoreName(msg.n, hole.par)} (${msg.n})`);
            renderPlayersHud();
            break;
        }
        case 'timer': deadlineAt = performance.now() + msg.s * 1000; break;
        case 'holeEnd':
            scores = msg.scores; phase = 'between'; deadlineAt = 0;
            gfx.setAim(false); aim = null;
            renderBoard(msg.i, false);
            $('board').classList.remove('hidden');
            break;
        case 'final': showFinal(msg.scores); break;
        case 'left': {
            const r = roster.get(msg.id); if (!r) break;
            roster.delete(msg.id); remotes.delete(msg.id); locals.delete(msg.id); gfx.removeBall(msg.id);
            const lab = $('lab-' + msg.id); if (lab) lab.remove();
            renderPlayersHud();
            break;
        }
        case 'toLobby':
            view = 'lobby'; show('lobby'); endPlay();
            break;
    }
}

// ── Hole setup ─────────────────────────────────────────────────────────────
function startHole(i) {
    view = 'game'; show('hud');
    holeIdx = i; hole = C.prepareHole(C.HOLES[i]); holeT = 0; physAcc = 0;
    gfx.buildHole(hole); gfx.clearBalls(); gfx.setAim(false);
    locals.clear(); remotes.clear(); $('labels').innerHTML = '';
    aim = orbit = pinch = null; overview = false; deadlineAt = 0;
    $('board').classList.add('hidden');
    const [tx, tz] = hole.tee;
    for (const r of roster.values()) {
        r.strokes = 0; r.done = false;
        const mine = r.id === myId;
        gfx.addBall(r.id, r.color, !mine);
        if (mine || (role === 'host' && r.bot)) locals.set(r.id, newLocal(r));
        else remotes.set(r.id, { x: tx, z: tz, rx: tx, rz: tz, st: ST.aim });
        if (!mine) {
            const d = document.createElement('div'); d.className = 'label'; d.id = 'lab-' + r.id;
            d.innerHTML = `<span class="dot" style="background:${r.color}"></span>${esc(r.name)}`;
            $('labels').appendChild(d);
        }
    }
    $('hole-num').textContent = `HOLE ${i + 1}/${C.HOLE_COUNT}`;
    $('hole-name').textContent = hole.name;
    $('hole-par').textContent = `PAR ${hole.par}`;
    renderPlayersHud(); updateStrokesHud();

    // Fly-over intro: from above the cup back to the tee
    phase = 'intro'; introT = 0; introStart = performance.now(); startHole.flying = false;
    const B = hole.bounds, rig = gfx.rig;
    rig.tfx = hole.cup[0]; rig.tfy = 0; rig.tfz = hole.cup[1];
    rig.tYaw = gfx.yawBehind(hole.cup[0] - tx, hole.cup[1] - tz) + 0.9;
    rig.tPitch = 0.8; rig.tDist = B.r * 1.2 + 3;
    gfx.snapCamera();
    banner(hole.name, `Hole ${i + 1} · Par ${hole.par}`, 'intro');
}
function newLocal(r) {
    const [x, z] = hole.tee;
    return { id: r.id, r, bot: !!r.bot, skill: 0.45 + Math.random() * 0.35, b: C.makeBall(x, z), state: 'aim', strokes: 0,
             restX: x, restZ: z, px: x, pz: z, anim: 0, plan: null, think: 1.2 + Math.random() * 1.2, wasSand: false };
}
function faceNextTarget(x, z) {
    const [hx, hz] = C.aimHint(hole, x, z);
    gfx.rig.tYaw = gfx.yawBehind(hx - x, hz - z);
}
function endPlay() {
    hole = null; phase = 'idle'; locals.clear(); remotes.clear(); roster.clear();
    gfx.clearBalls(); gfx.setAim(false); $('labels').innerHTML = '';
    clearTimeout(boardTimer);
    showMenuScene();
}

// ── Physics & ball logic ───────────────────────────────────────────────────
const events = [], botEvents = [];
function stepPhysics(dt) {
    physAcc += dt;
    let steps = 0;
    while (physAcc >= C.PHYS_DT && steps < 24) {
        for (const L of locals.values()) {
            if (L.state !== 'roll') continue;
            L.px = L.b.x; L.pz = L.b.z;
            const r = C.stepBall(hole, L.b, holeT, C.PHYS_DT, L.id === myId ? events : botEvents);
            if (r) onBallResult(L, r);
        }
        holeT += C.PHYS_DT; physAcc -= C.PHYS_DT; steps++;
    }
    if (steps >= 24) physAcc = 0;
    for (const e of events) {
        if (e.type === 'wall') sfx.wall(e.speed);
        else if (e.type === 'bumper') { sfx.bumper(); gfx.bumperHit(e.i); }
        else if (e.type === 'lip') sfx.lip();
    }
    for (const e of botEvents) if (e.type === 'bumper') gfx.bumperHit(e.i);
    events.length = 0; botEvents.length = 0;

    const me = locals.get(myId);
    if (me && me.state === 'roll') {
        const s = C.inSand(hole, me.b.x, me.b.z);
        if (s && !me.wasSand) { sfx.sand(); gfx.puff(me.b.x, C.heightAt(hole, me.b.x, me.b.z) + 0.02, me.b.z); }
        me.wasSand = s;
    }
}
function onBallResult(L, r) {
    const mine = L.id === myId;
    if (r === 'holed') {
        L.state = 'sink'; L.anim = 0; L.px = L.b.x; L.pz = L.b.z;
        report(L, 'done');
        if (mine) {
            const name = C.scoreName(L.strokes, hole.par), under = L.strokes < hole.par || L.strokes === 1;
            sfx.cup(); setTimeout(() => under && sfx.cheer(L.strokes === 1), 350);
            banner(name, `${L.strokes} stroke${L.strokes > 1 ? 's' : ''}`, L.strokes === 1 ? 'ace' : under ? 'good' : '');
            gfx.confetti(hole.cup[0], C.heightAt(hole, hole.cup[0], hole.cup[1]), hole.cup[1]);
            if (L.strokes === 1) track('hole_in_one', { hole: holeIdx + 1 });
        }
    } else if (r === 'ob') {
        L.state = 'splash'; L.anim = 0; L.strokes++; L.obX = L.b.x; L.obZ = L.b.z;
        report(L, 'sk');
        const wy = gfx.waterLevel();
        gfx.splash(L.b.x, wy ?? C.heightAt(hole, L.b.x, L.b.z), L.b.z);
        if (mine) { sfx.splash(); toast('Splash! +1 penalty stroke'); }
    } else if (r === 'rest') {
        L.restX = L.b.x; L.restZ = L.b.z; L.px = L.b.x; L.pz = L.b.z;
        if (L.strokes >= C.MAX_STROKES) { L.state = 'done'; report(L, 'done'); if (mine) banner('Picked up', `Max ${C.MAX_STROKES} strokes`); }
        else { L.state = 'aim'; L.think = 0.6 + Math.random() * 0.9; if (mine && !overview) faceNextTarget(L.b.x, L.b.z); }
    }
    if (mine) updateStrokesHud();
}
function report(L, kind) {
    const msg = kind === 'done' ? { t: 'done', n: L.strokes } : { t: 'sk', n: L.strokes };
    if (L.id === myId) act(msg); else if (role === 'host') hostHandle(L.id, msg);
    renderPlayersHud();
}
function shootLocal(L, dx, dz, speed) {
    C.shoot(L.b, dx, dz, speed);
    L.state = 'roll'; L.strokes++; L.plan = null; L.wasSand = C.inSand(hole, L.b.x, L.b.z);
    report(L, 'sk');
}
function animLocals(dt) {
    for (const L of locals.values()) {
        if (L.state === 'sink') {
            L.anim += dt;
            if (L.anim > 0.6) L.state = 'done';
        } else if (L.state === 'splash') {
            L.anim += dt;
            if (L.anim > 1.2) {
                L.b.x = L.restX; L.b.z = L.restZ; L.b.vx = L.b.vz = 0; L.px = L.restX; L.pz = L.restZ;
                if (L.strokes >= C.MAX_STROKES) { L.state = 'done'; report(L, 'done'); }
                else { L.state = 'aim'; L.think = 0.8; if (L.id === myId) faceNextTarget(L.b.x, L.b.z); }
                if (L.id === myId) updateStrokesHud();
            }
        }
    }
}
function updateBots(dt) {
    let budget = 6;
    for (const L of locals.values()) {
        if (!L.bot || L.state !== 'aim') continue;
        if (!L.plan) {
            L.think -= dt; if (L.think > 0) continue;
            // Plan for a moment far enough ahead that planning (spread over frames) finishes first,
            // so windmill blades / movers are where the bot expects them when it putts
            L.lead = L.lead || 1.8;
            L.planT = holeT + L.lead;
            L.plan = C.planShot(hole, L.b.x, L.b.z, L.planT, L.skill);
        }
        if (!L.plan.done) {
            if (budget <= 0) continue;
            const t0 = performance.now(); L.plan.work(budget); budget -= performance.now() - t0;
            if (L.plan.done && holeT > L.planT) { L.lead = Math.min(8, L.lead * 1.6); L.plan = null; } // too slow: replan further ahead
            continue;
        }
        if (holeT < L.planT) continue;
        shootLocal(L, Math.sin(L.plan.a), Math.cos(L.plan.a), L.plan.speed);
    }
}

// Ball render position (interpolated between physics steps)
function ballPos(L) {
    const a = clamp(physAcc / C.PHYS_DT, 0, 1);
    const x = L.state === 'roll' ? L.px + (L.b.x - L.px) * a : L.b.x;
    const z = L.state === 'roll' ? L.pz + (L.b.z - L.pz) * a : L.b.z;
    let y = C.heightAt(hole, x, z) + C.BALL_R, vis = true, rx = x, rz = z;
    if (L.state === 'sink') {
        const k = clamp(L.anim / 0.35, 0, 1);
        rx = x + (hole.cup[0] - x) * k; rz = z + (hole.cup[1] - z) * k;
        y = C.heightAt(hole, hole.cup[0], hole.cup[1]) + C.BALL_R - k * k * 0.26;
    } else if (L.state === 'splash') {
        const wy = gfx.waterLevel();
        y -= Math.min(1, L.anim * 1.6) * (wy !== null ? (y - wy + 0.2) : 0.35);
        vis = L.anim < 0.8;
    } else if (L.state === 'done') vis = false;
    return { x: rx, y, z: rz, vis };
}

// ── Aiming ─────────────────────────────────────────────────────────────────
function myBall() { return locals.get(myId); }
function canAim() { const L = myBall(); return phase === 'play' && L && L.state === 'aim'; }
function updateAim(sx, sy) {
    const L = myBall(); if (!L) return;
    const by = C.heightAt(hole, L.b.x, L.b.z) + C.BALL_R;
    const sp = gfx.project(L.b.x, by, L.b.z);
    const pix = Math.hypot(sx - sp.x, sy - sp.y);
    aim.power = clamp((pix - 12) / (Math.min(innerWidth, innerHeight) * 0.34), 0, 1);
    const P = gfx.screenToGround(sx, sy, by);
    let dx, dz;
    if (P && Math.hypot(P.x - L.b.x, P.z - L.b.z) > 0.01) { dx = L.b.x - P.x; dz = L.b.z - P.z; }
    else { // pointer above the horizon: fall back to screen direction
        const yaw = gfx.rig.yaw, ux = -(sx - sp.x), uy = (sy - sp.y);
        dx = ux * Math.cos(yaw) - uy * Math.sin(yaw); dz = -ux * Math.sin(yaw) - uy * Math.cos(yaw);
    }
    const d = Math.hypot(dx, dz) || 1;
    aim.dx = dx / d; aim.dz = dz / d;
}
const shotSpeed = p => 0.35 + 8.3 * Math.pow(p, 1.5);
function releaseAim() {
    const L = myBall();
    if (aim && L && canAim() && aim.power > 0.03) {
        shootLocal(L, aim.dx, aim.dz, shotSpeed(aim.power));
        sfx.putt(aim.power);
        overview = false; updateStrokesHud();
        $('hint').classList.add('faded');
    }
    aim = null; gfx.setAim(false); $('power').classList.add('hidden');
}
let previewPath = [];
function drawAimPreview() {
    const L = myBall();
    if (!aim || !L || aim.power <= 0.03 || !canAim()) { gfx.setAim(false); $('power').classList.toggle('hidden', !aim); if (aim) setPowerBar(0); return; }
    const sp = shotSpeed(aim.power);
    previewPath.length = 0;
    C.simulate(hole, L.b.x, L.b.z, aim.dx * sp, aim.dz * sp, holeT, 2, previewPath, 5);
    // Only show the first stretch — reading the rest is the skill
    const maxLen = 0.9 + aim.power * 2.8; let len = 0, px = L.b.x, pz = L.b.z, cut = previewPath.length;
    for (let i = 0; i < previewPath.length; i += 2) {
        len += Math.hypot(previewPath[i] - px, previewPath[i + 1] - pz); px = previewPath[i]; pz = previewPath[i + 1];
        if (len > maxLen) { cut = i; break; }
    }
    previewPath.length = cut;
    gfx.setAim(true, L.b.x, L.b.z, aim.dx, aim.dz, aim.power, previewPath);
    $('power').classList.remove('hidden'); setPowerBar(aim.power);
}
function setPowerBar(p) {
    const f = $('power-fill'); f.style.width = `${p * 100}%`;
    f.style.background = p < 0.5 ? `hsl(${140 - p * 150},75%,50%)` : `hsl(${65 - (p - 0.5) * 130},85%,52%)`;
}

// ── Input ──────────────────────────────────────────────────────────────────
const cvs = $('c');
cvs.addEventListener('pointerdown', e => {
    unlockAudio();
    try { cvs.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (phase === 'intro' && introT > 0.4) { introT = 2.6; return; }
    if (pointers.size === 2) {
        aim = null; orbit = null; gfx.setAim(false); $('power').classList.add('hidden');
        const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        return;
    }
    if (pointers.size > 2 || !hole) return;
    const L = myBall();
    if (canAim() && e.button !== 2) {
        const by = C.heightAt(hole, L.b.x, L.b.z) + C.BALL_R;
        const sp = gfx.project(L.b.x, by, L.b.z);
        const grab = e.pointerType === 'touch' ? 95 : 70;
        if (Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < grab) {
            aim = { id: e.pointerId, power: 0, dx: 0, dz: -1 };
            updateAim(e.clientX, e.clientY);
            return;
        }
    }
    orbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
cvs.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        gfx.rig.tDist = clamp(gfx.rig.tDist * pinch.d / Math.max(20, d), 1.4, overview ? 40 : 16); pinch.d = d;
        return;
    }
    if (aim && aim.id === e.pointerId) { updateAim(e.clientX, e.clientY); return; }
    if (orbit && orbit.id === e.pointerId) {
        gfx.rig.tYaw -= (e.clientX - orbit.x) * 0.0065;
        gfx.rig.tPitch = clamp(gfx.rig.tPitch + (e.clientY - orbit.y) * 0.0045, 0.12, 1.45);
        orbit.x = e.clientX; orbit.y = e.clientY;
    }
});
const endPointer = e => {
    pointers.delete(e.pointerId);
    if (aim && aim.id === e.pointerId) releaseAim();
    if (orbit && orbit.id === e.pointerId) orbit = null;
    if (pointers.size < 2) pinch = null;
};
cvs.addEventListener('pointerup', endPointer);
cvs.addEventListener('pointercancel', e => { if (aim && aim.id === e.pointerId) { aim = null; gfx.setAim(false); $('power').classList.add('hidden'); } endPointer(e); });
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('wheel', e => { e.preventDefault(); gfx.rig.tDist = clamp(gfx.rig.tDist * (1 + e.deltaY * 0.0012), 1.4, overview ? 40 : 16); }, { passive: false });
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'Escape' && aim) { aim = null; gfx.setAim(false); $('power').classList.add('hidden'); }
    if (e.code === 'KeyV' && view === 'game') toggleOverview();
});
addEventListener('keyup', e => { keys[e.code] = false; });

function toggleOverview() {
    if (!hole || phase === 'intro') return;
    overview = !overview;
    const B = hole.bounds, rig = gfx.rig;
    if (overview) { rig.tfx = B.cx; rig.tfy = 0; rig.tfz = B.cz; rig.tPitch = 1.15; rig.tDist = B.r * 2.1 + 3; }
    else { rig.tPitch = 0.42; rig.tDist = 3.4; const L = myBall(); if (L && L.state === 'aim') faceNextTarget(L.b.x, L.b.z); }
    $('btn-view').classList.toggle('on', overview);
}

// ── Camera ─────────────────────────────────────────────────────────────────
function updateCameraTargets(dt) {
    const rig = gfx.rig;
    if (keys.ArrowLeft || keys.KeyA) rig.tYaw += dt * 1.6;
    if (keys.ArrowRight || keys.KeyD) rig.tYaw -= dt * 1.6;
    if (keys.ArrowUp || keys.KeyW) rig.tPitch = clamp(rig.tPitch + dt * 0.8, 0.12, 1.45);
    if (keys.ArrowDown || keys.KeyS) rig.tPitch = clamp(rig.tPitch - dt * 0.8, 0.12, 1.45);

    if (phase === 'intro') {
        introT = Math.max(introT, (performance.now() - introStart) / 1000); // wall clock, even on slow devices
        if (introT > 0.35 && !startHole.flying) {
            startHole.flying = true;
            const [tx, tz] = hole.tee;
            rig.tfx = tx; rig.tfy = C.heightAt(hole, tx, tz); rig.tfz = tz;
            faceNextTarget(tx, tz); rig.tPitch = 0.42; rig.tDist = 3.4;
        }
        if (introT >= 2.6) { phase = 'play'; startHole.flying = false; $('hint').classList.remove('faded'); }
        return 1.7;
    }
    if (overview) return 4;
    const me = myBall();
    let target = me && me.state !== 'done' ? me : null;
    if (!target) {
        // Spectate whoever is still playing
        const L = [...locals.values()].find(l => l.state !== 'done' && l.id !== myId);
        const R = [...remotes.entries()].find(([, r]) => r.st !== ST.done && r.st !== ST.sink);
        if (L) target = L;
        else if (R) { rig.tfx = R[1].rx; rig.tfz = R[1].rz; rig.tfy = C.heightAt(hole, R[1].rx, R[1].rz); return 4; }
        else { const B = hole.bounds; rig.tfx = B.cx; rig.tfz = B.cz; rig.tfy = 0; rig.tPitch = 1.0; rig.tDist = B.r * 1.8 + 2; return 2; }
    }
    const p = ballPos(target);
    rig.tfx = p.x; rig.tfy = p.y - C.BALL_R; rig.tfz = p.z;
    return target.state === 'roll' ? 4.5 : 5;
}

// ── HUD ────────────────────────────────────────────────────────────────────
function updateStrokesHud() {
    const L = myBall();
    $('strokes').textContent = L ? L.strokes : 0;
}
function renderPlayersHud() {
    const el = $('players-hud');
    const rows = [...roster.values()].map(r => {
        const L = locals.get(r.id), n = L ? L.strokes : r.strokes;
        const done = L ? (L.state === 'done' || L.state === 'sink') : r.done;
        const tot = (scores[r.id] || []).reduce((a, b) => a + (b || 0), 0);
        return `<div class="ph${r.id === myId ? ' me' : ''}${done ? ' done' : ''}"><span class="dot" style="background:${r.color}"></span><span class="nm">${esc(r.name)}</span><span class="n">${done ? '✓ ' : ''}${n}</span><span class="tot">${tot || ''}</span></div>`;
    });
    el.innerHTML = rows.join('');
}
function updateLabels() {
    const all = [...locals.values()].filter(L => L.id !== myId).map(L => [L.id, ballPos(L)])
        .concat([...remotes.entries()].map(([id, R]) => [id, { x: R.rx, z: R.rz, y: C.heightAt(hole, R.rx, R.rz) + C.BALL_R, vis: R.st !== ST.done && R.st !== ST.sink && R.st !== ST.splash }]));
    for (const [id, p] of all) {
        const el = $('lab-' + id); if (!el) continue;
        const s = gfx.project(p.x, p.y + 0.18, p.z);
        const on = p.vis && !s.behind && phase !== 'intro';
        el.style.opacity = on ? 1 : 0;
        if (on) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
    if (deadlineAt && phase === 'play') {
        const s = Math.max(0, Math.ceil((deadlineAt - performance.now()) / 1000));
        $('timer').textContent = `Hole ends in ${s}s`; $('timer').classList.remove('hidden');
    } else $('timer').classList.add('hidden');
    const me = myBall();
    $('waiting').classList.toggle('hidden', !(me && me.state === 'done' && phase === 'play'));
}
function totals(sc) {
    return Object.entries(sc).map(([id, arr]) => ({ id, arr, tot: arr.reduce((a, b) => a + (b || 0), 0), played: arr.filter(v => v != null).length }));
}
function renderBoard(upTo, final) {
    const parCum = C.HOLES.slice(0, upTo + 1).reduce((a, h) => a + h.par, 0);
    const rows = totals(scores).filter(r => roster.has(r.id) || final).sort((a, b) => a.tot - b.tot);
    let html = `<table><thead><tr><th class="pl">Player</th>${C.HOLES.map((h, i) => `<th class="${i === upTo ? 'cur' : ''}">${i + 1}</th>`).join('')}<th>Tot</th><th>±</th></tr>`;
    html += `<tr class="par"><td class="pl">Par</td>${C.HOLES.map(h => `<td>${h.par}</td>`).join('')}<td>${C.HOLES.reduce((a, h) => a + h.par, 0)}</td><td></td></tr></thead><tbody>`;
    for (const r of rows) {
        const p = roster.get(r.id) || { name: '?', color: '#888' };
        const diff = r.tot - parCum;
        html += `<tr class="${r.id === myId ? 'me' : ''}"><td class="pl"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td>`;
        html += C.HOLES.map((h, i) => {
            const v = r.arr[i]; if (v == null) return '<td></td>';
            const d = v - h.par, cls = v === 1 ? 'ace' : d < 0 ? 'under' : d === 0 ? 'even' : 'over';
            return `<td class="${cls}${i === upTo ? ' cur' : ''}">${v}</td>`;
        }).join('');
        html += `<td class="tot">${r.tot}</td><td class="${diff < 0 ? 'under' : diff > 0 ? 'over' : 'even'}">${diff > 0 ? '+' : ''}${diff === 0 ? 'E' : diff}</td></tr>`;
    }
    html += '</tbody></table>';
    $('board-title').textContent = final ? 'Final Scores' : `After hole ${upTo + 1}`;
    $('board-table').innerHTML = html;
    $('board-next').textContent = final ? '' : upTo + 1 < C.HOLE_COUNT ? `Next: ${C.HOLES[upTo + 1].name}` : 'Final results next…';
}
function showFinal(sc) {
    scores = sc; phase = 'final'; view = 'final';
    renderBoard(C.HOLE_COUNT - 1, true);
    const rows = totals(sc).sort((a, b) => a.tot - b.tot);
    const parTot = C.HOLES.reduce((a, h) => a + h.par, 0);
    const podium = rows.slice(0, 3).map((r, i) => {
        const p = roster.get(r.id) || { name: '?', color: '#888' }, d = r.tot - parTot;
        return `<div class="pod p${i + 1}"><div class="medal">${['🥇', '🥈', '🥉'][i]}</div><span class="ball" style="background:${p.color}"></span><b>${esc(p.name)}</b><span>${r.tot} (${d > 0 ? '+' : ''}${d === 0 ? 'E' : d})</span></div>`;
    }).join('');
    const winner = rows[0] && roster.get(rows[0].id);
    $('final-title').textContent = rows[0] && rows[0].id === myId ? 'You win! 🏆' : winner ? `${winner.name} wins!` : 'Game over';
    $('podium').innerHTML = podium;
    $('final-table').innerHTML = $('board-table').innerHTML;
    show('final');
    if (rows[0] && rows[0].id === myId) sfx.cheer(true);
    track('match_end');
}

function renderLobby(plist) {
    view = 'lobby'; show('lobby'); setStatus('menu-status', '');
    $('room-code').textContent = roomCode || '-----';
    $('room-info').classList.toggle('hidden', !net);
    $('count').textContent = `${plist.length}/${MAX_PLAYERS}`;
    $('players').innerHTML = plist.map(p => `<li class="${p.id === myId ? 'me' : ''}"><span class="ball" style="background:${p.color}"></span><span class="who">${esc(p.name)}</span>${p.bot ? '<span class="badge bot">BOT</span>' : ''}${p.id === myId ? '<span class="badge you">YOU</span>' : ''}${!p.bot && p.ready && p.id !== myId ? '<span class="badge ok">READY</span>' : ''}${role === 'host' && p.id !== myId ? `<button class="kick" data-kick="${esc(p.id)}" type="button" aria-label="Remove">✕</button>` : ''}</li>`).join('');
    const me = plist.find(p => p.id === myId);
    $('btn-ready').textContent = me && me.ready ? 'Not ready' : 'Ready';
    $('btn-ready').dataset.r = me && me.ready ? '0' : '1';
}

// ── Menu backdrop ──────────────────────────────────────────────────────────
function showMenuScene() {
    menuHole = C.prepareHole(C.HOLES[3]);
    gfx.buildHole(menuHole);
    const B = menuHole.bounds, rig = gfx.rig;
    rig.tfx = B.cx; rig.tfy = 0.3; rig.tfz = B.cz; rig.tPitch = 0.5; rig.tDist = B.r + 4.5; rig.tYaw = 0.6;
    gfx.snapCamera();
}

// ── Main loop ──────────────────────────────────────────────────────────────
let last = performance.now(), menuT = 0;
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (hole && (phase === 'intro' || phase === 'play' || phase === 'between')) {
        if (phase === 'play') { stepPhysics(dt); if (role === 'host') updateBots(dt); }
        else holeT += dt;
        animLocals(dt);
        drawAimPreview();
        const rate = updateCameraTargets(dt);
        let near = false;
        for (const L of locals.values()) {
            const p = ballPos(L); gfx.setBall(L.id, p.x, p.z, p.y, p.vis);
            if (p.vis && Math.hypot(p.x - hole.cup[0], p.z - hole.cup[1]) < 1.6) near = true;
        }
        const k = 1 - Math.exp(-dt * 14);
        for (const [id, R] of remotes) {
            if (Math.hypot(R.x - R.rx, R.z - R.rz) > 3) { R.rx = R.x; R.rz = R.z; }
            R.rx += (R.x - R.rx) * k; R.rz += (R.z - R.rz) * k;
            const vis = R.st !== ST.done && R.st !== ST.sink && R.st !== ST.splash;
            gfx.setBall(id, R.rx, R.rz, C.heightAt(hole, R.rx, R.rz) + C.BALL_R, vis);
            if (vis && Math.hypot(R.rx - hole.cup[0], R.rz - hole.cup[1]) < 1.6) near = true;
        }
        gfx.update(dt, holeT, near);
        gfx.updateCamera(dt, rate);
        updateLabels();
        sendMine(dt);
        if (role === 'host') hostUpdate(dt);
    } else {
        menuT += dt;
        gfx.rig.tYaw += dt * 0.07;
        gfx.update(dt, menuT, false);
        gfx.updateCamera(dt, 3);
    }
    gfx.render(dt);
    requestAnimationFrame(frame);
}
function sendMine(dt) {
    if (role !== 'client' || !net) return;
    sendT -= dt; if (sendT > 0) return; sendT = SEND_EVERY;
    const L = myBall(); if (!L) return;
    const msg = { t: 'p', x: Math.round(L.b.x * 100) / 100, z: Math.round(L.b.z * 100) / 100, st: ST[L.state] };
    const key = `${msg.x},${msg.z},${msg.st}`;
    if (key === lastSent) return;
    lastSent = key; net.send(msg);
}

// ── Rooms ──────────────────────────────────────────────────────────────────
function readName() { myName = $('name').value.trim() || 'Player'; try { localStorage.setItem('golfName', myName); } catch {} }
async function createRoom() {
    unlockAudio(); readName();
    setStatus('menu-status', 'Creating room…');
    roomCode = makeCode(); role = 'host'; document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try { await hn.open(roomCode); } catch (e) {
        if (e.message === 'code-taken') return createRoom();
        setStatus('menu-status', e.message, true); role = null; document.body.classList.remove('is-host'); return;
    }
    net = hn; myId = hn.peer.id;
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    track('room_create');
}
async function joinRoom() {
    unlockAudio(); readName();
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining…');
    role = 'client'; document.body.classList.remove('is-host');
    const cn = new ClientNet({ onMessage: clientHandle, onClose: () => leave('Lost connection to the host.'), onStatus: m => setStatus('menu-status', m),
        forceRelay: new URLSearchParams(location.search).get('net') === 'relay' });
    try { myId = await cn.connect(code); } catch (e) { setStatus('menu-status', e.message, true); role = null; return; }
    net = cn; roomCode = code;
    cn.send({ t: 'hello', name: myName });
    // No lobby within 12s → the room probably doesn't exist
    setTimeout(() => { if (role === 'client' && view === 'menu') leave('No room found with that code.'); }, 12000);
    track('room_join');
}
function startSolo() {
    unlockAudio(); readName();
    role = 'host'; document.body.classList.add('is-host'); net = null;
    myId = 'me_' + Math.random().toString(36).slice(2, 8); roomCode = '';
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    addBot();
    track('play_solo');
}
function leave(reason) {
    const n = net; net = null; if (n) n.close();
    role = null; myId = null; roomCode = '';
    H.players = []; H.phase = 'lobby';
    endPlay();
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
}

// ── Buttons ────────────────────────────────────────────────────────────────
$('btn-create').onclick = createRoom;
$('btn-join').onclick = joinRoom;
$('btn-solo').onclick = startSolo;
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : startSolo()); });
$('btn-back').onclick = () => { sfx.click(); leave(); };
$('btn-copy').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied!')).catch(() => toast(`Room code: ${roomCode}`));
};
$('btn-bot').onclick = () => { sfx.click(); addBot(); };
$('btn-ready').onclick = () => { sfx.click(); act({ t: 'ready', r: $('btn-ready').dataset.r === '1' }); };
$('btn-start').onclick = () => { sfx.click(); hostStartGame(); };
$('players').addEventListener('click', e => { const id = e.target.dataset && e.target.dataset.kick; if (id) kickPlayer(id); });
$('btn-view').onclick = () => { sfx.click(); toggleOverview(); };
$('btn-quit').onclick = () => { if (confirm(role === 'host' && net ? 'Leave and close this room?' : 'Leave this game?')) leave(); };
$('btn-again').onclick = () => {
    if (role !== 'host') return;
    H.phase = 'lobby';
    for (const p of H.players) p.ready = p.bot;
    emit({ t: 'toLobby' }); emitLobby();
};
$('btn-final-leave').onclick = () => leave();
$('btn-home').onclick = () => { location.href = '../'; };
function syncMute() { document.querySelectorAll('.mute').forEach(b => b.classList.toggle('muted', isMuted())); }
document.querySelectorAll('.mute').forEach(b => b.onclick = () => { unlockAudio(); setMuted(!isMuted()); syncMute(); });
syncMute();

// ── Boot ───────────────────────────────────────────────────────────────────
$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `You're invited to room ${invite}. Enter your name and press Join.`; $('invite').classList.remove('hidden'); }
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
gfx.init(cvs);
showMenuScene();
if (new URLSearchParams(location.search).has('debug'))
    window.__golf = { locals, remotes, gfx, C, get phase() { return phase; }, get aim() { return aim; }, get hole() { return hole; }, get myId() { return myId; }, startHole,
        shoot(dx, dz, power) { aim = { id: -1, power, dx, dz }; releaseAim(); } };
show('menu');
requestAnimationFrame(frame);
