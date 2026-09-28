// Yoahka Games — hub.js  (subtle Three.js background + HTML game grid)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';

// ── Game data ───────────────────────────────────────────────────────────────
const GAMES = [
    { id:'blackout',   name:'Blackout',      tags:['Horror','Multiplayer'],
      desc:'One hunter stalks 8 players through the dark. Flashlights, hiding, 4 maps.',       color:'#d0182e' },
    { id:'deadline',   name:'Deadline',      tags:['Tron','Multiplayer'],
      desc:'Neon lightcycle arena. Leave glowing trails, be the last one riding.',                color:'#00e5ff' },
    { id:'race',       name:'Bonk Racers',   tags:['Racing','Multiplayer'],
      desc:'Online kart racer. Pick a vehicle, vote on a course, bonk rivals off the road.',     color:'#eab308' },
    { id:'eyes',       name:'Eyes & Legs',   tags:['Co-op','Puzzle'],
      desc:'2-player co-op. One walks in the dark, the other sees traps and guides with pings.', color:'#14b8a6' },
    { id:'tanks',      name:'Tanks',         tags:['Strategy','Game AI'],
      desc:'3D tank battles with ricochet shots, breakable crates, mines and an 8-mission campaign.', color:'#84cc16' },
    { id:'archery',    name:'Archery Duel',  tags:['Physics','Turn-based'],
      desc:'Drag, aim, read the wind. Duel friends or climb a tournament of rival archers.',     color:'#2d8f4e' },
    { id:'draw',       name:'Drawing Duel',  tags:['Party','Canvas'],
      desc:'Draw-and-guess for up to 8 players. Brush tools, flood fill and live chat.',         color:'#f97316' },
    { id:'sumo',       name:'Sumo Smash',    tags:['Brawler','Physics'],
      desc:'Dash and push opponents off a shrinking platform. Power-ups, best of five.',         color:'#f2c14e' },
    { id:'tag',        name:'Tag Royale',    tags:['Action','Game AI'],
      desc:'Multiplayer tag. One starts as "it", sprint and dodge to be the last survivor.',     color:'#39ff14' },
    { id:'dont-look',  name:"Don't Look",    tags:['Horror','First Person'],
      desc:'The monster only moves when you look away. Activate 3 rituals and escape.',           color:'#8b5cf6' },
    { id:'lava-chain', name:'Lava Chain',    tags:['Platformer','Co-op'],
      desc:"Chained to a partner. The lava rises, platforms crumble. Don't drag them down.",     color:'#ef4444' },
];

// ── Build HTML game grid ────────────────────────────────────────────────────
const grid = document.getElementById('grid');

for (const g of GAMES) {
    const a = document.createElement('a');
    a.href = g.id + '/';
    a.className = 'game-card';
    a.innerHTML = `
        <div class="card-thumb">
            <img src="assets/${g.id}-logo.svg" alt="${g.name}">
            <div class="card-accent" style="background:${g.color}"></div>
        </div>
        <div class="card-body">
            <div class="card-name" style="color:${g.color}">${g.name}</div>
            <div class="card-desc">${g.desc}</div>
            <div class="card-tags">${g.tags.map(t => `<span class="card-tag">${t}</span>`).join('')}</div>
        </div>
    `;
    // Hover glow
    a.addEventListener('mouseenter', () => {
        a.style.boxShadow = `0 8px 32px ${g.color}22, 0 0 0 1px ${g.color}33`;
    });
    a.addEventListener('mouseleave', () => {
        a.style.boxShadow = '';
    });
    grid.appendChild(a);
}

// ── Three.js background ─────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060612);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 30);

// Post-processing — subtle bloom
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.35, 0.4, 0.75
));
composer.addPass(new OutputPass());

// ── Particles ───────────────────────────────────────────────────────────────
const isMobile = innerWidth < 768;
const COUNT = isMobile ? 300 : 600;
const geo = new THREE.BufferGeometry();
const positions = new Float32Array(COUNT * 3);
const speeds    = new Float32Array(COUNT);
const SPREAD = 60;

for (let i = 0; i < COUNT; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * SPREAD * 2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD * 2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 10;
    speeds[i] = 0.1 + Math.random() * 0.3;
}
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const mat = new THREE.PointsMaterial({
    color: 0x6ee7b7, size: 0.1, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
});
scene.add(new THREE.Points(geo, mat));

// ── Soft glow orbs ──────────────────────────────────────────────────────────
const orbColors = [0x6ee7b7, 0x8b5cf6, 0x00e5ff, 0xef4444];
const orbs = [];
for (let i = 0; i < orbColors.length; i++) {
    const s = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 16, 16),
        new THREE.MeshBasicMaterial({ color: orbColors[i], transparent: true, opacity: 0.08 })
    );
    s.position.set(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 20,
        -15 + Math.random() * 10
    );
    s.scale.setScalar(2 + Math.random() * 3);
    scene.add(s);
    orbs.push({ mesh: s, sx: Math.random() * 0.15 + 0.05, sy: Math.random() * 0.1 + 0.03, ox: Math.random() * 100, oy: Math.random() * 100 });
}

// ── Resize ──────────────────────────────────────────────────────────────────
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
});

// ── Animate ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t  = clock.elapsedTime;

    // Drift particles upward
    const pos = geo.attributes.position;
    for (let i = 0; i < COUNT; i++) {
        let y = pos.getY(i) + speeds[i] * dt;
        if (y > SPREAD) y = -SPREAD;
        pos.setY(i, y);
    }
    pos.needsUpdate = true;

    // Gently move orbs
    for (const o of orbs) {
        o.mesh.position.x += Math.sin(t * o.sx + o.ox) * dt * 0.5;
        o.mesh.position.y += Math.cos(t * o.sy + o.oy) * dt * 0.3;
    }

    // Slow camera sway
    camera.position.x = Math.sin(t * 0.08) * 1.5;
    camera.position.y = Math.cos(t * 0.06) * 0.8;

    composer.render();
}

animate();
