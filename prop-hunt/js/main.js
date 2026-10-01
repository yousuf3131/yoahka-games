// Prop Hunt — 3D first-person hide-and-seek
import * as THREE from 'three';
import { HostNet, ClientNet, makeCode } from './net.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';
import { play as playMusic, stop as stopMusic } from './music.js';

const track = (name, p) => { if (window.track) window.track(name, p); };
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
};

// ── Constants ─────────────────────────────────────────────────────────────
const MAX_PLAYERS    = 8;
const MOVE_SPEED     = 5.0;
const HIDER_SPEED    = 3.0; // 60% of seeker speed
const ACCEL          = 16;
const FRICTION       = 12;
const PLAYER_R       = 0.35;
const PLAYER_HEIGHT  = 1.7;
const SEND_EVERY     = 0.05;
const HIDE_TIME      = 20;
const SEEK_TIME      = 90;
const ROUNDS_TOTAL   = 3;
const SHOOT_COOLDOWN = 0.35;
const SEEKER_HP      = 100;
const PROP_HIT_DMG   = 10;
const ROOM_W         = 20;
const ROOM_H         = 20;
const WALL_H         = 4;

const COLORS = ['#e0584f','#3b82f6','#2ec495','#f2c14e','#a78bfa','#f97316','#ec4899','#e2e8f0'];
const BOT_NAMES = ['Barrel Bob','Chair Carl','Lamp Larry','Vase Val','Box Bart','Bucket Ben','Crate Craig','Shadow'];

// ── Prop Definitions ──────────────────────────────────────────────────────
const PROP_DEFS = [
    { name: 'Barrel', icon: '\u{1F6E2}', color: 0x8B5E3C, createGeom: () => new THREE.CylinderGeometry(0.38, 0.42, 0.85, 16), oy: 0.425 },
    { name: 'Crate',  icon: '\u{1F4E6}', color: 0xA0784C, createGeom: () => new THREE.BoxGeometry(0.7, 0.7, 0.7), oy: 0.35 },
    { name: 'Chair',  icon: '\u{1FA91}', color: 0x5C3A1E, createGeom: () => new THREE.BoxGeometry(0.45, 0.45, 0.45), oy: 0.225, buildGroup: true },
    { name: 'Lamp',   icon: '\u{1F4A1}', color: 0xF5E6B8, createGeom: () => new THREE.CylinderGeometry(0.12, 0.28, 1.2, 12), oy: 0.6 },
    { name: 'Vase',   icon: '\u{1F3FA}', color: 0x4A90D9, createGeom: () => {
        const pts = [new THREE.Vector2(0,0), new THREE.Vector2(0.25,0), new THREE.Vector2(0.3,0.15),
            new THREE.Vector2(0.2,0.5), new THREE.Vector2(0.15,0.6), new THREE.Vector2(0.22,0.75),
            new THREE.Vector2(0.18,0.85), new THREE.Vector2(0.12,0.9), new THREE.Vector2(0,0.9)];
        return new THREE.LatheGeometry(pts, 16);
    }, oy: 0 },
    { name: 'Bucket', icon: '\u{1FAA3}', color: 0x888888, createGeom: () => new THREE.CylinderGeometry(0.28, 0.35, 0.5, 14), oy: 0.25 },
];

// ── State ─────────────────────────────────────────────────────────────────
let myName = (() => { try { return localStorage.getItem('prophuntName') || ''; } catch { return ''; } })();
let role = null, net = null, myId = null, roomCode = '', view = 'menu';
let gameActive = false, sendTimer = 0;
let phase = 'lobby'; // lobby, hiding, seeking, roundEnd, matchEnd
let myTeam = 'hider'; // hider or seeker
let myPropIdx = 0;
let myLocked = false;
let myHP = SEEKER_HP;
let shootCooldown = 0;
let phaseTimer = 0;
let hidersAlive = 0;

const players = new Map(); // id -> { x, z, yaw, pitch, team, propIdx, alive, locked, hp, name, color, bot, mesh, targetX, targetZ, targetYaw }
let me = null;

// Match state
let currentRound = 1;
let seekerScore = 0;
let hiderScore = 0;

// Host state
const H = {
    players: [],
    phase: 'lobby',
    phaseTimer: 0,
    round: 1,
    seekerScore: 0,
    hiderScore: 0,
    staticProps: [],     // positions of real props in the scene
    eliminatedHiders: new Set(),
};

// Input
let vx = 0, vz = 0;
let keys = {};
let mouseDx = 0, mouseDy = 0;
let lastStepT = 0;

// ── Three.js Scene ────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let flashlight = null;
let flashCone = null;
const playerMeshes = new Map();
const staticPropMeshes = [];
const staticPropIds = new Set();
let particles = [];

function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0810);
    scene.fog = new THREE.FogExp2(0x0a0810, 0.04);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, PLAYER_HEIGHT, 0);

    clock = new THREE.Clock();

    // Lighting
    const ambient = new THREE.AmbientLight(0x404060, 0.3);
    scene.add(ambient);

    // Directional light (main shadow caster)
    const dirLight = new THREE.DirectionalLight(0xffeedd, 0.4);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -12;
    dirLight.shadow.camera.right = 12;
    dirLight.shadow.camera.top = 12;
    dirLight.shadow.camera.bottom = -12;
    dirLight.shadow.bias = -0.002;
    scene.add(dirLight);

    // Point lights in corners for atmosphere
    const cornerPositions = [
        [-ROOM_W/2 + 1, WALL_H - 0.5, -ROOM_H/2 + 1],
        [ROOM_W/2 - 1, WALL_H - 0.5, -ROOM_H/2 + 1],
        [-ROOM_W/2 + 1, WALL_H - 0.5, ROOM_H/2 - 1],
        [ROOM_W/2 - 1, WALL_H - 0.5, ROOM_H/2 - 1],
    ];
    for (const [px, py, pz] of cornerPositions) {
        const pl = new THREE.PointLight(0xffcc88, 0.6, 14, 1.5);
        pl.position.set(px, py, pz);
        pl.castShadow = false;
        scene.add(pl);

        // Small light bulb mesh
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffcc88 })
        );
        bulb.position.set(px, py, pz);
        scene.add(bulb);
    }

    buildRoom();

    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });
}

function buildRoom() {
    // Floor
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a44, roughness: 0.85, metalness: 0.1,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x2a2530, roughness: 0.9, metalness: 0.05,
    });
    const wallGeo = new THREE.PlaneGeometry(ROOM_W, WALL_H);
    const walls = [
        { pos: [0, WALL_H / 2, -ROOM_H / 2], rot: [0, 0, 0] },
        { pos: [0, WALL_H / 2, ROOM_H / 2], rot: [0, Math.PI, 0] },
        { pos: [-ROOM_W / 2, WALL_H / 2, 0], rot: [0, Math.PI / 2, 0] },
        { pos: [ROOM_W / 2, WALL_H / 2, 0], rot: [0, -Math.PI / 2, 0] },
    ];
    for (const w of walls) {
        const wm = new THREE.Mesh(wallGeo, wallMat);
        wm.position.set(...w.pos);
        wm.rotation.set(...w.rot);
        wm.receiveShadow = true;
        scene.add(wm);
    }

    // Ceiling
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 1, metalness: 0 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    scene.add(ceil);

    // Furniture (shelves, tables)
    const furnitureMat = new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.7, metalness: 0.1 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8, metalness: 0.05 });

    // Tables
    const tableDefs = [
        { x: -5, z: -5, w: 2.5, d: 1, h: 0.8 },
        { x: 4, z: 6, w: 1.5, d: 2, h: 0.75 },
        { x: -7, z: 4, w: 1.8, d: 1.2, h: 0.85 },
        { x: 6, z: -6, w: 2, d: 1, h: 0.8 },
    ];
    for (const t of tableDefs) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.08, t.d), furnitureMat);
        top.position.set(t.x, t.h, t.z);
        top.castShadow = true; top.receiveShadow = true;
        scene.add(top);

        // Legs
        const legGeo = new THREE.CylinderGeometry(0.04, 0.04, t.h - 0.04, 6);
        for (const [lx, lz] of [[t.w/2 - 0.08, t.d/2 - 0.08], [-t.w/2 + 0.08, t.d/2 - 0.08],
                                  [t.w/2 - 0.08, -t.d/2 + 0.08], [-t.w/2 + 0.08, -t.d/2 + 0.08]]) {
            const leg = new THREE.Mesh(legGeo, furnitureMat);
            leg.position.set(t.x + lx, (t.h - 0.04) / 2, t.z + lz);
            leg.castShadow = true;
            scene.add(leg);
        }
    }

    // Shelving units against walls
    const shelfDefs = [
        { x: -ROOM_W/2 + 0.4, z: -3, w: 0.6, d: 2.5, h: 2.5, ry: 0 },
        { x: ROOM_W/2 - 0.4, z: 2, w: 0.6, d: 3, h: 2.2, ry: 0 },
        { x: 2, z: -ROOM_H/2 + 0.4, w: 3, d: 0.6, h: 2.8, ry: 0 },
        { x: -3, z: ROOM_H/2 - 0.4, w: 2.5, d: 0.6, h: 2, ry: 0 },
    ];
    for (const s of shelfDefs) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), shelfMat);
        shelf.position.set(s.x, s.h / 2, s.z);
        shelf.castShadow = true; shelf.receiveShadow = true;
        scene.add(shelf);
    }

    // Scattered real props (static - these are "real" props seekers should not shoot)
    placeStaticProps();
}

// ── Static props ──────────────────────────────────────────────────────────
const STATIC_PROP_POSITIONS = [
    // Barrels
    { type: 0, x: -7, z: -7 }, { type: 0, x: -6.5, z: -7.5 }, { type: 0, x: 8, z: -3 },
    { type: 0, x: 7, z: 7 }, { type: 0, x: -3, z: 8 },
    // Crates
    { type: 1, x: -8, z: 2 }, { type: 1, x: -8.5, z: 2.5 }, { type: 1, x: 5, z: -8 },
    { type: 1, x: 3, z: 5 }, { type: 1, x: -4, z: -3 },
    // Chairs
    { type: 2, x: -5, z: -4.5 }, { type: 2, x: 4.5, z: 6.5 }, { type: 2, x: -7.5, z: 4.5 },
    // Lamps
    { type: 3, x: -5, z: -5.5 }, { type: 3, x: 4, z: 5.5 }, { type: 3, x: 6.5, z: -6.5 },
    // Vases
    { type: 4, x: -8, z: -1 }, { type: 4, x: 7, z: 4 },
    // Buckets
    { type: 5, x: 2, z: -4 }, { type: 5, x: -2, z: 6 },
];

function placeStaticProps() {
    for (let i = 0; i < STATIC_PROP_POSITIONS.length; i++) {
        const sp = STATIC_PROP_POSITIONS[i];
        const def = PROP_DEFS[sp.type];
        const mesh = createPropMesh(sp.type);
        mesh.position.set(sp.x, def.oy, sp.z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        scene.add(mesh);
        staticPropMeshes.push(mesh);
        mesh.userData.staticPropIdx = i;
        mesh.userData.isStaticProp = true;
    }
}

function createPropMesh(typeIdx) {
    const def = PROP_DEFS[typeIdx];

    if (def.buildGroup && def.name === 'Chair') {
        // Build a chair from parts
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7, metalness: 0.1 });

        // Seat
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat);
        seat.position.y = 0.42;
        seat.castShadow = true;
        group.add(seat);

        // Back
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.04), mat);
        back.position.set(0, 0.67, -0.2);
        back.castShadow = true;
        group.add(back);

        // Legs
        const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
        for (const [lx, lz] of [[0.18, 0.18], [-0.18, 0.18], [0.18, -0.18], [-0.18, -0.18]]) {
            const leg = new THREE.Mesh(legGeo, mat);
            leg.position.set(lx, 0.21, lz);
            leg.castShadow = true;
            group.add(leg);
        }
        return group;
    }

    const geom = def.createGeom();
    const mat = new THREE.MeshStandardMaterial({
        color: def.color, roughness: 0.65, metalness: 0.15,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// ── Flashlight for seekers ────────────────────────────────────────────────
function createFlashlight() {
    if (flashlight) return;
    flashlight = new THREE.SpotLight(0xfff5e0, 2.5, 20, Math.PI / 6, 0.4, 1.2);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
    camera.add(flashlight);
    flashlight.position.set(0, -0.1, -0.3);
    flashlight.target.position.set(0, -0.1, -5);
    camera.add(flashlight.target);

    // Volumetric cone mesh
    const coneGeo = new THREE.ConeGeometry(3, 12, 16, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfff5e0, transparent: true, opacity: 0.03,
        side: THREE.DoubleSide, depthWrite: false,
    });
    flashCone = new THREE.Mesh(coneGeo, coneMat);
    flashCone.rotation.x = Math.PI / 2;
    flashCone.position.set(0, -0.1, -6.3);
    camera.add(flashCone);
}

function removeFlashlight() {
    if (flashlight) { camera.remove(flashlight); camera.remove(flashlight.target); flashlight = null; }
    if (flashCone) { camera.remove(flashCone); flashCone = null; }
}

// ── Player mesh management ────────────────────────────────────────────────
function getOrCreatePlayerMesh(id, p) {
    if (playerMeshes.has(id)) return playerMeshes.get(id);

    let mesh;
    if (p.team === 'hider') {
        mesh = createPropMesh(p.propIdx || 0);
    } else {
        // Seekers are capsule-shaped
        const geo = new THREE.CapsuleGeometry(0.25, 0.8, 8, 12);
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.6, metalness: 0.2 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
    }
    mesh.userData.playerId = id;
    scene.add(mesh);
    playerMeshes.set(id, mesh);
    return mesh;
}

function removePlayerMesh(id) {
    const m = playerMeshes.get(id);
    if (m) { scene.remove(m); playerMeshes.delete(id); }
}

function updatePlayerMeshProp(id, p) {
    removePlayerMesh(id);
    getOrCreatePlayerMesh(id, p);
}

// ── Particle effects ──────────────────────────────────────────────────────
function spawnHitParticles(pos, color, count = 12) {
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < count; i++) {
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(pos);
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3 + 1,
            (Math.random() - 0.5) * 4
        );
        scene.add(m);
        particles.push({ mesh: m, vel, life: 1.0 });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 2;
        p.vel.y -= 9.8 * dt;
        p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
        p.mesh.material.opacity = Math.max(0, p.life);
        p.mesh.material.transparent = true;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────
function show(id) {
    for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== 'hud');
}
function toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(() => d.remove(), 3500);
}
function setStatus(el, msg, err = false) { const s = $(el); s.textContent = msg; s.classList.toggle('error', err); }
function showCenter(text, duration = 2000) {
    const el = $('center-msg');
    el.textContent = text; el.classList.add('show');
    setTimeout(() => { if (el.textContent === text) el.classList.remove('show'); }, duration);
}
function showHitMarker() {
    const hm = $('hitmarker');
    hm.classList.add('show');
    setTimeout(() => hm.classList.remove('show'), 200);
}

// ── Networking helpers ────────────────────────────────────────────────────
function act(msg) { if (role === 'client') net.send(msg); else hostHandle(myId, msg); }
function emit(msg) { if (role === 'host' && net) net.broadcast(msg); clientHandle(msg); }

// ── Host logic ────────────────────────────────────────────────────────────
function hostHandle(from, msg) {
    switch (msg.t) {
        case 'hello': {
            if (H.players.some(p => p.id === from)) return;
            if (H.players.length >= MAX_PLAYERS) { if (net) net.send(from, { t: 'reject', reason: 'Room is full.' }); return; }
            if (H.phase !== 'lobby') { if (net) net.send(from, { t: 'reject', reason: 'Game in progress.' }); return; }
            const color = COLORS[H.players.length % COLORS.length];
            H.players.push({ id: from, name: msg.name || 'Player', color, ready: false, bot: false });
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
                p.targetX = msg.x; p.targetZ = msg.z; p.targetYaw = msg.yaw;
                if (msg.pi !== undefined) p.propIdx = msg.pi;
                if (msg.lk !== undefined) p.locked = !!msg.lk;
            }
            break;
        }
        case 'propChoice': {
            if (!gameActive || H.phase !== 'hiding') return;
            const p = players.get(from);
            if (p && p.team === 'hider') {
                p.propIdx = clamp(msg.idx, 0, PROP_DEFS.length - 1);
                emit({ t: 'propUpdate', id: from, idx: p.propIdx });
            }
            break;
        }
        case 'shoot': {
            if (!gameActive || H.phase !== 'seeking') return;
            const p = players.get(from);
            if (!p || p.team !== 'seeker' || !p.alive) return;
            // Check what was hit
            if (msg.hitPlayer) {
                const target = players.get(msg.hitPlayer);
                if (target && target.team === 'hider' && target.alive) {
                    target.alive = false;
                    H.eliminatedHiders.add(msg.hitPlayer);
                    emit({ t: 'eliminated', shooter: from, target: msg.hitPlayer });
                    hostCheckRoundEnd();
                }
            } else if (msg.hitStatic !== undefined) {
                // Hit a real prop - seeker loses HP
                p.hp = Math.max(0, (p.hp || SEEKER_HP) - PROP_HIT_DMG);
                emit({ t: 'damage', id: from, hp: p.hp });
                if (p.hp <= 0) {
                    p.alive = false;
                    emit({ t: 'seekerDown', id: from });
                    hostCheckRoundEnd();
                }
            }
            break;
        }
        case 'lock': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && p.team === 'hider') {
                p.locked = !!msg.v;
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
        removePlayerMesh(id);
        players.delete(id);
        if (gameActive) hostCheckRoundEnd();
    }
}

function emitLobby() {
    emit({ t: 'lobby', players: H.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot })) });
}

function kickPlayer(id) {
    const idx = H.players.findIndex(p => p.id === id);
    if (role !== 'host' || H.phase !== 'lobby' || idx < 0 || id === myId) return;
    const p = H.players[idx];
    if (p.bot) { H.players.splice(idx, 1); emitLobby(); return; }
    if (!net) return;
    net.send(id, { t: 'reject', reason: 'The host removed you.' });
    setTimeout(() => net && net.kick(id), 600);
    hostLeave(id);
}

function addBot() {
    if (H.players.length >= MAX_PLAYERS) return;
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const usedNames = new Set(H.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || 'Bot';
    H.players.push({ id: botId, name, color: COLORS[H.players.length % COLORS.length], ready: true, bot: true });
    emitLobby();
}

function hostStartGame() {
    if (H.players.length < 1) { setStatus('lobby-status', 'Need at least 1 player.', true); return; }
    const humans = H.players.filter(p => !p.bot);
    const notReady = humans.filter(p => p.id !== myId && !p.ready);
    if (notReady.length > 0) { setStatus('lobby-status', `${notReady[0].name} isn't ready.`, true); return; }

    H.round = 1;
    H.seekerScore = 0;
    H.hiderScore = 0;
    hostStartRound();
}

function hostStartRound() {
    H.phase = 'hiding';
    H.phaseTimer = HIDE_TIME + 3; // +3 for initial countdown
    H.eliminatedHiders = new Set();

    // Assign teams
    const n = H.players.length;
    const nHiders = Math.max(1, Math.floor(n / 2));
    // Shuffle for team assignment, alternate by round
    const shuffled = [...H.players].sort(() => Math.random() - 0.5);
    const hiderSet = new Set();
    for (let i = 0; i < nHiders; i++) hiderSet.add(shuffled[i].id);

    // Odd rounds: swap who was hider/seeker
    if (H.round % 2 === 0) {
        const temp = new Set(hiderSet);
        hiderSet.clear();
        for (const p of H.players) {
            if (!temp.has(p.id)) hiderSet.add(p.id);
        }
    }

    const spawns = H.players.map((p, i) => {
        const team = hiderSet.has(p.id) ? 'hider' : 'seeker';
        const angle = (i / n) * Math.PI * 2;
        const r = team === 'hider' ? 3 : 1;
        const sx = Math.cos(angle) * r;
        const sz = Math.sin(angle) * r;
        return {
            id: p.id, name: p.name, color: p.color, bot: p.bot,
            team, x: sx, z: sz, propIdx: Math.floor(Math.random() * PROP_DEFS.length),
        };
    });

    // Initialize HP for seekers
    for (const s of spawns) {
        if (s.team === 'seeker') s.hp = SEEKER_HP;
    }

    emit({
        t: 'roundStart',
        spawns,
        round: H.round,
        totalRounds: ROUNDS_TOTAL,
        seekerScore: H.seekerScore,
        hiderScore: H.hiderScore,
    });
}

function hostCheckRoundEnd() {
    // Count alive hiders and seekers
    const aliveHiders = [...players.values()].filter(p => p.team === 'hider' && p.alive);
    const aliveSeekers = [...players.values()].filter(p => p.team === 'seeker' && p.alive);

    if (aliveHiders.length === 0) {
        // Seekers win this round
        H.seekerScore++;
        hostEndRound('seekers');
    } else if (aliveSeekers.length === 0) {
        // Hiders win (all seekers eliminated by shooting real props)
        H.hiderScore++;
        hostEndRound('hiders');
    }
}

function hostEndRound(winner) {
    H.phase = 'roundEnd';
    gameActive = false;
    emit({
        t: 'roundEnd',
        winner,
        round: H.round,
        seekerScore: H.seekerScore,
        hiderScore: H.hiderScore,
    });

    if (H.round >= ROUNDS_TOTAL || H.seekerScore > ROUNDS_TOTAL / 2 || H.hiderScore > ROUNDS_TOTAL / 2) {
        // Match over
        const matchWinner = H.seekerScore > H.hiderScore ? 'seekers' : 'hiders';
        setTimeout(() => {
            emit({
                t: 'matchEnd',
                winner: matchWinner,
                seekerScore: H.seekerScore,
                hiderScore: H.hiderScore,
            });
        }, 3000);
    } else {
        // Next round after delay
        setTimeout(() => {
            H.round++;
            hostStartRound();
        }, 5000);
    }
}

function hostTimerUpdate(dt) {
    if (!gameActive || (H.phase !== 'hiding' && H.phase !== 'seeking')) return;

    H.phaseTimer -= dt;
    if (H.phaseTimer <= 0) {
        if (H.phase === 'hiding') {
            // Hiding time over - transition to seeking
            H.phase = 'seeking';
            H.phaseTimer = SEEK_TIME;
            emit({ t: 'seekPhase' });
        } else if (H.phase === 'seeking') {
            // Time ran out - hiders win
            H.hiderScore++;
            hostEndRound('hiders');
        }
        return;
    }

    // Broadcast timer
    emit({ t: 'timer', time: Math.max(0, Math.ceil(H.phaseTimer)), phase: H.phase });
}

// ── Bot AI ────────────────────────────────────────────────────────────────
function updateBots(dt) {
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        p.botTimer = (p.botTimer || 0) - dt;
        if (p.botTimer > 0) continue;

        if (p.team === 'hider') {
            botHiderAI(id, p, dt);
        } else {
            botSeekerAI(id, p, dt);
        }
    }
}

function botHiderAI(id, p, dt) {
    if (phase === 'hiding' && !p.locked) {
        // Move toward a good hiding spot near similar real props
        if (!p.botTarget) {
            // Find a static prop of same type
            const same = STATIC_PROP_POSITIONS.filter(sp => sp.type === p.propIdx);
            if (same.length > 0) {
                const target = same[Math.floor(Math.random() * same.length)];
                p.botTarget = { x: target.x + (Math.random() - 0.5) * 1.5, z: target.z + (Math.random() - 0.5) * 1.5 };
            } else {
                p.botTarget = { x: (Math.random() - 0.5) * (ROOM_W - 3), z: (Math.random() - 0.5) * (ROOM_H - 3) };
            }
        }
        const dx = p.botTarget.x - p.x;
        const dz = p.botTarget.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.5) {
            const step = HIDER_SPEED * dt;
            p.x += (dx / dist) * step;
            p.z += (dz / dist) * step;
            p.yaw = Math.atan2(dx, dz);
            constrainToRoom(p);
        } else {
            p.locked = true;
            act({ t: 'lock', v: true });
        }
        p.botTimer = 0.1;
    } else {
        p.botTimer = 1;
    }
}

function botSeekerAI(id, p, dt) {
    if (phase !== 'seeking') { p.botTimer = 0.5; return; }

    if (!p.botPatrol) {
        p.botPatrol = { x: (Math.random() - 0.5) * (ROOM_W - 3), z: (Math.random() - 0.5) * (ROOM_H - 3) };
        p.botShootTimer = 2 + Math.random() * 3;
    }

    const dx = p.botPatrol.x - p.x;
    const dz = p.botPatrol.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 1) {
        const step = MOVE_SPEED * dt;
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        p.yaw = Math.atan2(dx, dz);
        constrainToRoom(p);
    } else {
        p.botPatrol = { x: (Math.random() - 0.5) * (ROOM_W - 3), z: (Math.random() - 0.5) * (ROOM_H - 3) };
    }

    // Occasionally shoot at nearby props
    p.botShootTimer = (p.botShootTimer || 3) - dt;
    if (p.botShootTimer <= 0) {
        p.botShootTimer = 1.5 + Math.random() * 3;
        // Find closest alive hider
        let closest = null, closestDist = Infinity;
        for (const [hid, hp] of players) {
            if (hp.team === 'hider' && hp.alive) {
                const d = Math.hypot(hp.x - p.x, hp.z - p.z);
                if (d < closestDist && d < 8) { closestDist = d; closest = hid; }
            }
        }
        if (closest && Math.random() < 0.4) {
            // Shoot at the hider
            const target = players.get(closest);
            if (target) {
                hostHandle(id, { t: 'shoot', hitPlayer: closest });
            }
        } else if (Math.random() < 0.15) {
            // Accidentally shoot a real prop
            const idx = Math.floor(Math.random() * STATIC_PROP_POSITIONS.length);
            hostHandle(id, { t: 'shoot', hitStatic: idx });
        }
    }

    p.botTimer = 0.08;
}

function constrainToRoom(p) {
    const hw = ROOM_W / 2 - PLAYER_R;
    const hh = ROOM_H / 2 - PLAYER_R;
    p.x = clamp(p.x, -hw, hw);
    p.z = clamp(p.z, -hh, hh);
}

// ── Client logic ──────────────────────────────────────────────────────────
function clientHandle(msg) {
    switch (msg.t) {
        case 'reject': backToMenu(msg.reason); break;
        case 'welcome':
            myId = msg.you;
            roomCode = msg.code;
            $('room-code').textContent = msg.code;
            view = 'lobby'; show('lobby');
            break;
        case 'lobby':
            renderLobby(msg.players);
            break;
        case 'roundStart': {
            view = 'game'; show('hud');
            gameActive = true;
            phase = 'hiding';
            players.clear();
            clearPlayerMeshes();

            currentRound = msg.round;
            seekerScore = msg.seekerScore;
            hiderScore = msg.hiderScore;
            $('round-text').textContent = `${msg.round}/${msg.totalRounds}`;
            $('score-text').textContent = `${msg.hiderScore} - ${msg.seekerScore}`;

            for (const s of msg.spawns) {
                const p = {
                    x: s.x, z: s.z, yaw: 0, pitch: 0,
                    targetX: s.x, targetZ: s.z, targetYaw: 0,
                    team: s.team, propIdx: s.propIdx, alive: true, locked: false,
                    hp: s.hp || SEEKER_HP,
                    name: s.name, color: s.color, bot: s.bot || false,
                    botTimer: 0, botTarget: null, botPatrol: null, botShootTimer: 3,
                };
                players.set(s.id, p);
                if (s.id !== myId) {
                    getOrCreatePlayerMesh(s.id, p);
                }
            }

            me = players.get(myId);
            if (!me) break;
            myTeam = me.team;
            myPropIdx = me.propIdx;
            myLocked = false;
            myHP = SEEKER_HP;
            shootCooldown = 0;
            camera.position.set(me.x, PLAYER_HEIGHT, me.z);

            // Set up HUD for role
            setupHUDForRole();

            if (myTeam === 'seeker') {
                $('blindfold').classList.remove('hidden');
                removeFlashlight();
            } else {
                $('blindfold').classList.add('hidden');
                removeFlashlight();
                requestPointerLock();
            }

            showCenter(myTeam === 'hider' ? 'YOU ARE A HIDER' : 'YOU ARE A SEEKER', 2500);

            // Countdown
            let countdown = 3;
            const cdInt = setInterval(() => {
                countdown--;
                if (countdown > 0) {
                    sfx.count();
                } else {
                    clearInterval(cdInt);
                    sfx.go();
                    if (myTeam === 'hider') showCenter('HIDE!', 1500);
                }
            }, 1000);

            playMusic('hiding');
            break;
        }
        case 'seekPhase': {
            phase = 'seeking';
            $('blindfold').classList.add('hidden');
            $('prop-bar').classList.add('hidden');
            $('lock-btn-wrap').classList.add('hidden');
            $('phase-label').textContent = 'SEEKING PHASE';

            if (myTeam === 'seeker') {
                createFlashlight();
                $('crosshair').classList.remove('hidden');
                $('health-hud').classList.remove('hidden');
                requestPointerLock();
                showCenter('HUNT THEM DOWN!', 2000);
            } else {
                showCenter('STAY HIDDEN!', 2000);
            }

            playMusic('seeking');
            sfx.go();
            break;
        }
        case 'propUpdate': {
            const p = players.get(msg.id);
            if (p) {
                p.propIdx = msg.idx;
                if (msg.id !== myId) updatePlayerMeshProp(msg.id, p);
            }
            break;
        }
        case 'eliminated': {
            const target = players.get(msg.target);
            if (target) {
                target.alive = false;
                const mesh = playerMeshes.get(msg.target);
                if (mesh) {
                    spawnHitParticles(mesh.position.clone(), 0xff4444, 20);
                }
                removePlayerMesh(msg.target);
            }
            if (msg.target === myId) {
                showCenter('YOU WERE FOUND!', 3000);
                sfx.found();
                document.exitPointerLock && document.exitPointerLock();
            } else {
                const name = target ? target.name : 'Someone';
                toast(`${name} was found!`);
                sfx.hitPlayer();
            }
            updateHidersCount();
            break;
        }
        case 'damage': {
            const p = players.get(msg.id);
            if (p) p.hp = msg.hp;
            if (msg.id === myId) {
                myHP = msg.hp;
                updateHealthBar();
                sfx.hitProp();
                showCenter('-10 HP', 800);
            }
            break;
        }
        case 'seekerDown': {
            const p = players.get(msg.id);
            if (p) p.alive = false;
            if (msg.id === myId) {
                showCenter('YOU RAN OUT OF HEALTH!', 3000);
                document.exitPointerLock && document.exitPointerLock();
            } else {
                const name = p ? p.name : 'A seeker';
                toast(`${name} ran out of health!`);
            }
            break;
        }
        case 'timer': {
            phaseTimer = msg.time;
            const m = Math.floor(msg.time / 60);
            const s = msg.time % 60;
            $('timer-value').textContent = `${m}:${s.toString().padStart(2, '0')}`;
            $('timer-value').classList.toggle('urgent', msg.time <= 10);
            if (msg.phase === 'hiding' && myTeam === 'seeker') {
                $('blindfold-timer').textContent = msg.time;
            }
            if (msg.time <= 5 && msg.time > 0) sfx.count();
            break;
        }
        case 'roundEnd': {
            gameActive = false;
            phase = 'roundEnd';
            removeFlashlight();
            document.exitPointerLock && document.exitPointerLock();

            seekerScore = msg.seekerScore;
            hiderScore = msg.hiderScore;

            const winText = msg.winner === 'hiders' ? 'Hiders survive!' : 'Seekers found them all!';
            showCenter(winText, 3000);
            sfx.win();
            playMusic('results');
            break;
        }
        case 'matchEnd': {
            phase = 'matchEnd';
            view = 'results'; show('results');
            removeFlashlight();

            const isHiderWin = msg.winner === 'hiders';
            $('results-kicker').textContent = 'MATCH OVER';
            $('results-title').textContent = isHiderWin ? 'Hiders Win the Match!' : 'Seekers Win the Match!';

            // Build results list
            const list = $('results-list');
            list.innerHTML = '';
            for (const [id, p] of players) {
                const li = document.createElement('li');
                li.className = 'player' + (id === myId ? ' me' : '');
                li.innerHTML = `<span class="dot" style="background:${esc(p.color)}"></span>
                    <span class="who"><b>${esc(p.name)}</b></span>
                    <span class="badge">${esc(p.team)}</span>`;
                list.appendChild(li);
            }

            $('score-text').textContent = `${msg.hiderScore} - ${msg.seekerScore}`;
            sfx.win();
            track('match_end', { winner: msg.winner });
            break;
        }
    }
}

function setupHUDForRole() {
    const badge = $('role-badge');
    badge.textContent = myTeam === 'hider' ? 'HIDER' : 'SEEKER';
    badge.classList.toggle('seeker', myTeam === 'seeker');

    $('phase-label').textContent = 'HIDING PHASE';
    $('crosshair').classList.toggle('hidden', myTeam !== 'seeker' || phase !== 'seeking');
    $('health-hud').classList.toggle('hidden', myTeam !== 'seeker');
    $('hitmarker').classList.remove('show');

    if (myTeam === 'hider') {
        // Show prop selection
        $('prop-bar').classList.remove('hidden');
        $('lock-btn-wrap').classList.remove('hidden');
        buildPropButtons();
    } else {
        $('prop-bar').classList.add('hidden');
        $('lock-btn-wrap').classList.add('hidden');
    }

    updateHidersCount();
    updateHealthBar();

    // Touch action button
    if (myTeam === 'seeker') {
        $('touch-action').textContent = 'SHOOT';
    } else {
        $('touch-action').textContent = 'LOCK';
    }
}

function buildPropButtons() {
    const container = $('prop-buttons');
    container.innerHTML = '';
    PROP_DEFS.forEach((def, i) => {
        const btn = document.createElement('button');
        btn.className = 'prop-btn' + (i === myPropIdx ? ' active' : '');
        btn.innerHTML = `<span class="prop-icon">${def.icon}</span><span class="prop-key">${i + 1}</span>`;
        btn.addEventListener('click', () => selectProp(i));
        container.appendChild(btn);
    });
}

function selectProp(idx) {
    if (phase !== 'hiding' || myTeam !== 'hider') return;
    myPropIdx = idx;
    if (me) me.propIdx = idx;
    act({ t: 'propChoice', idx });
    sfx.propSelect();
    // Update button states
    const btns = $('prop-buttons').children;
    for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('active', i === idx);
}

function updateHidersCount() {
    const alive = [...players.values()].filter(p => p.team === 'hider' && p.alive).length;
    hidersAlive = alive;
    $('hiders-count').textContent = alive;
}

function updateHealthBar() {
    const pct = (myHP / SEEKER_HP) * 100;
    $('health-bar').style.width = pct + '%';
    $('health-bar').classList.toggle('low', pct <= 30);
    $('health-text').textContent = myHP;
}

function renderLobby(list) {
    const ul = $('players');
    ul.innerHTML = '';
    list.forEach(p => {
        const li = document.createElement('li');
        const isMe = p.id === myId;
        li.className = 'player' + (isMe ? ' me' : '');
        let badges = '';
        if (p.bot) badges += '<span class="badge">bot</span>';
        else if (p.id === (role === 'host' ? myId : list[0]?.id)) badges += '<span class="badge host">host</span>';
        else badges += p.ready ? '<span class="badge ok">ready</span>' : '<span class="badge">waiting</span>';
        let kick = '';
        if (role === 'host' && !isMe) kick = `<button class="kick" data-id="${esc(p.id)}">Kick</button>`;
        li.innerHTML = `<span class="dot" style="background:${esc(p.color)}"></span>
            <span class="who"><b>${esc(p.name)}</b></span>${badges}${kick}`;
        ul.appendChild(li);
    });
    $('count').textContent = `${list.length}/${MAX_PLAYERS}`;

    // Kick handlers
    for (const btn of ul.querySelectorAll('.kick')) {
        btn.addEventListener('click', () => kickPlayer(btn.dataset.id));
    }
}

function clearPlayerMeshes() {
    for (const [id] of playerMeshes) removePlayerMesh(id);
}

// ── Pointer Lock ──────────────────────────────────────────────────────────
function requestPointerLock() {
    if (document.body.classList.contains('touch')) return;
    $('lock-prompt').classList.remove('hidden');
}

document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === $('c') || document.pointerLockElement === document.body;
    const playing = gameActive && view === 'game' && me && me.alive;
    $('lock-prompt').classList.toggle('hidden', locked || !playing || document.body.classList.contains('touch'));
});
$('lock-prompt').addEventListener('click', () => {
    $('c').requestPointerLock();
});

// ── Input ─────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
    keys[e.code] = true;
    // Prop selection with number keys
    if (phase === 'hiding' && myTeam === 'hider') {
        const n = parseInt(e.key);
        if (n >= 1 && n <= PROP_DEFS.length) {
            selectProp(n - 1);
        }
    }
});
addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse look
addEventListener('mousemove', e => {
    if (!document.pointerLockElement) return;
    mouseDx += e.movementX;
    mouseDy += e.movementY;
});

// Shoot / Lock on click
addEventListener('mousedown', e => {
    if (e.button !== 0 || !document.pointerLockElement || !gameActive || !me || !me.alive) return;
    if (myTeam === 'seeker' && phase === 'seeking') {
        tryShoot();
    } else if (myTeam === 'hider') {
        toggleLock();
    }
});

// Scroll to change prop
addEventListener('wheel', e => {
    if (phase !== 'hiding' || myTeam !== 'hider') return;
    const dir = e.deltaY > 0 ? 1 : -1;
    let next = (myPropIdx + dir + PROP_DEFS.length) % PROP_DEFS.length;
    selectProp(next);
});

// ── Touch controls ────────────────────────────────────────────────────────
const JOY_R = 50;
const joyL = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let touchLookId = null, touchLookLast = { x: 0, y: 0 };

const cvs = $('c');
cvs.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    e.preventDefault();
    if (view !== 'game' || !gameActive) return;
    if (e.clientX < innerWidth / 2) {
        if (joyL.id !== null) return;
        joyL.id = e.pointerId; joyL.ox = e.clientX; joyL.oy = e.clientY;
        const j = $('joy-left'); j.style.left = `${e.clientX - 50}px`; j.style.top = `${e.clientY - 50}px`;
    } else {
        if (touchLookId !== null) return;
        touchLookId = e.pointerId;
        touchLookLast = { x: e.clientX, y: e.clientY };
    }
});
cvs.addEventListener('pointermove', e => {
    if (joyL.id === e.pointerId) {
        let dx = e.clientX - joyL.ox, dy = e.clientY - joyL.oy;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
        joyL.x = dx / JOY_R; joyL.y = dy / JOY_R;
        $('joy-left-knob').style.transform = `translate(${dx}px, ${dy}px)`;
    }
    if (touchLookId === e.pointerId) {
        mouseDx += (e.clientX - touchLookLast.x) * 1.5;
        mouseDy += (e.clientY - touchLookLast.y) * 1.5;
        touchLookLast = { x: e.clientX, y: e.clientY };
    }
});
const endTouch = e => {
    if (e.pointerId === joyL.id) { joyL.id = null; joyL.x = joyL.y = 0; $('joy-left-knob').style.transform = ''; }
    if (e.pointerId === touchLookId) { touchLookId = null; }
};
cvs.addEventListener('pointerup', endTouch);
cvs.addEventListener('pointercancel', endTouch);

$('touch-action').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!gameActive || !me || !me.alive) return;
    if (myTeam === 'seeker' && phase === 'seeking') tryShoot();
    else if (myTeam === 'hider') toggleLock();
});

// ── Shooting mechanic ─────────────────────────────────────────────────────
function tryShoot() {
    if (shootCooldown > 0 || !me || !me.alive || myTeam !== 'seeker') return;
    shootCooldown = SHOOT_COOLDOWN;
    sfx.shoot();

    // Raycast from camera center
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = 30;

    // Collect all shootable meshes
    const targets = [];

    // Player prop meshes (hiders)
    for (const [id, mesh] of playerMeshes) {
        const p = players.get(id);
        if (p && p.team === 'hider' && p.alive) {
            if (mesh.isGroup) {
                mesh.traverse(child => { if (child.isMesh) targets.push({ mesh: child, type: 'player', id }); });
            } else {
                targets.push({ mesh, type: 'player', id });
            }
        }
    }

    // Static prop meshes
    for (const m of staticPropMeshes) {
        if (m.isGroup) {
            m.traverse(child => { if (child.isMesh) targets.push({ mesh: child, type: 'static', idx: m.userData.staticPropIdx }); });
        } else {
            targets.push({ mesh: m, type: 'static', idx: m.userData.staticPropIdx });
        }
    }

    const meshes = targets.map(t => t.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
        const hit = hits[0];
        const hitMesh = hit.object;
        const target = targets.find(t => t.mesh === hitMesh);
        if (target) {
            if (target.type === 'player') {
                act({ t: 'shoot', hitPlayer: target.id });
                showHitMarker();
                spawnHitParticles(hit.point, 0xff4444, 15);
            } else {
                act({ t: 'shoot', hitStatic: target.idx });
                showHitMarker();
                spawnHitParticles(hit.point, 0x888888, 8);
                // Flash the static prop
                flashMesh(hitMesh);
            }
        }
    }
}

function flashMesh(mesh) {
    if (!mesh.material) return;
    const origColor = mesh.material.color.clone();
    mesh.material.emissive = new THREE.Color(0xff0000);
    mesh.material.emissiveIntensity = 0.5;
    setTimeout(() => {
        if (mesh.material) {
            mesh.material.emissive = new THREE.Color(0x000000);
            mesh.material.emissiveIntensity = 0;
        }
    }, 300);
}

function toggleLock() {
    if (!me || myTeam !== 'hider') return;
    myLocked = !myLocked;
    me.locked = myLocked;
    act({ t: 'lock', v: myLocked });
    const btn = $('btn-lock');
    btn.textContent = myLocked ? 'UNLOCK' : 'LOCK IN PLACE';
    btn.classList.toggle('locked', myLocked);
}

// ── Game loop ─────────────────────────────────────────────────────────────
let camYaw = 0, camPitch = 0;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (gameActive && me && me.alive) {
        // Camera look
        const sensitivity = 0.002;
        camYaw -= mouseDx * sensitivity;
        camPitch -= mouseDy * sensitivity;
        camPitch = clamp(camPitch, -Math.PI / 2.5, Math.PI / 2.5);
        mouseDx = 0;
        mouseDy = 0;

        // Movement
        const canMove = (myTeam === 'hider' && !myLocked) || myTeam === 'seeker';
        if (canMove) {
            let ix = 0, iz = 0;
            if (keys.KeyW || keys.ArrowUp || joyL.y < -0.1) iz -= 1;
            if (keys.KeyS || keys.ArrowDown || joyL.y > 0.1) iz += 1;
            if (keys.KeyA || keys.ArrowLeft || joyL.x < -0.1) ix -= 1;
            if (keys.KeyD || keys.ArrowRight || joyL.x > 0.1) ix += 1;

            // Touch joystick overrides
            if (joyL.id !== null) { ix = joyL.x; iz = joyL.y; }

            if (ix || iz) {
                const len = Math.hypot(ix, iz);
                ix /= len; iz /= len;

                // Rotate input by camera yaw
                const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
                const mx = ix * cosY + iz * sinY;
                const mz = -ix * sinY + iz * cosY;

                const speed = myTeam === 'hider' ? HIDER_SPEED : MOVE_SPEED;
                const targetVx = mx * speed;
                const targetVz = mz * speed;

                vx = lerp(vx, targetVx, 1 - Math.exp(-ACCEL * dt));
                vz = lerp(vz, targetVz, 1 - Math.exp(-ACCEL * dt));
            } else {
                vx = lerp(vx, 0, 1 - Math.exp(-FRICTION * dt));
                vz = lerp(vz, 0, 1 - Math.exp(-FRICTION * dt));
            }

            me.x += vx * dt;
            me.z += vz * dt;
            constrainToRoom(me);

            // Footstep sounds
            const speed = Math.hypot(vx, vz);
            if (speed > 0.5) {
                lastStepT += dt;
                if (lastStepT > 0.4) {
                    sfx.footstep();
                    lastStepT = 0;
                }
            } else {
                lastStepT = 0.3;
            }
        }

        // Update camera
        camera.position.set(me.x, myTeam === 'hider' ? PROP_DEFS[myPropIdx].oy + 0.3 : PLAYER_HEIGHT, me.z);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = camYaw;
        camera.rotation.x = camPitch;

        me.yaw = camYaw;

        // Send position
        sendTimer -= dt;
        if (sendTimer <= 0) {
            sendTimer = SEND_EVERY;
            act({ t: 'st', x: me.x, z: me.z, yaw: me.yaw, pi: myPropIdx, lk: myLocked });
        }

        // Shoot cooldown
        if (shootCooldown > 0) shootCooldown -= dt;
    }

    // Host updates
    if (role === 'host' && gameActive) {
        hostTimerUpdate(dt);
        updateBots(dt);
    }

    // Lerp other player meshes
    for (const [id, p] of players) {
        if (id === myId) continue;
        if (!p.alive) continue;

        // Smooth position interpolation
        p.x = lerp(p.x, p.targetX || p.x, 1 - Math.exp(-12 * dt));
        p.z = lerp(p.z, p.targetZ || p.z, 1 - Math.exp(-12 * dt));
        p.yaw = lerpAngle(p.yaw, p.targetYaw || p.yaw, 1 - Math.exp(-10 * dt));

        const mesh = playerMeshes.get(id);
        if (mesh) {
            const def = p.team === 'hider' ? PROP_DEFS[p.propIdx || 0] : null;
            const oy = def ? def.oy : 0.65;
            mesh.position.set(p.x, oy, p.z);
            mesh.rotation.y = p.yaw;
        }
    }

    // Update particles
    updateParticles(dt);

    // Render
    if (scene && camera && renderer) {
        renderer.render(scene, camera);
    }
}

// ── Room creation / joining ───────────────────────────────────────────────
async function createRoom(solo = false) {
    unlockAudio();
    const name = $('name').value.trim() || 'Player';
    myName = name;
    try { localStorage.setItem('prophuntName', name); } catch {}

    roomCode = makeCode();
    role = 'host';
    document.body.classList.add('is-host');

    if (!solo) {
        net = new HostNet({ onMessage: hostHandle, onLeave: hostLeave });
        setStatus('menu-status', 'Creating room...');
        try {
            await net.open(roomCode);
        } catch (e) {
            if (e.message === 'code-taken') {
                roomCode = makeCode();
                try { await net.open(roomCode); } catch (e2) {
                    setStatus('menu-status', e2.message, true); role = null; return;
                }
            } else {
                setStatus('menu-status', e.message, true); role = null; return;
            }
        }
        track('room_create');
    } else {
        net = null;
        track('play_solo');
    }

    myId = solo ? 'host' : net.peer.id;
    H.players = [];
    H.phase = 'lobby';

    hostHandle(myId, { t: 'hello', name });

    if (solo) {
        for (let i = 0; i < 3; i++) addBot();
    }

    $('room-code').textContent = roomCode;
    view = 'lobby'; show('lobby');
    setStatus('menu-status', '');
    playMusic('menu');
}

async function joinRoom() {
    unlockAudio();
    const name = $('name').value.trim() || 'Player';
    const code = $('code').value.trim().toUpperCase();
    if (!code || code.length < 3) { setStatus('menu-status', 'Enter a room code.', true); return; }
    myName = name;
    try { localStorage.setItem('prophuntName', name); } catch {}

    role = 'client';
    document.body.classList.remove('is-host');

    net = new ClientNet({
        onMessage: clientHandle,
        onClose: () => backToMenu('Lost connection to the host.'),
        onStatus: s => setStatus('menu-status', s),
    });

    setStatus('menu-status', 'Joining...');
    try {
        myId = await net.connect(code);
    } catch (e) {
        setStatus('menu-status', e.message, true); role = null; return;
    }

    net.send({ t: 'hello', name });
    track('room_join');

    // Timeout if no welcome
    setTimeout(() => {
        if (view === 'menu' && role === 'client') backToMenu('Room not found or game already started.');
    }, 8000);
}

function backToMenu(reason) {
    if (net) { net.close(); net = null; }
    role = null; myId = null; roomCode = '';
    gameActive = false; phase = 'lobby';
    players.clear();
    clearPlayerMeshes();
    removeFlashlight();
    document.body.classList.remove('is-host');
    H.players = []; H.phase = 'lobby';
    document.exitPointerLock && document.exitPointerLock();
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

// ── Mute controls ─────────────────────────────────────────────────────────
function muteHandler() {
    unlockAudio();
    const m = !isMuted();
    setMuted(m);
    $('icon-sound').classList.toggle('hidden', m);
    $('icon-muted').classList.toggle('hidden', !m);
    $('icon-sound-hud').classList.toggle('hidden', m);
    $('icon-muted-hud').classList.toggle('hidden', !m);
    sfx.click();
}
$('btn-mute').addEventListener('click', muteHandler);
$('btn-mute-hud').addEventListener('click', muteHandler);

// ── Button events ─────────────────────────────────────────────────────────
$('btn-create').addEventListener('click', () => { sfx.click(); createRoom(false); });
$('btn-solo').addEventListener('click', () => { sfx.click(); createRoom(true); });
$('btn-join').addEventListener('click', () => { sfx.click(); joinRoom(); });
$('btn-copy').addEventListener('click', () => {
    sfx.click();
    const link = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(link).then(() => toast('Invite link copied!')).catch(() => toast(roomCode));
});
$('btn-bot').addEventListener('click', () => { sfx.click(); addBot(); });
$('btn-ready').addEventListener('click', () => {
    sfx.click();
    const btn = $('btn-ready');
    const ready = btn.textContent === 'Ready up';
    btn.textContent = ready ? 'Cancel' : 'Ready up';
    act({ t: 'ready', r: ready });
});
$('btn-start').addEventListener('click', () => { sfx.click(); hostStartGame(); });
$('btn-exit').addEventListener('click', () => { sfx.click(); backToMenu(); });
$('btn-results-exit').addEventListener('click', () => { sfx.click(); backToMenu(); });
$('btn-again').addEventListener('click', () => {
    sfx.click();
    if (role === 'host') {
        H.phase = 'lobby';
        emitLobby();
        view = 'lobby'; show('lobby');
        playMusic('menu');
    }
});
$('btn-lock').addEventListener('click', () => { sfx.click(); toggleLock(); });

// ── Invite link handling ──────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
if (params.has('room')) {
    const code = params.get('room').toUpperCase();
    $('code').value = code;
    $('invite').textContent = `You've been invited to room ${code}`;
    $('invite').classList.remove('hidden');
    history.replaceState(null, '', location.pathname);
}

// ── Touch detection ───────────────────────────────────────────────────────
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ── Menu scene ────────────────────────────────────────────────────────────
function menuScene() {
    // Reset camera for menu
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 1, 0);
    camYaw = 0;
    camPitch = 0;
}

// ── Boot ──────────────────────────────────────────────────────────────────
$('name').value = myName;
if (isMuted()) {
    $('icon-sound').classList.add('hidden');
    $('icon-muted').classList.remove('hidden');
}
initThree();
menuScene();
scene.add(camera); // needed so flashlight works as child
show('menu');
playMusic('menu');
gameLoop();
