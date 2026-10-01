// Dodgeball: online multiplayer dodgeball arena.
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js?v=1';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js?v=1';
import { play as playMusic, stop as stopMusic } from './music.js?v=1';

const track = (name, params) => { if (window.track) window.track(name, params); };

// ============================================================
// Constants
// ============================================================
const MAX_PLAYERS = 8;
const BEST_OF = 3;
const ARENA_W = 30;
const ARENA_D = 20;
const WALL_H = 2.5;
const WALL_T = 0.4;
const BALL_R = 0.3;
const BALL_SPEED = 28;
const BALL_GRAVITY = 18;
const BALL_BOUNCE = 0.55;
const BALL_FLOOR_FRICTION = 0.92;
const BALL_LIFETIME = 8;
const BALLS_PER_ROUND = 5;
const PLAYER_R = 0.45;
const PLAYER_H = 1.6;
const MOVE_SPEED = 9;
const ACCEL = 28;
const FRICTION = 20;
const CATCH_WINDOW = 0.35;
const CATCH_CD = 1.0;
const SEND_EVERY = 0.05;
const HIT_R = 0.7;
const COLORS = ['#f97316', '#3b82f6', '#2ec495', '#f2c14e', '#a78bfa', '#e0584f', '#ec4899', '#e2e8f0'];
const BOT_NAMES = ['Cannon', 'Slingshot', 'Rocket', 'Blitz', 'Boomer', 'Sniper', 'Turbo', 'Flash'];

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ============================================================
// Three.js setup
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1410);
scene.fog = new THREE.Fog(0x1a1410, 40, 80);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 200);
camera.position.set(0, 22, 20);
camera.lookAt(0, 0, 0);

// Lights
const ambientLight = new THREE.AmbientLight(0xffeedd, 0.5);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xfff0e0, 0x302820, 0.4);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfff5e8, 1.2);
dirLight.position.set(10, 20, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 15;
dirLight.shadow.camera.bottom = -15;
dirLight.shadow.bias = -0.001;
dirLight.shadow.normalBias = 0.02;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
fillLight.position.set(-8, 10, -6);
scene.add(fillLight);

// ============================================================
// Arena
// ============================================================
let arenaGroup = null;

function buildFloorTexture() {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512;
    const cx = cv.getContext('2d');
    // Wood base
    cx.fillStyle = '#8B6914';
    cx.fillRect(0, 0, 512, 512);
    // Wood grain lines
    for (let i = 0; i < 60; i++) {
        cx.strokeStyle = `rgba(${100 + Math.random() * 40}, ${60 + Math.random() * 30}, ${10 + Math.random() * 15}, ${0.15 + Math.random() * 0.1})`;
        cx.lineWidth = 1 + Math.random() * 2;
        cx.beginPath();
        const y = Math.random() * 512;
        cx.moveTo(0, y + (Math.random() - 0.5) * 20);
        for (let x = 0; x < 512; x += 20) {
            cx.lineTo(x, y + (Math.random() - 0.5) * 6);
        }
        cx.stroke();
    }
    // Plank lines
    for (let i = 1; i < 8; i++) {
        cx.strokeStyle = 'rgba(40, 25, 5, 0.4)';
        cx.lineWidth = 2;
        cx.beginPath();
        cx.moveTo(0, i * 64);
        cx.lineTo(512, i * 64);
        cx.stroke();
    }
    // Court lines - center line
    cx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    cx.lineWidth = 4;
    cx.beginPath();
    cx.moveTo(256, 0); cx.lineTo(256, 512);
    cx.stroke();
    // Center circle
    cx.beginPath();
    cx.arc(256, 256, 60, 0, Math.PI * 2);
    cx.stroke();
    // Boundary rectangle
    cx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    cx.lineWidth = 3;
    cx.strokeRect(20, 20, 472, 472);
    return cv;
}

function buildArena() {
    if (arenaGroup) { scene.remove(arenaGroup); }
    arenaGroup = new THREE.Group();
    // Floor
    const floorTex = new THREE.CanvasTexture(buildFloorTexture());
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex, roughness: 0.7, metalness: 0.05, color: 0xddaa55,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    arenaGroup.add(floor);
    // Ground plane for darkness outside arena
    const outer = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    arenaGroup.add(outer);
    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x556677, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.55,
    });
    const hw = ARENA_W / 2, hd = ARENA_D / 2;
    const walls = [
        { w: ARENA_W + WALL_T * 2, d: WALL_T, x: 0, z: -hd - WALL_T / 2 },
        { w: ARENA_W + WALL_T * 2, d: WALL_T, x: 0, z: hd + WALL_T / 2 },
        { w: WALL_T, d: ARENA_D, x: -hw - WALL_T / 2, z: 0 },
        { w: WALL_T, d: ARENA_D, x: hw + WALL_T / 2, z: 0 },
    ];
    for (const w of walls) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.d), wallMat);
        mesh.position.set(w.x, WALL_H / 2, w.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        arenaGroup.add(mesh);
    }
    // Center line marker on the floor (thin bright strip)
    const centerLine = new THREE.Mesh(
        new THREE.PlaneGeometry(0.08, ARENA_D - 0.2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    );
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.01;
    arenaGroup.add(centerLine);
    scene.add(arenaGroup);
}

function removeArena() {
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup = null; }
    // Remove player models and balls
    const toRemove = scene.children.filter(c => c._isPlayer || c._isBall || c._isLabel || c._isParticle);
    toRemove.forEach(c => scene.remove(c));
}

// ============================================================
// Player models
// ============================================================
function buildPlayerModel(color, name) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    // Body capsule (cylinder + two hemispheres)
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_R, PLAYER_H - PLAYER_R * 2, 8, 16), bodyMat);
    body.position.y = PLAYER_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    // Eyes (two small white spheres with dark pupils)
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const eyePupil = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    for (let side = -1; side <= 1; side += 2) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeWhite);
        eye.position.set(side * 0.15, PLAYER_H - 0.25, PLAYER_R * 0.8);
        group.add(eye);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyePupil);
        pupil.position.set(side * 0.15, PLAYER_H - 0.25, PLAYER_R * 0.8 + 0.05);
        group.add(pupil);
    }
    // Name label (sprite)
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 64;
    const lctx = labelCanvas.getContext('2d');
    lctx.font = 'bold 28px Inter, sans-serif';
    lctx.textAlign = 'center';
    lctx.fillStyle = 'rgba(0,0,0,0.5)';
    lctx.fillRect(0, 0, 256, 64);
    lctx.fillStyle = '#ffffff';
    lctx.fillText(name || 'Player', 128, 40);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(2.5, 0.625, 1);
    label.position.y = PLAYER_H + 0.6;
    label._isLabel = true;
    group.add(label);
    group._isPlayer = true;
    group._body = body;
    group._bodyMat = bodyMat;
    return group;
}

// ============================================================
// Ball models
// ============================================================
function buildBallModel() {
    const group = new THREE.Group();
    const ballMat = new THREE.MeshStandardMaterial({
        color: 0xe83030, roughness: 0.35, metalness: 0.2, emissive: 0x661010, emissiveIntensity: 0.3,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 16), ballMat);
    ball.castShadow = true;
    group.add(ball);
    // Glow ring
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.15 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.5, 12, 12), glowMat);
    group.add(glow);
    group._isBall = true;
    group._glowMesh = glow;
    group._ballMat = ballMat;
    return group;
}

// ============================================================
// Trail effect for thrown balls
// ============================================================
function createTrail() {
    const MAX_POINTS = 20;
    const positions = new Float32Array(MAX_POINTS * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.4 });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    return { line, positions, geom, idx: 0, count: 0, MAX_POINTS };
}

function updateTrail(trail, x, y, z) {
    trail.idx = (trail.idx + 1) % trail.MAX_POINTS;
    const i = trail.idx * 3;
    trail.positions[i] = x; trail.positions[i + 1] = y; trail.positions[i + 2] = z;
    trail.count = Math.min(trail.count + 1, trail.MAX_POINTS);
    // Rebuild draw order
    const pos = trail.geom.attributes.position;
    const arr = pos.array;
    const ordered = new Float32Array(trail.count * 3);
    for (let j = 0; j < trail.count; j++) {
        const src = ((trail.idx - trail.count + 1 + j + trail.MAX_POINTS) % trail.MAX_POINTS) * 3;
        ordered[j * 3] = arr[src]; ordered[j * 3 + 1] = arr[src + 1]; ordered[j * 3 + 2] = arr[src + 2];
    }
    for (let j = 0; j < trail.count * 3; j++) arr[j] = ordered[j];
    trail.geom.setDrawRange(0, trail.count);
    pos.needsUpdate = true;
}

// ============================================================
// Particle system for hit/elimination effects
// ============================================================
const particles = [];

function spawnParticles(x, y, z, color, count = 20) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        velocities.push({
            vx: (Math.random() - 0.5) * 8,
            vy: Math.random() * 6 + 2,
            vz: (Math.random() - 0.5) * 8,
        });
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color), size: 0.15, transparent: true, opacity: 1, depthWrite: false });
    const points = new THREE.Points(geom, mat);
    points._isParticle = true;
    scene.add(points);
    particles.push({ points, geom, mat, velocities, life: 1.0 });
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 1.5;
        if (p.life <= 0) {
            scene.remove(p.points);
            p.geom.dispose(); p.mat.dispose();
            particles.splice(i, 1);
            continue;
        }
        p.mat.opacity = p.life;
        const pos = p.geom.attributes.position;
        for (let j = 0; j < p.velocities.length; j++) {
            const v = p.velocities[j];
            v.vy -= 12 * dt;
            pos.array[j * 3] += v.vx * dt;
            pos.array[j * 3 + 1] += v.vy * dt;
            pos.array[j * 3 + 2] += v.vz * dt;
        }
        pos.needsUpdate = true;
    }
}

// ============================================================
// Game state
// ============================================================
let myName = (() => { try { return localStorage.getItem('dodgeballName') || ''; } catch { return ''; } })();
let role = null;     // 'host' | 'client' | null
let net = null;
let myId = null;
let roomCode = '';
let view = 'menu';   // 'menu' | 'lobby' | 'game' | 'results'
let gameActive = false;
let sendTimer = 0;

const players = new Map(); // id -> player object
let me = null;

// Camera state
let camYaw = 0;
let camPitch = 0.5;
const CAM_DIST = 14;
const CAM_HEIGHT = 10;
let camTarget = new THREE.Vector3(0, 0, 0);
let camPos = new THREE.Vector3(0, 22, 20);

// Mouse aim state
let aimX = 0, aimZ = 0; // world-space aim direction
let wantThrow = false;
let wantCatch = false;

// Balls - managed by host
const balls = new Map(); // uid -> ball object
let ballUid = 0;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    round: 0,
    ballSpawns: [],
};

// ============================================================
// Screens
// ============================================================
function show(id) {
    for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
}

function setStatus(el, msg, err) { const s = $(el); s.textContent = msg; s.classList.toggle('error', !!err); }
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showCenterMsg(text, pop) {
    const el = $('center-msg');
    el.textContent = text;
    el.className = pop ? 'pop' : '';
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2000);
}

// ============================================================
// Messaging
// ============================================================
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

// ============================================================
// Host logic
// ============================================================
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            H.players.push({ id: from, name: msg.name || 'Player', color, ready: false, bot: false, wins: 0 });
            if (net) net.send(from, { t: 'welcome', you: from, code: roomCode });
            emitLobby();
            toast(`${msg.name || 'Player'} joined`);
            sfx.join();
            break;
        }
        case 'ready': {
            const p = H.players.find(p => p.id === from);
            if (p) { p.ready = !!msg.r; emitLobby(); }
            break;
        }
        case 'st': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && from !== myId) {
                p.x = msg.x; p.z = msg.z; p.h = msg.h;
            }
            break;
        }
        case 'grab': {
            if (!gameActive) return;
            const p = players.get(from);
            const b = balls.get(msg.bid);
            if (!p || !b || !p.alive || p.hasBall) return;
            if (b.state !== 'ground') return;
            if (Math.hypot(p.x - b.x, p.z - b.z) > 2.5) return;
            b.state = 'held';
            b.holder = from;
            p.hasBall = msg.bid;
            emit({ t: 'grabbed', bid: msg.bid, pid: from });
            break;
        }
        case 'throw': {
            if (!gameActive) return;
            const p = players.get(from);
            if (!p || !p.alive || !p.hasBall) return;
            const b = balls.get(p.hasBall);
            if (!b) return;
            const dx = msg.dx || 0, dz = msg.dz || 0;
            const len = Math.hypot(dx, dz);
            const ndx = len > 0 ? dx / len : 0, ndz = len > 0 ? dz / len : 0;
            b.state = 'flying';
            b.holder = null;
            b.thrower = from;
            b.x = p.x + ndx * 0.8;
            b.y = PLAYER_H * 0.7;
            b.z = p.z + ndz * 0.8;
            b.vx = ndx * BALL_SPEED;
            b.vy = 2;
            b.vz = ndz * BALL_SPEED;
            b.flyTime = 0;
            p.hasBall = null;
            emit({ t: 'thrown', bid: b.uid, pid: from, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
            sfx.throw();
            break;
        }
        case 'catch': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && p.alive && p.catchCd <= 0) {
                p.catching = true;
                p.catchTimer = CATCH_WINDOW;
                p.catchCd = CATCH_CD;
            }
            break;
        }
    }
}

function hostLeave(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const name = H.players[idx].name;
    H.players.splice(idx, 1);
    toast(`${name} left`);
    if (H.phase === 'lobby') emitLobby();
    else {
        const p = players.get(id);
        if (p && p.model) scene.remove(p.model);
        players.delete(id);
    }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot, wins: p.wins })) });
}

function kickPlayer(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || idx < 0 || id === myId) return;
    const p = H.players[idx];
    if (p.bot) { H.players.splice(idx, 1); emitLobby(); return; }
    if (!net) return;
    net.send(id, { t: 'reject', reason: 'The host removed you from the room.' });
    setTimeout(() => net && net.kick(id), 600);
    hostLeave(id);
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    H.players.push({ id: botId, name, color: COLORS[H.players.length % COLORS.length], ready: true, bot: true, wins: 0 });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 2) { setStatus('lobby-status', 'Need at least 2 players.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }
    H.phase = 'game';
    H.round = 0;
    for (const p of H.players) p.wins = 0;
    emit({ t: 'gameStart', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, wins: 0 })) });
    hostNextRound();
}

function hostNextRound() {
    H.round++;
    ballUid = 0;

    // Spawn positions: players on opposite sides of the center line
    const n = H.players.length;
    const hw = ARENA_W / 2 - 2;
    const hd = ARENA_D / 2 - 2;
    const spawns = H.players.map((_, i) => {
        const side = i < Math.ceil(n / 2) ? -1 : 1;
        const idx = i < Math.ceil(n / 2) ? i : i - Math.ceil(n / 2);
        const total = i < Math.ceil(n / 2) ? Math.ceil(n / 2) : Math.floor(n / 2);
        const spacing = Math.min(3, (ARENA_D - 4) / Math.max(1, total));
        const zOff = (idx - (total - 1) / 2) * spacing;
        return { x: side * (hw * 0.6), z: zOff };
    });

    // Ball spawn positions on center line
    const ballSpawns = [];
    for (let i = 0; i < BALLS_PER_ROUND; i++) {
        const z = ((i - (BALLS_PER_ROUND - 1) / 2) / Math.max(1, BALLS_PER_ROUND - 1)) * (ARENA_D - 6);
        ballSpawns.push({ x: 0, z });
    }

    emit({
        t: 'roundStart', round: H.round, bestOf: BEST_OF,
        spawns: H.players.map((p, i) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, x: spawns[i].x, z: spawns[i].z, wins: p.wins })),
        balls: ballSpawns.map((b, i) => ({ uid: ++ballUid, x: b.x, z: b.z })),
    });

    setTimeout(() => emit({ t: 'go' }), 3500);
}

function hostUpdate(dt) {
    if (!gameActive || H.phase !== 'game') return;

    // Bot AI
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        p.botThinkT -= dt;
        if (p.botThinkT > 0) continue;
        p.botThinkT = 0.2 + Math.random() * 0.4;

        // Find nearest ball on ground
        let nearBall = null, nearBallDist = Infinity;
        for (const [bid, b] of balls) {
            if (b.state !== 'ground') continue;
            const d = Math.hypot(b.x - p.x, b.z - p.z);
            if (d < nearBallDist) { nearBallDist = d; nearBall = b; }
        }

        // Find nearest opponent
        let nearEnemy = null, nearEnemyDist = Infinity;
        for (const [oid, op] of players) {
            if (oid === id || !op.alive) continue;
            const d = Math.hypot(op.x - p.x, op.z - p.z);
            if (d < nearEnemyDist) { nearEnemyDist = d; nearEnemy = op; }
        }

        if (p.hasBall && nearEnemy) {
            // Have a ball - throw at nearest enemy with some aim variation
            const dx = nearEnemy.x - p.x + (Math.random() - 0.5) * 2;
            const dz = nearEnemy.z - p.z + (Math.random() - 0.5) * 2;
            hostHandle(id, { t: 'throw', dx, dz });
            p.botTargetX = 0; p.botTargetZ = 0;
        } else if (!p.hasBall && nearBall && nearBallDist < 15) {
            // Go pick up nearest ball
            const dx = nearBall.x - p.x, dz = nearBall.z - p.z;
            const len = Math.hypot(dx, dz);
            p.botTargetX = dx / len; p.botTargetZ = dz / len;
            // Try to grab if close
            if (nearBallDist < 1.5) {
                hostHandle(id, { t: 'grab', bid: nearBall.uid });
            }
        } else if (nearEnemy) {
            // Dodge / move around - move perpendicular to nearest enemy
            const dx = nearEnemy.x - p.x, dz = nearEnemy.z - p.z;
            const len = Math.hypot(dx, dz);
            // Strafe with some randomness
            const strafe = Math.random() > 0.5 ? 1 : -1;
            p.botTargetX = (-dz / len) * strafe + (Math.random() - 0.5) * 0.5;
            p.botTargetZ = (dx / len) * strafe + (Math.random() - 0.5) * 0.5;
        } else {
            p.botTargetX = (Math.random() - 0.5); p.botTargetZ = (Math.random() - 0.5);
        }

        // Bot catch attempt: check incoming balls
        if (!p.catching && p.catchCd <= 0) {
            for (const [bid, b] of balls) {
                if (b.state !== 'flying' || b.thrower === id) continue;
                const dx = b.x - p.x, dz = b.z - p.z;
                const dist = Math.hypot(dx, dz);
                // If ball is close and heading toward the bot
                if (dist < 4) {
                    const dotApproach = -(b.vx * dx + b.vz * dz) / (dist * Math.hypot(b.vx, b.vz) + 0.01);
                    if (dotApproach > 0.5 && Math.random() < 0.3) {
                        p.catching = true;
                        p.catchTimer = CATCH_WINDOW;
                        p.catchCd = CATCH_CD;
                    }
                }
            }
        }
    }

    // Physics for all players
    for (const [id, p] of players) {
        if (!p.alive) continue;

        // Bot movement
        if (p.bot) {
            const tx = p.botTargetX || 0, tz = p.botTargetZ || 0;
            const len = Math.hypot(tx, tz);
            if (len > 0.1) {
                p.vx += (tx / len) * ACCEL * dt;
                p.vz += (tz / len) * ACCEL * dt;
            }
        }

        // Friction
        const speed = Math.hypot(p.vx, p.vz);
        if (speed > MOVE_SPEED) { p.vx *= MOVE_SPEED / speed; p.vz *= MOVE_SPEED / speed; }
        if (speed > 0.1) {
            const fric = FRICTION * dt;
            const newSpd = Math.max(0, speed - fric);
            p.vx *= newSpd / speed; p.vz *= newSpd / speed;
        }

        // Move
        p.x += p.vx * dt;
        p.z += p.vz * dt;

        // Clamp to arena
        const hw = ARENA_W / 2 - PLAYER_R;
        const hd = ARENA_D / 2 - PLAYER_R;
        p.x = clamp(p.x, -hw, hw);
        p.z = clamp(p.z, -hd, hd);

        // Update heading
        if (Math.hypot(p.vx, p.vz) > 0.5) p.h = Math.atan2(p.vx, p.vz);

        // Catch timer
        if (p.catching) {
            p.catchTimer -= dt;
            if (p.catchTimer <= 0) p.catching = false;
        }
        if (p.catchCd > 0) p.catchCd -= dt;
    }

    // Player-player collision
    const alivePlayers = [...players.values()].filter(p => p.alive);
    for (let i = 0; i < alivePlayers.length; i++) {
        for (let j = i + 1; j < alivePlayers.length; j++) {
            const a = alivePlayers[i], b = alivePlayers[j];
            const dx = b.x - a.x, dz = b.z - a.z;
            const dist = Math.hypot(dx, dz);
            if (dist < PLAYER_R * 2 && dist > 0.01) {
                const nx = dx / dist, nz = dz / dist;
                const overlap = PLAYER_R * 2 - dist;
                a.x -= nx * overlap * 0.5;
                a.z -= nz * overlap * 0.5;
                b.x += nx * overlap * 0.5;
                b.z += nz * overlap * 0.5;
            }
        }
    }

    // Ball physics
    for (const [bid, b] of balls) {
        if (b.state === 'held') continue;
        if (b.state === 'flying') {
            b.flyTime += dt;
            b.vy -= BALL_GRAVITY * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.z += b.vz * dt;

            // Wall bouncing
            const bHW = ARENA_W / 2 - BALL_R;
            const bHD = ARENA_D / 2 - BALL_R;
            if (b.x < -bHW) { b.x = -bHW; b.vx = Math.abs(b.vx) * BALL_BOUNCE; sfx.bounce(); }
            if (b.x > bHW) { b.x = bHW; b.vx = -Math.abs(b.vx) * BALL_BOUNCE; sfx.bounce(); }
            if (b.z < -bHD) { b.z = -bHD; b.vz = Math.abs(b.vz) * BALL_BOUNCE; sfx.bounce(); }
            if (b.z > bHD) { b.z = bHD; b.vz = -Math.abs(b.vz) * BALL_BOUNCE; sfx.bounce(); }

            // Floor bounce
            if (b.y < BALL_R) {
                b.y = BALL_R;
                b.vy = Math.abs(b.vy) * BALL_BOUNCE;
                b.vx *= BALL_FLOOR_FRICTION;
                b.vz *= BALL_FLOOR_FRICTION;
                if (Math.abs(b.vy) < 0.5) {
                    // Ball has come to rest
                    b.state = 'ground';
                    b.y = BALL_R;
                    b.vx = 0; b.vy = 0; b.vz = 0;
                    b.thrower = null;
                    emit({ t: 'ballRest', bid });
                }
            }

            // Hit detection against players
            if (b.flyTime > 0.1) {
                for (const [pid, p] of players) {
                    if (!p.alive || pid === b.thrower) continue;
                    const dx = p.x - b.x, dz = p.z - b.z;
                    const dy = (PLAYER_H * 0.5) - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < HIT_R + BALL_R) {
                        if (p.catching) {
                            // Successful catch!
                            p.catching = false;
                            p.hasBall = bid;
                            b.state = 'held';
                            b.holder = pid;
                            b.vx = 0; b.vy = 0; b.vz = 0;
                            // Eliminate the thrower
                            const thrower = players.get(b.thrower);
                            if (thrower && thrower.alive) {
                                thrower.alive = false;
                                emit({ t: 'caught', catcher: pid, thrower: b.thrower, bid });
                                sfx.catch();
                            }
                            b.thrower = null;
                        } else {
                            // Hit - eliminate the player
                            p.alive = false;
                            const throwerId = b.thrower;
                            b.state = 'ground';
                            b.y = BALL_R;
                            b.vx = 0; b.vy = 0; b.vz = 0;
                            b.thrower = null;
                            emit({ t: 'hitPlayer', bid, pid, thrower: throwerId });
                            sfx.hit();
                        }
                        break;
                    }
                }
            }

            // Ball lifetime - if flying too long, drop to ground
            if (b.flyTime > BALL_LIFETIME) {
                b.state = 'ground';
                b.y = BALL_R;
                b.vx = 0; b.vy = 0; b.vz = 0;
                b.thrower = null;
                emit({ t: 'ballRest', bid });
            }
        }
    }

    // Broadcast positions
    sendTimer -= dt;
    if (sendTimer <= 0) {
        sendTimer = SEND_EVERY;
        const states = [];
        for (const [id, p] of players) {
            states.push([id, p.x, p.z, p.h, p.alive ? 1 : 0, p.hasBall || 0, p.catching ? 1 : 0]);
        }
        const ballStates = [];
        for (const [bid, b] of balls) {
            ballStates.push([bid, b.state === 'held' ? 1 : b.state === 'flying' ? 2 : 0, b.x, b.y, b.z, b.vx || 0, b.vy || 0, b.vz || 0, b.holder || 0, b.thrower || 0]);
        }
        emit({ t: 'sts', a: states, b: ballStates });
    }

    // Check round end
    const aliveCount = [...players.values()].filter(p => p.alive).length;
    if (aliveCount <= 1) {
        let winner = null;
        if (aliveCount === 1) {
            winner = [...players.entries()].find(([, p]) => p.alive);
        }
        if (winner) {
            const hp = H.players.find(p => p.id === winner[0]);
            if (hp) hp.wins++;
        }
        gameActive = false;
        const winnerId = winner ? winner[0] : null;
        const winnerName = winner ? H.players.find(p => p.id === winner[0])?.name : 'Nobody';
        emit({ t: 'roundEnd', winner: winnerId, winnerName, scores: H.players.map(p => ({ id: p.id, name: p.name, wins: p.wins, color: p.color })) });
        sfx.win();

        // Check match end
        const matchWinner = H.players.find(p => p.wins >= Math.ceil(BEST_OF / 2));
        if (matchWinner || H.round >= BEST_OF) {
            setTimeout(() => {
                const sorted = [...H.players].sort((a, b) => b.wins - a.wins);
                emit({ t: 'results', list: sorted.map((p, i) => ({ id: p.id, name: p.name, wins: p.wins, place: i + 1, color: p.color })) });
            }, 4000);
        } else {
            setTimeout(() => hostNextRound(), 4000);
        }
    }
}

// ============================================================
// Client logic
// ============================================================
function clientHandle(msg) {
    switch (msg.t) {
        case 'welcome': myId = msg.you; roomCode = msg.code; break;
        case 'reject': leave(msg.reason); return;
        case 'lobby': renderLobby(msg.players); break;
        case 'toast': toast(msg.text); break;
        case 'gameStart':
            view = 'game';
            show('hud');
            buildArena();
            playMusic('game');
            break;
        case 'roundStart': {
            gameActive = false;
            players.clear();
            balls.clear();
            // Remove old models
            const toRemove = scene.children.filter(c => c._isPlayer || c._isBall || c._isLabel || c._isParticle);
            toRemove.forEach(c => scene.remove(c));

            for (const s of msg.spawns) {
                const model = buildPlayerModel(s.color, s.name);
                model.position.set(s.x, 0, s.z);
                scene.add(model);
                const p = {
                    x: s.x, z: s.z, vx: 0, vz: 0, h: 0,
                    alive: true, hasBall: null,
                    catching: false, catchTimer: 0, catchCd: 0,
                    model, bot: s.bot, wins: s.wins, name: s.name, color: s.color,
                    _id: s.id, elimAnim: 0,
                    botThinkT: 0, botTargetX: 0, botTargetZ: 0,
                };
                players.set(s.id, p);
                if (s.id === myId) me = p;
            }

            // Spawn balls on center line
            for (const bs of msg.balls) {
                const bModel = buildBallModel();
                bModel.position.set(bs.x, BALL_R, bs.z);
                scene.add(bModel);
                const trail = createTrail();
                trail.line._isBall = true;
                scene.add(trail.line);
                balls.set(bs.uid, {
                    uid: bs.uid, state: 'ground',
                    x: bs.x, y: BALL_R, z: bs.z,
                    vx: 0, vy: 0, vz: 0,
                    holder: null, thrower: null, flyTime: 0,
                    model: bModel, trail,
                });
            }

            $('round-num').textContent = `${msg.round}/${BEST_OF}`;
            updateScoreRow(msg.spawns.map(s => ({ id: s.id, name: s.name, wins: s.wins, color: s.color })));
            showCenterMsg('3', true);
            sfx.count();
            setTimeout(() => { showCenterMsg('2', true); sfx.count(); }, 1000);
            setTimeout(() => { showCenterMsg('1', true); sfx.count(); }, 2000);
            setTimeout(() => { showCenterMsg('GO!', true); }, 3000);
            break;
        }
        case 'go': gameActive = true; break;
        case 'sts': {
            if (role === 'host') break;
            for (const s of msg.a) {
                const p = players.get(s[0]);
                if (!p || s[0] === myId) continue;
                p.x = s[1]; p.z = s[2]; p.h = s[3]; p.alive = !!s[4];
                p.hasBall = s[5] || null; p.catching = !!s[6];
            }
            // Update ball states
            if (msg.b) {
                for (const bs of msg.b) {
                    const b = balls.get(bs[0]);
                    if (!b) continue;
                    const stateMap = ['ground', 'held', 'flying'];
                    b.state = stateMap[bs[1]] || 'ground';
                    b.x = bs[2]; b.y = bs[3]; b.z = bs[4];
                    b.vx = bs[5]; b.vy = bs[6]; b.vz = bs[7];
                    b.holder = bs[8] || null; b.thrower = bs[9] || null;
                }
            }
            break;
        }
        case 'grabbed': {
            const b = balls.get(msg.bid);
            const p = players.get(msg.pid);
            if (b) { b.state = 'held'; b.holder = msg.pid; }
            if (p) p.hasBall = msg.bid;
            break;
        }
        case 'thrown': {
            const b = balls.get(msg.bid);
            const p = players.get(msg.pid);
            if (b) {
                b.state = 'flying'; b.holder = null; b.thrower = msg.pid;
                b.x = msg.x; b.y = msg.y; b.z = msg.z;
                b.vx = msg.vx; b.vy = msg.vy; b.vz = msg.vz;
                b.flyTime = 0;
                // Reset trail
                b.trail.count = 0; b.trail.idx = 0;
            }
            if (p) p.hasBall = null;
            sfx.throw();
            break;
        }
        case 'hitPlayer': {
            const p = players.get(msg.pid);
            if (p) {
                p.alive = false;
                p.elimAnim = 1;
                if (p.model) spawnParticles(p.model.position.x, PLAYER_H * 0.5, p.model.position.z, p.color, 25);
            }
            const b = balls.get(msg.bid);
            if (b) { b.state = 'ground'; b.vx = 0; b.vy = 0; b.vz = 0; b.thrower = null; }
            sfx.hit();
            sfx.eliminated();
            const pName = p ? p.name : '';
            if (msg.pid === myId) toast('You got hit!');
            else toast(`${pName} was eliminated!`);
            break;
        }
        case 'caught': {
            const catcher = players.get(msg.catcher);
            const thrower = players.get(msg.thrower);
            const b = balls.get(msg.bid);
            if (catcher) { catcher.hasBall = msg.bid; catcher.catching = false; }
            if (thrower) {
                thrower.alive = false;
                thrower.elimAnim = 1;
                if (thrower.model) spawnParticles(thrower.model.position.x, PLAYER_H * 0.5, thrower.model.position.z, thrower.color, 25);
            }
            if (b) { b.state = 'held'; b.holder = msg.catcher; b.thrower = null; }
            sfx.catch();
            const cn = catcher ? catcher.name : '', tn = thrower ? thrower.name : '';
            toast(`${cn} caught the ball! ${tn} is out!`);
            break;
        }
        case 'ballRest': {
            const b = balls.get(msg.bid);
            if (b) { b.state = 'ground'; b.vx = 0; b.vy = 0; b.vz = 0; b.thrower = null; }
            break;
        }
        case 'roundEnd': {
            gameActive = false;
            showCenterMsg(msg.winnerName + ' wins!', true);
            updateScoreRow(msg.scores);
            sfx.win();
            break;
        }
        case 'results': showResults(msg.list); break;
        case 'toLobby':
            view = 'lobby';
            show('lobby');
            removeArena();
            players.clear();
            balls.clear();
            playMusic('menu');
            document.body.classList.remove('aiming');
            break;
    }
}

// ============================================================
// HUD helpers
// ============================================================
function updateScoreRow(scores) {
    const row = $('score-row');
    row.innerHTML = '';
    for (const s of scores) {
        const d = document.createElement('span');
        d.className = 'score-dot';
        d.innerHTML = `<i style="background:${s.color}"></i> ${s.wins}`;
        row.appendChild(d);
    }
}

// ============================================================
// Input
// ============================================================
const keys = {};
addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (view === 'game' && (e.code === 'KeyE' || e.code === 'Space')) wantCatch = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse
let mouseX = 0, mouseY = 0;
let isPointerLocked = false;

canvas.addEventListener('mousedown', e => {
    if (view !== 'game' || !gameActive) return;
    if (e.button === 0) wantThrow = true;  // Left click
    if (e.button === 2) wantCatch = true;  // Right click
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousemove', e => {
    if (view !== 'game') return;
    // Use movementX/Y for camera orbit when in game
    camYaw -= e.movementX * 0.003;
    camPitch = clamp(camPitch - e.movementY * 0.003, 0.1, 1.2);
});

canvas.addEventListener('click', () => {
    if (view === 'game' && !isPointerLocked) {
        canvas.requestPointerLock();
    }
});

document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
    document.body.classList.toggle('aiming', isPointerLocked && view === 'game');
});

// Touch controls
const JOY_R = 55;
const joyLeft = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const joyRight = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let isTouch = false;

function resetJoy(joy, elId) {
    joy.id = null; joy.x = joy.y = 0;
    $(elId).classList.remove('on');
    const knob = $(elId + '-knob');
    if (knob) knob.style.transform = '';
}

if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('touch');
    isTouch = true;
}

canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    isTouch = true;
    e.preventDefault();
    if (view !== 'game') return;

    const halfW = innerWidth / 2;
    if (e.clientX < halfW) {
        // Left joystick
        if (joyLeft.id !== null) return;
        joyLeft.id = e.pointerId; joyLeft.ox = e.clientX; joyLeft.oy = e.clientY;
        const j = $('joy-left'); j.style.left = `${joyLeft.ox}px`; j.style.top = `${joyLeft.oy}px`; j.classList.add('on');
    } else {
        // Right joystick
        if (joyRight.id !== null) return;
        joyRight.id = e.pointerId; joyRight.ox = e.clientX; joyRight.oy = e.clientY;
        const j = $('joy-right'); j.style.left = `${joyRight.ox}px`; j.style.top = `${joyRight.oy}px`; j.classList.add('on');
    }
});

canvas.addEventListener('pointermove', e => {
    let joy = null, elId = '';
    if (e.pointerId === joyLeft.id) { joy = joyLeft; elId = 'joy-left'; }
    else if (e.pointerId === joyRight.id) { joy = joyRight; elId = 'joy-right'; }
    if (!joy) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
    joy.x = dx / JOY_R; joy.y = dy / JOY_R;
    $(elId + '-knob').style.transform = `translate(${dx}px, ${dy}px)`;
});

const endJoy = e => {
    if (e.pointerId === joyLeft.id) resetJoy(joyLeft, 'joy-left');
    if (e.pointerId === joyRight.id) resetJoy(joyRight, 'joy-right');
};
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

$('touch-throw').addEventListener('pointerdown', e => { e.preventDefault(); wantThrow = true; });
$('touch-catch').addEventListener('pointerdown', e => { e.preventDefault(); wantCatch = true; });

function playerInput() {
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (isTouch && joyLeft.id !== null) {
        ix = joyLeft.x; iz = joyLeft.y;
    }
    return { ix, iz };
}

function getAimDirection() {
    if (isTouch && joyRight.id !== null) {
        const len = Math.hypot(joyRight.x, joyRight.y);
        if (len > 0.2) {
            // Convert joystick to world direction relative to camera
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
            return {
                dx: forward.x * (-joyRight.y) + right.x * joyRight.x,
                dz: forward.z * (-joyRight.y) + right.z * joyRight.x,
            };
        }
    }
    // For mouse/keyboard, aim is forward from camera's perspective
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
    return { dx: forward.x, dz: forward.z };
}

// ============================================================
// Game loop
// ============================================================
function updateGame(dt) {
    if (!gameActive) return;

    if (role === 'host') hostUpdate(dt);

    if (!me || !me.alive) { wantThrow = false; wantCatch = false; return; }

    const { ix, iz } = playerInput();
    const inputLen = Math.hypot(ix, iz);

    // Camera-relative movement
    if (inputLen > 0.15) {
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
        const moveX = (forward.x * (-iz) + right.x * ix);
        const moveZ = (forward.z * (-iz) + right.z * ix);
        const moveLen = Math.hypot(moveX, moveZ);
        if (moveLen > 0) {
            me.vx += (moveX / moveLen) * ACCEL * dt;
            me.vz += (moveZ / moveLen) * ACCEL * dt;
        }
    }

    // Throw
    if (wantThrow && me.hasBall) {
        const aim = getAimDirection();
        act({ t: 'throw', dx: aim.dx, dz: aim.dz });
        if (role !== 'host') {
            me.hasBall = null;
        }
    }
    wantThrow = false;

    // Catch
    if (wantCatch && !me.catching && me.catchCd <= 0) {
        act({ t: 'catch' });
        if (role !== 'host') {
            me.catching = true;
            me.catchTimer = CATCH_WINDOW;
            me.catchCd = CATCH_CD;
        }
    }
    wantCatch = false;

    // Grab: auto-grab nearest ball when close (and player has no ball)
    if (!me.hasBall && gameActive) {
        for (const [bid, b] of balls) {
            if (b.state !== 'ground') continue;
            if (Math.hypot(me.x - b.x, me.z - b.z) < 1.5) {
                act({ t: 'grab', bid });
                break;
            }
        }
    }

    // Client-side prediction for local player
    if (role !== 'host') {
        const speed = Math.hypot(me.vx, me.vz);
        if (speed > MOVE_SPEED) { me.vx *= MOVE_SPEED / speed; me.vz *= MOVE_SPEED / speed; }
        if (speed > 0.1) {
            const fric = FRICTION * dt;
            const newSpd = Math.max(0, speed - fric);
            me.vx *= newSpd / speed; me.vz *= newSpd / speed;
        }
        me.x += me.vx * dt;
        me.z += me.vz * dt;
        const hw = ARENA_W / 2 - PLAYER_R;
        const hd = ARENA_D / 2 - PLAYER_R;
        me.x = clamp(me.x, -hw, hw);
        me.z = clamp(me.z, -hd, hd);
        if (Math.hypot(me.vx, me.vz) > 0.5) me.h = Math.atan2(me.vx, me.vz);
        if (me.catching) { me.catchTimer -= dt; if (me.catchTimer <= 0) me.catching = false; }
        if (me.catchCd > 0) me.catchCd -= dt;

        // Client-side ball physics for smoothness
        for (const [bid, b] of balls) {
            if (b.state !== 'flying') continue;
            b.vy -= BALL_GRAVITY * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.z += b.vz * dt;
            if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy) * BALL_BOUNCE; b.vx *= BALL_FLOOR_FRICTION; b.vz *= BALL_FLOOR_FRICTION; }
            const bHW = ARENA_W / 2 - BALL_R;
            const bHD = ARENA_D / 2 - BALL_R;
            if (b.x < -bHW) { b.x = -bHW; b.vx = Math.abs(b.vx) * BALL_BOUNCE; }
            if (b.x > bHW) { b.x = bHW; b.vx = -Math.abs(b.vx) * BALL_BOUNCE; }
            if (b.z < -bHD) { b.z = -bHD; b.vz = Math.abs(b.vz) * BALL_BOUNCE; }
            if (b.z > bHD) { b.z = bHD; b.vz = -Math.abs(b.vz) * BALL_BOUNCE; }
        }
    }

    // Send position
    sendTimer -= dt;
    if (sendTimer <= 0 && role === 'client') {
        sendTimer = SEND_EVERY;
        act({ t: 'st', x: me.x, z: me.z, h: me.h });
    }
}

function render(dt) {
    // Update player models
    for (const [id, p] of players) {
        const m = p.model;
        if (!m) continue;
        if (p.alive) {
            // Smooth lerp to actual position
            m.position.x = lerp(m.position.x, p.x, Math.min(1, dt * 15));
            m.position.z = lerp(m.position.z, p.z, Math.min(1, dt * 15));
            m.position.y = 0;
            // Rotate to heading
            m.rotation.y = lerp(m.rotation.y, p.h, Math.min(1, dt * 10));
            // Catching visual: make body pulse green briefly
            if (p.catching && m._bodyMat) {
                m._bodyMat.emissive.setHex(0x00ff88);
                m._bodyMat.emissiveIntensity = 0.4;
            } else if (m._bodyMat) {
                m._bodyMat.emissive.setHex(0x000000);
                m._bodyMat.emissiveIntensity = 0;
            }
            // Bob animation when moving
            const speed = Math.hypot(p.vx || 0, p.vz || 0);
            if (speed > 1 && m._body) {
                m._body.position.y = PLAYER_H / 2 + Math.sin(performance.now() * 0.012) * 0.08;
            }
        } else {
            // Elimination animation: shrink and fade
            if (p.elimAnim > 0) {
                p.elimAnim -= dt * 2;
                const s = Math.max(0, p.elimAnim);
                m.scale.set(s, s, s);
                if (p.elimAnim <= 0) m.visible = false;
            }
        }
    }

    // Update ball models
    for (const [bid, b] of balls) {
        const m = b.model;
        if (!m) continue;

        if (b.state === 'held') {
            // Position ball at holder's hand
            const holder = players.get(b.holder);
            if (holder && holder.model) {
                const hm = holder.model;
                const offset = new THREE.Vector3(0.5, PLAYER_H * 0.6, 0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), holder.h || 0);
                m.position.set(hm.position.x + offset.x, offset.y, hm.position.z + offset.z);
            }
            m.visible = true;
            // No trail when held
        } else if (b.state === 'flying') {
            m.position.set(b.x, b.y, b.z);
            m.visible = true;
            // Update trail
            updateTrail(b.trail, b.x, b.y, b.z);
            // Ball spin
            if (m.children[0]) {
                m.children[0].rotation.x += dt * 15;
                m.children[0].rotation.z += dt * 10;
            }
            // Glow pulse
            if (m._glowMesh) {
                m._glowMesh.material.opacity = 0.1 + Math.sin(performance.now() * 0.008) * 0.08;
            }
        } else {
            // Ground
            m.position.set(b.x, b.y || BALL_R, b.z);
            m.visible = true;
            // Gentle hover on ground
            m.position.y = BALL_R + Math.sin(performance.now() * 0.003 + bid) * 0.05;
            if (m._glowMesh) {
                m._glowMesh.material.opacity = 0.05 + Math.sin(performance.now() * 0.004) * 0.03;
            }
        }
    }

    // Update particles
    updateParticles(dt);

    // Camera
    if (me && me.alive) {
        // Third-person follow camera
        const camOffsetX = Math.sin(camYaw) * CAM_DIST * Math.cos(camPitch);
        const camOffsetZ = Math.cos(camYaw) * CAM_DIST * Math.cos(camPitch);
        const camOffsetY = CAM_HEIGHT * Math.sin(camPitch) + 3;

        const targetPos = new THREE.Vector3(
            me.model.position.x + camOffsetX,
            camOffsetY,
            me.model.position.z + camOffsetZ
        );
        const targetLook = new THREE.Vector3(me.model.position.x, PLAYER_H * 0.5, me.model.position.z);

        // Smooth camera follow
        camPos.lerp(targetPos, Math.min(1, dt * 6));
        camTarget.lerp(targetLook, Math.min(1, dt * 8));
    } else {
        // Overview camera when dead or spectating
        const t = performance.now() * 0.0003;
        const overviewPos = new THREE.Vector3(Math.sin(t) * 20, 25, Math.cos(t) * 20);
        const overviewLook = new THREE.Vector3(0, 0, 0);
        camPos.lerp(overviewPos, Math.min(1, dt * 2));
        camTarget.lerp(overviewLook, Math.min(1, dt * 2));
    }

    camera.position.copy(camPos);
    camera.lookAt(camTarget);

    // HUD
    const aliveCount = [...players.values()].filter(p => p.alive).length;
    $('alive-count').textContent = `${aliveCount} alive`;

    // Ball indicator
    if (me && me.alive) {
        if (me.hasBall) {
            $('ball-icon').textContent = '1';
            $('ball-label').textContent = 'Ready to throw!';
            $('ball-icon').style.color = '#f97316';
        } else {
            $('ball-icon').textContent = '0';
            $('ball-label').textContent = 'No ball';
            $('ball-icon').style.color = '';
        }
        // Catch cooldown ring
        const cdFrac = me.catchCd > 0 ? me.catchCd / CATCH_CD : 0;
        $('catch-ring').style.strokeDashoffset = (cdFrac * 138.2).toFixed(1);
    }

    renderer.render(scene, camera);
}

// ============================================================
// Lobby UI
// ============================================================
function renderLobby(plist) {
    $('room-code').textContent = roomCode;
    $('count').textContent = `${plist.length}/${MAX_PLAYERS}`;
    const list = $('players');
    list.innerHTML = '';
    for (const p of plist) {
        const li = document.createElement('li');
        li.className = 'player' + (p.id === myId ? ' me' : '');
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span>${p.id === myId ? '<span class="badge host">You</span>' : ''}${p.ready ? '<span class="badge ok">Ready</span>' : ''}${role === 'host' && p.id !== myId && H.phase === 'lobby' ? `<button class="kick" type="button" data-kick="${esc(p.id)}">Remove</button>` : ''}`;
        list.appendChild(li);
    }
}

// ============================================================
// Results
// ============================================================
function showResults(list) {
    track('match_end');
    view = 'results';
    show('results');
    removeArena();
    players.clear();
    balls.clear();
    playMusic('results');
    sfx.win();
    document.body.classList.remove('aiming');
    if (document.pointerLockElement) document.exitPointerLock();
    const ol = $('results-list');
    ol.innerHTML = '';
    for (const p of list) {
        const li = document.createElement('li');
        li.className = p.id === myId ? 'me' : '';
        li.innerHTML = `<span class="place">${p.place}</span><span class="dot" style="background:${p.color}"></span><span class="who"><b>${esc(p.name)}</b></span><span class="score">${p.wins} wins</span>`;
        ol.appendChild(li);
    }
    $('results-title').textContent = list[0]?.id === myId ? 'You Win!' : 'Game Over';
}

// ============================================================
// Room management
// ============================================================
async function createRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dodgeballName', myName); } catch {}
    setStatus('menu-status', 'Creating room...');
    roomCode = makeCode();
    role = 'host';
    document.body.classList.add('is-host');
    const hn = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
    try { await hn.open(roomCode); } catch (e) {
        if (e.message === 'code-taken') { roomCode = makeCode(); return createRoom(); }
        setStatus('menu-status', e.message, true); role = null; document.body.classList.remove('is-host'); return;
    }
    net = hn;
    myId = (hn.peer && hn.peer.id) || 'host_' + Math.random().toString(36).slice(2, 8);
    H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    track('room_create');
    enterLobby();
}

async function joinRoom() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dodgeballName', myName); } catch {}
    const code = $('code').value.trim().toUpperCase();
    if (!code) { setStatus('menu-status', 'Enter a room code.', true); return; }
    setStatus('menu-status', 'Joining...');
    role = 'client'; document.body.classList.remove('is-host');
    const cn = new ClientNet({ onMessage: clientHandle, onClose: () => leave('Lost connection.'), onStatus: msg => setStatus('menu-status', msg), forceRelay: new URLSearchParams(location.search).get('net') === 'relay' });
    try { myId = await cn.connect(code); } catch (e) { setStatus('menu-status', e.message, true); role = null; return; }
    net = cn; roomCode = code;
    cn.send({ t: 'hello', name: myName });
    track('room_join');
    enterLobby();
}

function startSolo() {
    unlockAudio();
    myName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('dodgeballName', myName); } catch {}
    role = 'host'; document.body.classList.add('is-host');
    myId = 'solo_' + Math.random().toString(36).slice(2, 8);
    roomCode = '-----'; H.players = []; H.phase = 'lobby';
    hostHandle(myId, { t: 'hello', name: myName });
    for (let i = 0; i < 3; i++) addBot();
    track('play_solo');
    enterLobby();
}

function enterLobby() { view = 'lobby'; show('lobby'); playMusic('menu'); setStatus('menu-status', ''); }
function leave(reason) {
    const n = net; net = null; if (n) n.close();
    role = null; myId = null; roomCode = ''; gameActive = false;
    H.players = []; H.phase = 'lobby';
    removeArena(); players.clear(); balls.clear(); me = null;
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
    document.body.classList.remove('aiming');
    if (document.pointerLockElement) document.exitPointerLock();
}

// ============================================================
// Event listeners
// ============================================================
$('players').addEventListener('click', e => {
    const id = e.target && e.target.dataset ? e.target.dataset.kick : null;
    if (!id) return;
    const p = H.players.find(x => x.id === id);
    if (p && (p.bot || confirm(`Remove ${p.name} from the room?`))) kickPlayer(id);
});
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('code').value ? joinRoom() : createRoom()); });
$('btn-exit').addEventListener('click', () => {
    if (view === 'menu') location.href = '../';
    else if (confirm(role === 'host' ? 'Leave and close this room?' : 'Leave this room?')) leave();
});
$('btn-copy').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => addBot());
$('btn-ready').addEventListener('click', () => { act({ t: 'ready', r: true }); });
$('btn-start').addEventListener('click', () => hostStartGame());
$('btn-again').addEventListener('click', () => {
    H.phase = 'lobby';
    for (const p of H.players) { p.ready = p.bot; p.wins = 0; }
    emitLobby();
    emit({ t: 'toLobby' });
});

function syncMute() { $('icon-sound').classList.toggle('hidden', isMuted()); $('icon-muted').classList.toggle('hidden', !isMuted()); }
syncMute();
$('btn-mute').addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); syncMute(); });

// ============================================================
// Main loop
// ============================================================
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (view === 'game' || gameActive) { updateGame(dt); render(dt); }
    else { renderer.render(scene, camera); }
    requestAnimationFrame(frame);
}

$('name').value = myName;
const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (invite) { $('code').value = invite; $('invite').textContent = `Invited to room ${invite}.`; $('invite').classList.remove('hidden'); }

show('menu');
playMusic('menu');
requestAnimationFrame(frame);
