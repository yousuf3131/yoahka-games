// Prop Hunt — CoD-style third-person hide-and-seek
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
const MAX_PLAYERS    = 10;
const MOVE_SPEED     = 6.0;
const HIDER_SPEED    = 4.2;
const ACCEL          = 14;
const FRICTION       = 10;
const PLAYER_R       = 0.35;
const SEND_EVERY     = 0.05;
const HIDE_TIME      = 30;
const SEEK_TIME      = 120;
const ROUNDS_TOTAL   = 3;
const SHOOT_COOLDOWN = 0.4;
const SEEKER_HP      = 100;
const PROP_HIT_DMG   = 10;
const DECOY_HIT_DMG  = 10;
const MAX_DECOYS     = 3;
const INTERACT_RANGE = 3.0;
const ROOM_W         = 28;
const ROOM_H         = 28;
const WALL_H         = 6;

const CAM_DIST   = 8;
const CAM_HEIGHT = 5;
const CAM_PITCH_DEFAULT = 0.45;

const COLORS = ['#e0584f','#3b82f6','#2ec495','#f2c14e','#a78bfa','#f97316','#ec4899','#e2e8f0','#22d3ee','#b45309'];
const BOT_NAMES = ['Barrel Bob','Chair Carl','Lamp Larry','Vase Val','Box Bart','Bucket Ben','Crate Craig','Shadow','Shelf Sam','Keg Kevin'];

// ── Prop Definitions ──────────────────────────────────────────────────────
const PROP_DEFS = [
    { name: 'Barrel', color: 0x8B5E3C, createGeom: () => new THREE.CylinderGeometry(0.38, 0.42, 0.85, 16), oy: 0.425 },
    { name: 'Crate',  color: 0xA0784C, createGeom: () => new THREE.BoxGeometry(0.7, 0.7, 0.7), oy: 0.35 },
    { name: 'Chair',  color: 0x5C3A1E, createGeom: null, oy: 0.45, buildGroup: true },
    { name: 'Lamp',   color: 0xF5E6B8, createGeom: () => new THREE.CylinderGeometry(0.12, 0.28, 1.2, 12), oy: 0.6 },
    { name: 'Vase',   color: 0x4A90D9, createGeom: () => {
        const pts = [new THREE.Vector2(0,0), new THREE.Vector2(0.25,0), new THREE.Vector2(0.3,0.15),
            new THREE.Vector2(0.2,0.5), new THREE.Vector2(0.15,0.6), new THREE.Vector2(0.22,0.75),
            new THREE.Vector2(0.18,0.85), new THREE.Vector2(0.12,0.9), new THREE.Vector2(0,0.9)];
        return new THREE.LatheGeometry(pts, 16);
    }, oy: 0 },
    { name: 'Bucket', color: 0x888888, createGeom: () => new THREE.CylinderGeometry(0.28, 0.35, 0.5, 14), oy: 0.25 },
];

// ── State ─────────────────────────────────────────────────────────────────
let myName = (() => { try { return localStorage.getItem('prophuntName') || ''; } catch { return ''; } })();
let role = null, net = null, myId = null, roomCode = '', view = 'menu';
let gameActive = false, sendTimer = 0;
let netBusy = false;
let phase = 'lobby';
let myTeam = 'hider';
let myPropType = -1;
let myDecoys = MAX_DECOYS;
let myHP = SEEKER_HP;
let shootCooldown = 0;
let phaseTimer = 0;
let hidersAlive = 0;
let nearestProp = null;

const players = new Map();
let me = null;

let currentRound = 1;
let seekerScore = 0;
let hiderScore = 0;

const H = {
    players: [],
    phase: 'lobby',
    phaseTimer: 0,
    round: 1,
    seekerScore: 0,
    hiderScore: 0,
    decoys: [],
    nextDecoyId: 0,
    eliminatedHiders: new Set(),
};

let vx = 0, vz = 0;
let keys = {};
let mouseDx = 0, mouseDy = 0;
let lastStepT = 0;

// Camera
let camYaw = 0;
let camPitch = CAM_PITCH_DEFAULT;
let camPos = new THREE.Vector3(0, 15, 15);
let camTarget = new THREE.Vector3(0, 0, 0);

// ── Three.js ──────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
const playerMeshes = new Map();
const staticPropMeshes = [];
const decoyMeshes = new Map();
let particles = [];

function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x88aabb);
    scene.fog = new THREE.Fog(0x88aabb, 35, 60);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 15, 15);
    clock = new THREE.Clock();

    // Hemisphere light (sky/ground)
    const hemi = new THREE.HemisphereLight(0x99bbdd, 0x443322, 0.6);
    scene.add(hemi);

    // Main directional light
    const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
    dirLight.position.set(8, 18, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 50;
    const s = 18;
    dirLight.shadow.camera.left = -s;
    dirLight.shadow.camera.right = s;
    dirLight.shadow.camera.top = s;
    dirLight.shadow.camera.bottom = -s;
    dirLight.shadow.bias = -0.002;
    scene.add(dirLight);

    // Fill light
    const fill = new THREE.DirectionalLight(0xaaccff, 0.3);
    fill.position.set(-6, 10, -8);
    scene.add(fill);

    buildRoom();

    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });
}

// ── Room ──────────────────────────────────────────────────────────────────
function buildRoom() {
    // Floor — concrete warehouse
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.9, metalness: 0.05 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Floor grid lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x807060, transparent: true, opacity: 0.3 });
    for (let x = -ROOM_W / 2; x <= ROOM_W / 2; x += 4) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(0.04, ROOM_H), lineMat);
        l.rotation.x = -Math.PI / 2; l.position.set(x, 0.005, 0);
        scene.add(l);
    }
    for (let z = -ROOM_H / 2; z <= ROOM_H / 2; z += 4) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, 0.04), lineMat);
        l.rotation.x = -Math.PI / 2; l.position.set(0, 0.005, z);
        scene.add(l);
    }

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.85, metalness: 0.05 });
    const wallGeo = new THREE.PlaneGeometry(ROOM_W + 1, WALL_H);
    const wallDefs = [
        { pos: [0, WALL_H / 2, -ROOM_H / 2], rot: [0, 0, 0] },
        { pos: [0, WALL_H / 2, ROOM_H / 2],  rot: [0, Math.PI, 0] },
    ];
    const sideWallGeo = new THREE.PlaneGeometry(ROOM_H + 1, WALL_H);
    const sideWallDefs = [
        { pos: [-ROOM_W / 2, WALL_H / 2, 0], rot: [0, Math.PI / 2, 0] },
        { pos: [ROOM_W / 2, WALL_H / 2, 0],  rot: [0, -Math.PI / 2, 0] },
    ];
    for (const w of wallDefs) {
        const m = new THREE.Mesh(wallGeo, wallMat);
        m.position.set(...w.pos); m.rotation.set(...w.rot); m.receiveShadow = true;
        scene.add(m);
    }
    for (const w of sideWallDefs) {
        const m = new THREE.Mesh(sideWallGeo, wallMat);
        m.position.set(...w.pos); m.rotation.set(...w.rot); m.receiveShadow = true;
        scene.add(m);
    }

    // Wall accent stripe
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.8 });
    for (const z of [-ROOM_H / 2, ROOM_H / 2]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.3, 0.06), stripeMat);
        stripe.position.set(0, 1.2, z + (z > 0 ? -0.02 : 0.02));
        scene.add(stripe);
    }

    // Furniture — tables
    const furnitureMat = new THREE.MeshStandardMaterial({ color: 0x6a5a42, roughness: 0.7, metalness: 0.1 });
    const tables = [
        { x: -8, z: -8, w: 2.5, d: 1.2, h: 0.8 },
        { x: 6, z: 8, w: 2, d: 1.5, h: 0.75 },
        { x: -9, z: 6, w: 1.8, d: 1, h: 0.85 },
        { x: 8, z: -6, w: 2.2, d: 1.2, h: 0.8 },
        { x: 0, z: -10, w: 3, d: 1, h: 0.82 },
        { x: -3, z: 3, w: 1.6, d: 1.6, h: 0.78 },
    ];
    for (const t of tables) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.08, t.d), furnitureMat);
        top.position.set(t.x, t.h, t.z); top.castShadow = true; top.receiveShadow = true;
        scene.add(top);
        const legGeo = new THREE.CylinderGeometry(0.04, 0.04, t.h - 0.04, 6);
        for (const [lx, lz] of [[t.w/2-0.08, t.d/2-0.08], [-t.w/2+0.08, t.d/2-0.08],
                                  [t.w/2-0.08, -t.d/2+0.08], [-t.w/2+0.08, -t.d/2+0.08]]) {
            const leg = new THREE.Mesh(legGeo, furnitureMat);
            leg.position.set(t.x+lx, (t.h-0.04)/2, t.z+lz); leg.castShadow = true;
            scene.add(leg);
        }
    }

    // Shelving units against walls
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8, metalness: 0.05 });
    const shelves = [
        { x: -ROOM_W/2+0.5, z: -5, w: 0.8, d: 3, h: 2.8 },
        { x: -ROOM_W/2+0.5, z: 6, w: 0.8, d: 2.5, h: 2.4 },
        { x: ROOM_W/2-0.5, z: 3, w: 0.8, d: 3.5, h: 2.6 },
        { x: ROOM_W/2-0.5, z: -7, w: 0.8, d: 2, h: 3 },
        { x: 4, z: -ROOM_H/2+0.5, w: 3, d: 0.8, h: 2.5 },
        { x: -6, z: ROOM_H/2-0.5, w: 3.5, d: 0.8, h: 2.2 },
    ];
    for (const s of shelves) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), shelfMat);
        shelf.position.set(s.x, s.h/2, s.z); shelf.castShadow = true; shelf.receiveShadow = true;
        scene.add(shelf);
    }

    // Pillars for cover
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.75, metalness: 0.1 });
    for (const [px, pz] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, WALL_H, 12), pillarMat);
        pillar.position.set(px, WALL_H/2, pz); pillar.castShadow = true; pillar.receiveShadow = true;
        scene.add(pillar);
    }

    placeStaticProps();
}

// ── Static props ──────────────────────────────────────────────────────────
const STATIC_PROP_POSITIONS = [
    // Barrels
    { type: 0, x: -10, z: -10 }, { type: 0, x: -9.5, z: -10.5 }, { type: 0, x: 11, z: -4 },
    { type: 0, x: 9, z: 9 }, { type: 0, x: -4, z: 11 }, { type: 0, x: 6, z: -11 },
    { type: 0, x: -12, z: 2 },
    // Crates
    { type: 1, x: -11, z: 3 }, { type: 1, x: -11.5, z: 3.5 }, { type: 1, x: 7, z: -10 },
    { type: 1, x: 4, z: 7 }, { type: 1, x: -5, z: -4 }, { type: 1, x: 10, z: 5 },
    { type: 1, x: -8, z: -2 },
    // Chairs
    { type: 2, x: -8, z: -7.5 }, { type: 2, x: 6.5, z: 8.5 }, { type: 2, x: -9.5, z: 6.5 },
    { type: 2, x: 8.5, z: -5.5 }, { type: 2, x: 0.5, z: -10.5 },
    // Lamps
    { type: 3, x: -8, z: -8.5 }, { type: 3, x: 6, z: 7.5 }, { type: 3, x: 8.5, z: -6.5 },
    { type: 3, x: -3, z: 3.5 },
    // Vases
    { type: 4, x: -11, z: -1 }, { type: 4, x: 9, z: 6 }, { type: 4, x: 3, z: -8 },
    // Buckets
    { type: 5, x: 3, z: -5 }, { type: 5, x: -3, z: 8 }, { type: 5, x: -7, z: -1 },
    { type: 5, x: 11, z: 0 },
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
        mesh.userData.propType = sp.type;
    }
}

// ── Prop mesh creation ────────────────────────────────────────────────────
function createPropMesh(typeIdx) {
    const def = PROP_DEFS[typeIdx];

    if (def.buildGroup && def.name === 'Chair') {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7, metalness: 0.1 });
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat);
        seat.position.y = 0.42; seat.castShadow = true;
        group.add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.04), mat);
        back.position.set(0, 0.67, -0.2); back.castShadow = true;
        group.add(back);
        const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
        for (const [lx, lz] of [[0.18,0.18],[-0.18,0.18],[0.18,-0.18],[-0.18,-0.18]]) {
            const leg = new THREE.Mesh(legGeo, mat);
            leg.position.set(lx, 0.21, lz); leg.castShadow = true;
            group.add(leg);
        }
        return group;
    }

    const geom = def.createGeom();
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.65, metalness: 0.15 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

// ── Player mesh management ────────────────────────────────────────────────
function createCharacterMesh(color) {
    const group = new THREE.Group();
    const c = new THREE.Color(color);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a874, roughness: 0.7, metalness: 0.05 });
    const clothMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.15 });
    const darkCloth = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.55), roughness: 0.65, metalness: 0.1 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8, metalness: 0.1 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.26), clothMat);
    torso.position.y = 0.95; torso.castShadow = true;
    group.add(torso);

    // Shoulders
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.28), clothMat);
    shoulder.position.y = 1.19; shoulder.castShadow = true;
    group.add(shoulder);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), skinMat);
    head.position.y = 1.44; head.castShadow = true;
    group.add(head);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1008 });
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
        eye.position.set(side * 0.055, 1.46, 0.14);
        group.add(eye);
    }

    // Arms
    for (const side of [-1, 1]) {
        const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 6, 8), clothMat);
        upperArm.position.set(side * 0.32, 1.02, 0); upperArm.castShadow = true;
        group.add(upperArm);
        const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 6, 8), skinMat);
        forearm.position.set(side * 0.32, 0.74, 0); forearm.castShadow = true;
        group.add(forearm);
    }

    // Legs
    for (const side of [-1, 1]) {
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.28, 6, 8), darkCloth);
        thigh.position.set(side * 0.11, 0.5, 0); thigh.castShadow = true;
        group.add(thigh);
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 6, 8), darkCloth);
        shin.position.set(side * 0.11, 0.2, 0); shin.castShadow = true;
        group.add(shin);
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.18), shoeMat);
        shoe.position.set(side * 0.11, 0.04, 0.03); shoe.castShadow = true;
        group.add(shoe);
    }

    return group;
}

function getOrCreatePlayerMesh(id, p) {
    if (playerMeshes.has(id)) return playerMeshes.get(id);

    let mesh;
    if (p.propType >= 0) {
        mesh = createPropMesh(p.propType);
    } else {
        mesh = createCharacterMesh(p.color);
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

function rebuildPlayerMesh(id) {
    const p = players.get(id);
    if (!p) return;
    removePlayerMesh(id);
    getOrCreatePlayerMesh(id, p);
}

// ── Decoy management ──────────────────────────────────────────────────────
function addDecoyMesh(id, x, z, propType, rot) {
    const def = PROP_DEFS[propType];
    const mesh = createPropMesh(propType);
    mesh.position.set(x, def.oy, z);
    mesh.rotation.y = rot || 0;
    mesh.userData.decoyId = id;
    scene.add(mesh);
    decoyMeshes.set(id, mesh);
}

function removeDecoyMesh(id) {
    const m = decoyMeshes.get(id);
    if (m) { scene.remove(m); decoyMeshes.delete(id); }
}

function clearDecoys() {
    for (const [id] of decoyMeshes) removeDecoyMesh(id);
}

// ── Particles ─────────────────────────────────────────────────────────────
function spawnParticles(pos, color, count = 12) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
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

function spawnTransformParticles(x, y, z) {
    spawnParticles(new THREE.Vector3(x, y + 0.5, z), 0xaa88ff, 18);
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 2;
        p.vel.y -= 9.8 * dt;
        p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
        p.mesh.material.opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
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
function constrainToRoom(p) {
    const hw = ROOM_W / 2 - PLAYER_R;
    const hh = ROOM_H / 2 - PLAYER_R;
    p.x = clamp(p.x, -hw, hw);
    p.z = clamp(p.z, -hh, hh);
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
            }
            break;
        }
        case 'transform': {
            if (!gameActive) return;
            const p = players.get(from);
            if (p && p.team === 'hider' && p.alive) {
                p.propType = clamp(msg.pt, 0, PROP_DEFS.length - 1);
                emit({ t: 'transformed', id: from, pt: p.propType });
            }
            break;
        }
        case 'decoy': {
            if (!gameActive) return;
            const p = players.get(from);
            if (!p || p.team !== 'hider' || !p.alive || p.propType < 0) return;
            if ((p.decoysLeft || 0) <= 0) return;
            p.decoysLeft--;
            const decoyId = H.nextDecoyId++;
            const decoy = { id: decoyId, x: msg.x, z: msg.z, pt: p.propType, rot: p.yaw || 0 };
            H.decoys.push(decoy);
            emit({ t: 'decoySpawn', ...decoy });
            break;
        }
        case 'shoot': {
            if (!gameActive || H.phase !== 'seeking') return;
            const p = players.get(from);
            if (!p || p.team !== 'seeker' || !p.alive) return;

            if (msg.hitPlayer) {
                const target = players.get(msg.hitPlayer);
                if (target && target.team === 'hider' && target.alive) {
                    target.alive = false;
                    H.eliminatedHiders.add(msg.hitPlayer);
                    emit({ t: 'eliminated', shooter: from, target: msg.hitPlayer });
                    hostCheckRoundEnd();
                }
            } else if (msg.hitStatic !== undefined) {
                p.hp = Math.max(0, (p.hp || SEEKER_HP) - PROP_HIT_DMG);
                emit({ t: 'damage', id: from, hp: p.hp });
                if (p.hp <= 0) { p.alive = false; emit({ t: 'seekerDown', id: from }); hostCheckRoundEnd(); }
            } else if (msg.hitDecoy !== undefined) {
                const dIdx = H.decoys.findIndex(d => d.id === msg.hitDecoy);
                if (dIdx >= 0) {
                    H.decoys.splice(dIdx, 1);
                    p.hp = Math.max(0, (p.hp || SEEKER_HP) - DECOY_HIT_DMG);
                    emit({ t: 'decoyDestroyed', id: msg.hitDecoy });
                    emit({ t: 'damage', id: from, hp: p.hp });
                    if (p.hp <= 0) { p.alive = false; emit({ t: 'seekerDown', id: from }); hostCheckRoundEnd(); }
                }
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
    H.round = 1; H.seekerScore = 0; H.hiderScore = 0;
    hostStartRound();
}

function hostStartRound() {
    H.phase = 'hiding';
    H.phaseTimer = HIDE_TIME + 3;
    H.eliminatedHiders = new Set();
    H.decoys = [];
    H.nextDecoyId = 0;

    const n = H.players.length;
    const nSeekers = Math.max(1, Math.floor(n / 3));
    const shuffled = [...H.players].sort(() => Math.random() - 0.5);
    const seekerSet = new Set();
    for (let i = 0; i < nSeekers; i++) seekerSet.add(shuffled[i].id);
    if (H.round % 2 === 0) {
        const temp = new Set(seekerSet);
        seekerSet.clear();
        for (const p of H.players) { if (!temp.has(p.id)) seekerSet.add(p.id); }
    }

    const spawns = H.players.map((p, i) => {
        const team = seekerSet.has(p.id) ? 'seeker' : 'hider';
        const angle = (i / n) * Math.PI * 2;
        const r = team === 'hider' ? 5 : 1;
        return {
            id: p.id, name: p.name, color: p.color, bot: p.bot,
            team, x: Math.cos(angle) * r, z: Math.sin(angle) * r,
            hp: team === 'seeker' ? SEEKER_HP : 0,
        };
    });

    emit({
        t: 'roundStart', spawns, round: H.round, totalRounds: ROUNDS_TOTAL,
        seekerScore: H.seekerScore, hiderScore: H.hiderScore,
    });
}

function hostCheckRoundEnd() {
    const aliveHiders = [...players.values()].filter(p => p.team === 'hider' && p.alive);
    const aliveSeekers = [...players.values()].filter(p => p.team === 'seeker' && p.alive);
    if (aliveHiders.length === 0) { H.seekerScore++; hostEndRound('seekers'); }
    else if (aliveSeekers.length === 0) { H.hiderScore++; hostEndRound('hiders'); }
}

function hostEndRound(winner) {
    H.phase = 'roundEnd';
    gameActive = false;
    emit({ t: 'roundEnd', winner, round: H.round, seekerScore: H.seekerScore, hiderScore: H.hiderScore });
    if (H.round >= ROUNDS_TOTAL || H.seekerScore > ROUNDS_TOTAL / 2 || H.hiderScore > ROUNDS_TOTAL / 2) {
        const matchWinner = H.seekerScore > H.hiderScore ? 'seekers' : 'hiders';
        setTimeout(() => emit({ t: 'matchEnd', winner: matchWinner, seekerScore: H.seekerScore, hiderScore: H.hiderScore }), 3000);
    } else {
        setTimeout(() => { H.round++; hostStartRound(); }, 5000);
    }
}

function hostTimerUpdate(dt) {
    if (!gameActive || (H.phase !== 'hiding' && H.phase !== 'seeking')) return;
    H.phaseTimer -= dt;
    if (H.phaseTimer <= 0) {
        if (H.phase === 'hiding') {
            H.phase = 'seeking';
            H.phaseTimer = SEEK_TIME;
            emit({ t: 'seekPhase' });
        } else {
            H.hiderScore++;
            hostEndRound('hiders');
        }
        return;
    }
    emit({ t: 'timer', time: Math.max(0, Math.ceil(H.phaseTimer)), phase: H.phase });
}

// ── Bot AI ────────────────────────────────────────────────────────────────
function updateBots(dt) {
    for (const [id, p] of players) {
        if (!p.bot || !p.alive) continue;
        p.botTimer = (p.botTimer || 0) - dt;
        if (p.botTimer > 0) continue;
        if (p.team === 'hider') botHiderAI(id, p, dt);
        else botSeekerAI(id, p, dt);
    }
}

function botHiderAI(id, p, dt) {
    if (phase === 'hiding') {
        if (p.propType < 0) {
            // Run to nearest prop and transform
            if (!p.botTarget) {
                const sp = STATIC_PROP_POSITIONS[Math.floor(Math.random() * STATIC_PROP_POSITIONS.length)];
                p.botTarget = { x: sp.x + (Math.random() - 0.5) * 2, z: sp.z + (Math.random() - 0.5) * 2, type: sp.type };
            }
            const dx = p.botTarget.x - p.x, dz = p.botTarget.z - p.z;
            const dist = Math.hypot(dx, dz);
            if (dist > INTERACT_RANGE * 0.8) {
                const step = HIDER_SPEED * dt;
                p.x += (dx / dist) * step; p.z += (dz / dist) * step;
                p.yaw = Math.atan2(dx, dz); constrainToRoom(p);
            } else {
                p.propType = p.botTarget.type;
                emit({ t: 'transformed', id, pt: p.propType });
                rebuildPlayerMesh(id);
                p.botTarget = null;
            }
            p.botTimer = 0.08;
        } else {
            // Already disguised — maybe place a decoy, then find a hiding spot
            if ((p.decoysLeft || 0) > 0 && Math.random() < 0.3) {
                p.decoysLeft--;
                const decoyId = H.nextDecoyId++;
                const decoy = { id: decoyId, x: p.x, z: p.z, pt: p.propType, rot: p.yaw };
                H.decoys.push(decoy);
                emit({ t: 'decoySpawn', ...decoy });
                p.botTarget = { x: (Math.random() - 0.5) * (ROOM_W - 4), z: (Math.random() - 0.5) * (ROOM_H - 4) };
            }
            if (!p.botTarget) {
                const same = STATIC_PROP_POSITIONS.filter(sp => sp.type === p.propType);
                if (same.length > 0) {
                    const t = same[Math.floor(Math.random() * same.length)];
                    p.botTarget = { x: t.x + (Math.random() - 0.5) * 2, z: t.z + (Math.random() - 0.5) * 2 };
                } else {
                    p.botTarget = { x: (Math.random() - 0.5) * (ROOM_W - 4), z: (Math.random() - 0.5) * (ROOM_H - 4) };
                }
            }
            const dx = p.botTarget.x - p.x, dz = p.botTarget.z - p.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.5) {
                const step = HIDER_SPEED * 0.5 * dt;
                p.x += (dx / dist) * step; p.z += (dz / dist) * step; constrainToRoom(p);
            } else {
                p.botTarget = null;
            }
            p.botTimer = 0.12;
        }
    } else if (phase === 'seeking') {
        // Stay mostly still, occasionally shift a little
        if (Math.random() < 0.02) {
            p.x += (Math.random() - 0.5) * 0.3;
            p.z += (Math.random() - 0.5) * 0.3;
            constrainToRoom(p);
        }
        p.botTimer = 0.5;
    } else {
        p.botTimer = 1;
    }
}

function botSeekerAI(id, p, dt) {
    if (phase !== 'seeking') { p.botTimer = 0.5; return; }

    if (!p.botPatrol) {
        p.botPatrol = { x: (Math.random() - 0.5) * (ROOM_W - 4), z: (Math.random() - 0.5) * (ROOM_H - 4) };
        p.botShootTimer = 2 + Math.random() * 3;
    }
    const dx = p.botPatrol.x - p.x, dz = p.botPatrol.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1) {
        const step = MOVE_SPEED * dt;
        p.x += (dx / dist) * step; p.z += (dz / dist) * step;
        p.yaw = Math.atan2(dx, dz); constrainToRoom(p);
    } else {
        p.botPatrol = { x: (Math.random() - 0.5) * (ROOM_W - 4), z: (Math.random() - 0.5) * (ROOM_H - 4) };
    }

    p.botShootTimer = (p.botShootTimer || 3) - dt;
    if (p.botShootTimer <= 0) {
        p.botShootTimer = 1.5 + Math.random() * 3;
        let closest = null, closestDist = Infinity;
        for (const [hid, hp] of players) {
            if (hp.team === 'hider' && hp.alive) {
                const d = Math.hypot(hp.x - p.x, hp.z - p.z);
                if (d < closestDist && d < 10) { closestDist = d; closest = hid; }
            }
        }
        if (closest && Math.random() < 0.35) {
            hostHandle(id, { t: 'shoot', hitPlayer: closest });
        } else if (Math.random() < 0.12) {
            const idx = Math.floor(Math.random() * STATIC_PROP_POSITIONS.length);
            hostHandle(id, { t: 'shoot', hitStatic: idx });
        }
    }
    p.botTimer = 0.08;
}

// ── Client logic ──────────────────────────────────────────────────────────
function clientHandle(msg) {
    switch (msg.t) {
        case 'reject': backToMenu(msg.reason); break;
        case 'welcome':
            myId = msg.you; roomCode = msg.code;
            $('room-code').textContent = msg.code;
            view = 'lobby'; show('lobby');
            break;
        case 'lobby': renderLobby(msg.players); break;
        case 'roundStart': {
            view = 'game'; show('hud');
            gameActive = true;
            phase = 'hiding';
            players.clear();
            clearPlayerMeshes();
            clearDecoys();

            currentRound = msg.round;
            seekerScore = msg.seekerScore; hiderScore = msg.hiderScore;
            $('round-text').textContent = `${msg.round}/${msg.totalRounds}`;
            $('score-text').textContent = `${msg.hiderScore} - ${msg.seekerScore}`;

            for (const s of msg.spawns) {
                const p = {
                    x: s.x, z: s.z, yaw: 0,
                    targetX: s.x, targetZ: s.z, targetYaw: 0,
                    team: s.team, propType: -1, alive: true,
                    hp: s.hp || SEEKER_HP,
                    name: s.name, color: s.color, bot: s.bot || false,
                    decoysLeft: s.team === 'hider' ? MAX_DECOYS : 0,
                    botTimer: 0, botTarget: null, botPatrol: null, botShootTimer: 3,
                };
                players.set(s.id, p);
                getOrCreatePlayerMesh(s.id, p);
            }

            me = players.get(myId);
            if (!me) break;
            myTeam = me.team;
            myPropType = -1;
            myDecoys = MAX_DECOYS;
            myHP = SEEKER_HP;
            shootCooldown = 0;
            vx = 0; vz = 0;

            camYaw = Math.PI;
            camPitch = CAM_PITCH_DEFAULT;

            setupHUDForRole();

            if (myTeam === 'seeker') {
                $('blindfold').classList.remove('hidden');
            } else {
                $('blindfold').classList.add('hidden');
                requestPointerLock();
            }

            showCenter(myTeam === 'hider' ? 'YOU ARE A HIDER' : 'YOU ARE A SEEKER', 2500);

            let countdown = 3;
            const cdInt = setInterval(() => {
                countdown--;
                if (countdown > 0) sfx.count();
                else { clearInterval(cdInt); sfx.go(); if (myTeam === 'hider') showCenter('FIND A PROP!', 1500); }
            }, 1000);

            playMusic('hiding');
            break;
        }
        case 'seekPhase': {
            phase = 'seeking';
            $('blindfold').classList.add('hidden');
            $('phase-label').textContent = 'SEEKING PHASE';
            $('interact-prompt').classList.add('hidden');
            $('decoy-hud').classList.add('hidden');

            if (myTeam === 'seeker') {
                $('crosshair').classList.remove('hidden');
                $('health-hud').classList.remove('hidden');
                requestPointerLock();
                showCenter('HUNT THEM DOWN!', 2000);
            } else {
                $('crosshair').classList.add('hidden');
                showCenter('STAY HIDDEN!', 2000);
            }

            updateTouchButtons();
            playMusic('seeking');
            sfx.go();
            break;
        }
        case 'transformed': {
            const p = players.get(msg.id);
            if (p) {
                p.propType = msg.pt;
                rebuildPlayerMesh(msg.id);
                const mesh = playerMeshes.get(msg.id);
                if (mesh) spawnTransformParticles(mesh.position.x, PROP_DEFS[msg.pt].oy, mesh.position.z);
            }
            if (msg.id === myId) {
                myPropType = msg.pt;
                showCenter(`You became a ${PROP_DEFS[msg.pt].name}!`, 1500);
                sfx.propSelect();
            }
            break;
        }
        case 'decoySpawn': {
            addDecoyMesh(msg.id, msg.x, msg.z, msg.pt, msg.rot);
            break;
        }
        case 'decoyDestroyed': {
            const mesh = decoyMeshes.get(msg.id);
            if (mesh) spawnParticles(mesh.position.clone(), 0xaaaaaa, 12);
            removeDecoyMesh(msg.id);
            sfx.hitProp();
            break;
        }
        case 'eliminated': {
            const target = players.get(msg.target);
            if (target) {
                target.alive = false;
                const mesh = playerMeshes.get(msg.target);
                if (mesh) spawnParticles(mesh.position.clone(), 0xff4444, 20);
                removePlayerMesh(msg.target);
            }
            if (msg.target === myId) {
                showCenter('YOU WERE FOUND!', 3000);
                sfx.found();
                document.exitPointerLock && document.exitPointerLock();
            } else {
                toast(`${target ? target.name : 'Someone'} was found!`);
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
                showCenter('-' + PROP_HIT_DMG + ' HP', 800);
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
                toast(`${p ? p.name : 'A seeker'} ran out of health!`);
            }
            break;
        }
        case 'timer': {
            phaseTimer = msg.time;
            const m = Math.floor(msg.time / 60), s = msg.time % 60;
            $('timer-value').textContent = `${m}:${s.toString().padStart(2, '0')}`;
            $('timer-value').classList.toggle('urgent', msg.time <= 10);
            if (msg.phase === 'hiding' && myTeam === 'seeker') $('blindfold-timer').textContent = msg.time;
            if (msg.time <= 5 && msg.time > 0) sfx.count();
            break;
        }
        case 'roundEnd': {
            gameActive = false; phase = 'roundEnd';
            document.exitPointerLock && document.exitPointerLock();
            seekerScore = msg.seekerScore; hiderScore = msg.hiderScore;
            showCenter(msg.winner === 'hiders' ? 'Hiders survive!' : 'Seekers found them all!', 3000);
            sfx.win(); playMusic('results');
            break;
        }
        case 'matchEnd': {
            phase = 'matchEnd'; view = 'results'; show('results');
            $('results-kicker').textContent = 'MATCH OVER';
            $('results-title').textContent = msg.winner === 'hiders' ? 'Hiders Win!' : 'Seekers Win!';
            const list = $('results-list'); list.innerHTML = '';
            for (const [id, p] of players) {
                const li = document.createElement('li');
                li.className = 'player' + (id === myId ? ' me' : '');
                li.innerHTML = `<span class="dot" style="background:${esc(p.color)}"></span>
                    <span class="who"><b>${esc(p.name)}</b></span>
                    <span class="badge">${esc(p.team)}</span>`;
                list.appendChild(li);
            }
            $('score-text').textContent = `${msg.hiderScore} - ${msg.seekerScore}`;
            sfx.win(); track('match_end', { winner: msg.winner });
            break;
        }
    }
}

// ── HUD ───────────────────────────────────────────────────────────────────
function setupHUDForRole() {
    const badge = $('role-badge');
    badge.textContent = myTeam === 'hider' ? 'HIDER' : 'SEEKER';
    badge.classList.toggle('seeker', myTeam === 'seeker');
    $('phase-label').textContent = 'HIDING PHASE';

    $('crosshair').classList.add('hidden');
    $('hitmarker').classList.remove('show');
    $('health-hud').classList.toggle('hidden', myTeam !== 'seeker');

    if (myTeam === 'hider') {
        $('decoy-hud').classList.remove('hidden');
        updateDecoyHUD();
    } else {
        $('decoy-hud').classList.add('hidden');
        $('interact-prompt').classList.add('hidden');
    }

    updateHidersCount();
    updateHealthBar();
    updateTouchButtons();
}

function updateDecoyHUD() {
    $('decoy-count').textContent = myDecoys;
}

function updateHidersCount() {
    hidersAlive = [...players.values()].filter(p => p.team === 'hider' && p.alive).length;
    $('hiders-count').textContent = hidersAlive;
}

function updateHealthBar() {
    const pct = (myHP / SEEKER_HP) * 100;
    $('health-bar').style.width = pct + '%';
    $('health-bar').classList.toggle('low', pct <= 30);
    $('health-text').textContent = myHP;
}

function updateInteractPrompt() {
    const prompt = $('interact-prompt');
    if (nearestProp && myTeam === 'hider' && me && me.alive && (phase === 'hiding' || phase === 'seeking')) {
        const name = PROP_DEFS[nearestProp.type].name;
        prompt.innerHTML = `Press <b>E</b> to become <b>${esc(name)}</b>`;
        prompt.classList.remove('hidden');
    } else {
        prompt.classList.add('hidden');
    }
}

function updateTouchButtons() {
    const ta = $('touch-action');
    const ta2 = $('touch-action2');
    if (myTeam === 'seeker') {
        ta.textContent = 'SHOOT';
        ta.classList.toggle('hidden', phase !== 'seeking');
        ta2.classList.add('hidden');
    } else {
        ta.textContent = 'BECOME';
        ta.classList.toggle('hidden', !nearestProp);
        ta2.textContent = `DECOY (${myDecoys})`;
        ta2.classList.toggle('hidden', myPropType < 0 || myDecoys <= 0);
    }
}

function renderLobby(list) {
    const ul = $('players'); ul.innerHTML = '';
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
    for (const btn of ul.querySelectorAll('.kick')) btn.addEventListener('click', () => kickPlayer(btn.dataset.id));
}

function clearPlayerMeshes() { for (const [id] of playerMeshes) removePlayerMesh(id); }

// ── Prop interaction ──────────────────────────────────────────────────────
function checkNearestProp() {
    if (!gameActive || !me || !me.alive || myTeam !== 'hider') { nearestProp = null; return; }

    let closest = null;
    let closestDist = INTERACT_RANGE;
    for (let i = 0; i < STATIC_PROP_POSITIONS.length; i++) {
        const sp = STATIC_PROP_POSITIONS[i];
        const d = Math.hypot(sp.x - me.x, sp.z - me.z);
        if (d < closestDist) { closestDist = d; closest = { idx: i, type: sp.type, distance: d }; }
    }
    nearestProp = closest;
    updateInteractPrompt();
    updateTouchButtons();
}

function doTransform() {
    if (!nearestProp || myTeam !== 'hider' || !me || !me.alive) return;
    const newType = nearestProp.type;
    myPropType = newType;
    me.propType = newType;
    act({ t: 'transform', pt: newType });
    rebuildPlayerMesh(myId);
    spawnTransformParticles(me.x, PROP_DEFS[newType].oy, me.z);
    sfx.propSelect();
    showCenter(`You became a ${PROP_DEFS[newType].name}!`, 1500);
    updateDecoyHUD();
    updateTouchButtons();
}

function doDecoy() {
    if (myTeam !== 'hider' || myPropType < 0 || myDecoys <= 0 || !me || !me.alive) return;
    myDecoys--;
    act({ t: 'decoy', x: me.x, z: me.z });
    sfx.propSelect();
    updateDecoyHUD();
    updateTouchButtons();
    toast('Decoy placed!');
}

// ── Shooting ──────────────────────────────────────────────────────────────
function tryShoot() {
    if (shootCooldown > 0 || !me || !me.alive || myTeam !== 'seeker' || phase !== 'seeking') return;
    shootCooldown = SHOOT_COOLDOWN;
    sfx.shoot();

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = 40;

    const targets = [];
    const addTargets = (mesh, type, id) => {
        if (mesh.isGroup) mesh.traverse(c => { if (c.isMesh) targets.push({ mesh: c, type, id }); });
        else targets.push({ mesh, type, id });
    };

    // Player meshes (hiders only, skip self)
    for (const [id, mesh] of playerMeshes) {
        if (id === myId) continue;
        const p = players.get(id);
        if (p && p.team === 'hider' && p.alive) addTargets(mesh, 'player', id);
    }
    // Static props
    for (const m of staticPropMeshes) addTargets(m, 'static', m.userData.staticPropIdx);
    // Decoys
    for (const [id, m] of decoyMeshes) addTargets(m, 'decoy', id);

    const meshes = targets.map(t => t.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
        const target = targets.find(t => t.mesh === hits[0].object);
        if (target) {
            if (target.type === 'player') {
                act({ t: 'shoot', hitPlayer: target.id });
            } else if (target.type === 'static') {
                act({ t: 'shoot', hitStatic: target.id });
                flashMesh(hits[0].object);
            } else if (target.type === 'decoy') {
                act({ t: 'shoot', hitDecoy: target.id });
            }
            showHitMarker();
            spawnParticles(hits[0].point, target.type === 'player' ? 0xff4444 : 0x888888, 12);
        }
    }
}

function flashMesh(mesh) {
    if (!mesh.material) return;
    mesh.material.emissive = new THREE.Color(0xff0000);
    mesh.material.emissiveIntensity = 0.5;
    setTimeout(() => {
        if (mesh.material) { mesh.material.emissive = new THREE.Color(0); mesh.material.emissiveIntensity = 0; }
    }, 300);
}

// ── Pointer Lock ──────────────────────────────────────────────────────────
function requestPointerLock() {
    if (document.body.classList.contains('touch')) return;
    $('lock-prompt').classList.remove('hidden');
}
document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    const playing = gameActive && view === 'game' && me && me.alive;
    $('lock-prompt').classList.toggle('hidden', locked || !playing || document.body.classList.contains('touch'));
});
$('lock-prompt').addEventListener('click', () => { $('c').requestPointerLock(); });

// ── Input ─────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyE' && gameActive && me && me.alive && myTeam === 'hider') {
        doTransform();
    }
    if (e.code === 'KeyQ' && gameActive && me && me.alive && myTeam === 'hider') {
        doDecoy();
    }
});
addEventListener('keyup', e => { keys[e.code] = false; });

addEventListener('mousemove', e => {
    if (!document.pointerLockElement) return;
    mouseDx += e.movementX;
    mouseDy += e.movementY;
});

addEventListener('mousedown', e => {
    if (e.button !== 0 || !document.pointerLockElement || !gameActive || !me || !me.alive) return;
    if (myTeam === 'seeker' && phase === 'seeking') tryShoot();
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
    if (e.pointerId === touchLookId) touchLookId = null;
};
cvs.addEventListener('pointerup', endTouch);
cvs.addEventListener('pointercancel', endTouch);

$('touch-action').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!gameActive || !me || !me.alive) return;
    if (myTeam === 'seeker' && phase === 'seeking') tryShoot();
    else if (myTeam === 'hider') doTransform();
});
$('touch-action2').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!gameActive || !me || !me.alive) return;
    doDecoy();
});

// ── Game loop ─────────────────────────────────────────────────────────────
function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (gameActive && me && me.alive) {
        // Camera orbit
        const sens = 0.003;
        camYaw -= mouseDx * sens;
        camPitch = clamp(camPitch - mouseDy * sens * 0.3, 0.15, 1.0);
        mouseDx = 0; mouseDy = 0;

        // Movement
        const canMove = myTeam === 'hider' || (myTeam === 'seeker' && phase === 'seeking');
        if (canMove) {
            let ix = 0, iz = 0;
            if (keys.KeyW || keys.ArrowUp || joyL.y < -0.1) iz -= 1;
            if (keys.KeyS || keys.ArrowDown || joyL.y > 0.1) iz += 1;
            if (keys.KeyA || keys.ArrowLeft || joyL.x < -0.1) ix -= 1;
            if (keys.KeyD || keys.ArrowRight || joyL.x > 0.1) ix += 1;
            if (joyL.id !== null) { ix = joyL.x; iz = joyL.y; }

            if (ix || iz) {
                const len = Math.hypot(ix, iz);
                ix /= len; iz /= len;

                const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
                const mx = ix * cosY + iz * sinY;
                const mz = -ix * sinY + iz * cosY;

                const speed = myTeam === 'hider' ? HIDER_SPEED : MOVE_SPEED;
                vx = lerp(vx, mx * speed, 1 - Math.exp(-ACCEL * dt));
                vz = lerp(vz, mz * speed, 1 - Math.exp(-ACCEL * dt));

                const targetYaw = Math.atan2(mx, mz);
                me.yaw = lerpAngle(me.yaw, targetYaw, 1 - Math.exp(-12 * dt));
            } else {
                vx = lerp(vx, 0, 1 - Math.exp(-FRICTION * dt));
                vz = lerp(vz, 0, 1 - Math.exp(-FRICTION * dt));
            }

            me.x += vx * dt; me.z += vz * dt;
            constrainToRoom(me);

            // Footstep sounds
            const speed = Math.hypot(vx, vz);
            if (speed > 0.5) {
                lastStepT += dt;
                if (lastStepT > 0.4) { sfx.footstep(); lastStepT = 0; }
            } else { lastStepT = 0.3; }
        }

        // Send state
        sendTimer -= dt;
        if (sendTimer <= 0) {
            sendTimer = SEND_EVERY;
            act({ t: 'st', x: me.x, z: me.z, yaw: me.yaw });
        }

        if (shootCooldown > 0) shootCooldown -= dt;

        // Check nearest prop for interaction prompt
        if (myTeam === 'hider') checkNearestProp();

        // Third-person camera
        const playerCenter = me.propType >= 0 ? PROP_DEFS[me.propType].oy + 0.3 : 0.85;
        const camOffsetX = Math.sin(camYaw) * CAM_DIST * Math.cos(camPitch);
        const camOffsetZ = Math.cos(camYaw) * CAM_DIST * Math.cos(camPitch);
        const camOffsetY = CAM_HEIGHT * Math.sin(camPitch) + 2;

        const idealPos = new THREE.Vector3(
            me.x + camOffsetX,
            camOffsetY,
            me.z + camOffsetZ
        );
        // Clamp camera inside room
        const margin = 0.5;
        idealPos.x = clamp(idealPos.x, -ROOM_W/2 + margin, ROOM_W/2 - margin);
        idealPos.z = clamp(idealPos.z, -ROOM_H/2 + margin, ROOM_H/2 - margin);
        idealPos.y = clamp(idealPos.y, 1, WALL_H - 0.3);

        const idealTarget = new THREE.Vector3(me.x, playerCenter, me.z);

        camPos.lerp(idealPos, Math.min(1, dt * 8));
        camTarget.lerp(idealTarget, Math.min(1, dt * 10));
    } else if (!gameActive && me) {
        // Orbit overview
        const t = performance.now() * 0.0002;
        const overviewPos = new THREE.Vector3(Math.sin(t) * 18, 12, Math.cos(t) * 18);
        const overviewLook = new THREE.Vector3(0, 0, 0);
        camPos.lerp(overviewPos, Math.min(1, dt * 2));
        camTarget.lerp(overviewLook, Math.min(1, dt * 2));
    }

    camera.position.copy(camPos);
    camera.lookAt(camTarget);

    // Host updates
    if (role === 'host' && gameActive) {
        hostTimerUpdate(dt);
        updateBots(dt);
    }

    // Lerp other player meshes
    for (const [id, p] of players) {
        if (!p.alive) {
            const mesh = playerMeshes.get(id);
            if (mesh) mesh.visible = false;
            continue;
        }

        if (id !== myId && !p.bot) {
            p.x = lerp(p.x, p.targetX || p.x, 1 - Math.exp(-12 * dt));
            p.z = lerp(p.z, p.targetZ || p.z, 1 - Math.exp(-12 * dt));
            p.yaw = lerpAngle(p.yaw, p.targetYaw || p.yaw, 1 - Math.exp(-10 * dt));
        }

        const mesh = playerMeshes.get(id);
        if (mesh) {
            const oy = p.propType >= 0 ? PROP_DEFS[p.propType].oy : 0;
            mesh.position.set(p.x, oy, p.z);
            mesh.rotation.y = p.yaw;
            mesh.visible = true;
        }
    }

    updateParticles(dt);

    if (scene && camera && renderer) renderer.render(scene, camera);
}

// ── Room creation / joining ───────────────────────────────────────────────
async function createRoom(solo = false) {
    if (!solo) { if (netBusy) return; netBusy = true; }
    try {
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
            try { await net.open(roomCode); } catch (e) {
                if (e.message === 'code-taken') {
                    roomCode = makeCode();
                    try { await net.open(roomCode); } catch (e2) {
                        setStatus('menu-status', e2.message, true); role = null; return;
                    }
                } else { setStatus('menu-status', e.message, true); role = null; return; }
            }
            track('room_create');
        } else {
            net = null;
            track('play_solo');
        }

        myId = solo ? 'host' : net.peer.id;
        H.players = []; H.phase = 'lobby';
        hostHandle(myId, { t: 'hello', name });
        if (solo) for (let i = 0; i < 3; i++) addBot();

        $('room-code').textContent = roomCode;
        view = 'lobby'; show('lobby');
        setStatus('menu-status', '');
        playMusic('menu');
    } finally { if (!solo) netBusy = false; }
}

async function joinRoom() {
    unlockAudio();
    const name = $('name').value.trim() || 'Player';
    const code = $('code').value.trim().toUpperCase();
    if (!code || code.length < 3) { setStatus('menu-status', 'Enter a room code.', true); return; }
    if (netBusy) return; netBusy = true;
    try {
        myName = name;
        try { localStorage.setItem('prophuntName', name); } catch {}

        role = 'client'; document.body.classList.remove('is-host');
        net = new ClientNet({
            onMessage: clientHandle,
            onClose: () => backToMenu('Lost connection to the host.'),
            onStatus: s => setStatus('menu-status', s),
        });
        setStatus('menu-status', 'Joining...');
        try { myId = await net.connect(code); } catch (e) { setStatus('menu-status', e.message, true); role = null; return; }
        net.send({ t: 'hello', name });
        track('room_join');
        setTimeout(() => { if (view === 'menu' && role === 'client') backToMenu('Room not found or game already started.'); }, 8000);
    } finally { netBusy = false; }
}

function backToMenu(reason) {
    if (net) { net.close(); net = null; }
    role = null; myId = null; roomCode = '';
    gameActive = false; phase = 'lobby';
    players.clear();
    clearPlayerMeshes();
    clearDecoys();
    document.body.classList.remove('is-host');
    H.players = []; H.phase = 'lobby'; H.decoys = [];
    document.exitPointerLock && document.exitPointerLock();
    view = 'menu'; show('menu');
    setStatus('menu-status', reason || '', !!reason);
    playMusic('menu');
}

// ── Mute ──────────────────────────────────────────────────────────────────
function muteHandler() {
    unlockAudio();
    const m = !isMuted(); setMuted(m);
    $('icon-sound').classList.toggle('hidden', m);
    $('icon-muted').classList.toggle('hidden', !m);
    $('icon-sound-hud').classList.toggle('hidden', m);
    $('icon-muted-hud').classList.toggle('hidden', !m);
    sfx.click();
}
$('btn-mute').addEventListener('click', muteHandler);
$('btn-mute-hud').addEventListener('click', muteHandler);

// ── Events ────────────────────────────────────────────────────────────────
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
        H.phase = 'lobby'; emitLobby();
        view = 'lobby'; show('lobby'); playMusic('menu');
    }
});

// Invite link
const params = new URLSearchParams(location.search);
if (params.has('room')) {
    const code = params.get('room').toUpperCase();
    $('code').value = code;
    $('invite').textContent = `You've been invited to room ${code}`;
    $('invite').classList.remove('hidden');
    history.replaceState(null, '', location.pathname);
}

// Touch detection
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// Menu scene
function menuScene() {
    camYaw = 0; camPitch = 0.6;
    camPos.set(0, 12, 16);
    camTarget.set(0, 0, 0);
}

// ── Boot ──────────────────────────────────────────────────────────────────
$('name').value = myName;
if (isMuted()) { $('icon-sound').classList.add('hidden'); $('icon-muted').classList.remove('hidden'); }
initThree();
menuScene();
show('menu');
playMusic('menu');
gameLoop();
