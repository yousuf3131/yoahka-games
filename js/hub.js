// Yoahka Games — hub.js  (Three.js animated homepage)
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

// ── DOM refs ────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('c');
const titleEl  = document.getElementById('title');
const infoEl   = document.getElementById('info');
const infoName = document.getElementById('info-name');
const infoDesc = document.getElementById('info-desc');
const infoTags = document.getElementById('info-tags');
const infoLink = document.getElementById('info-link');
const infoBack = document.getElementById('info-back');
const hintEl   = document.getElementById('hint');

// ── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// ── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060612);
scene.fog = new THREE.FogExp2(0x060612, 0.018);

// ── Camera ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
const CAM_DEFAULT = new THREE.Vector3(0, 3, 26);
const CAM_LOOK_DEFAULT = new THREE.Vector3(0, 0, 0);
camera.position.copy(CAM_DEFAULT);
camera.lookAt(CAM_LOOK_DEFAULT);

// ── Post-processing ─────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.5, 0.3, 0.65
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Lights ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x222244, 0.6));

const orbitLights = [];
const lightColors = [0x6ee7b7, 0x8b5cf6, 0x00e5ff];
for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(lightColors[i], 40, 50);
    l.position.set(0, 2, 0);
    scene.add(l);
    orbitLights.push({ light: l, radius: 16 + i * 4, speed: 0.12 + i * 0.07, offset: i * Math.PI * 2 / 3 });
}

// ── Ground grid ─────────────────────────────────────────────────────────────
const gridGeo = new THREE.PlaneGeometry(120, 120, 60, 60);
gridGeo.rotateX(-Math.PI / 2);
const gridMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {},
    vertexShader: `
        varying vec2 vUv;
        varying float vDist;
        void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vDist = length(wp.xz);
            gl_Position = projectionMatrix * viewMatrix * wp;
        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        varying float vDist;
        void main() {
            vec2 g = abs(fract(vUv * 30.0) - 0.5);
            float line = min(g.x, g.y);
            float edge = fwidth(line);
            float grid = 1.0 - smoothstep(0.0, edge * 2.0, line);
            float fade = 1.0 - smoothstep(8.0, 50.0, vDist);
            gl_FragColor = vec4(0.3, 0.8, 0.6, grid * fade * 0.12);
        }
    `,
});
const gridMesh = new THREE.Mesh(gridGeo, gridMat);
gridMesh.position.y = -8;
scene.add(gridMesh);

// ── Particles ───────────────────────────────────────────────────────────────
const isMobile = innerWidth < 768;
const PARTICLE_COUNT = isMobile ? 500 : 1000;
const pGeo = new THREE.BufferGeometry();
const pPositions = new Float32Array(PARTICLE_COUNT * 3);
const pVelocities = new Float32Array(PARTICLE_COUNT);
const FIELD_R = 55;

for (let i = 0; i < PARTICLE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = Math.random() * FIELD_R;
    pPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) - 2;
    pPositions[i * 3 + 2] = r * Math.cos(phi);
    pVelocities[i] = 0.2 + Math.random() * 0.5;
}
pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));

const pMat = new THREE.PointsMaterial({
    color: 0xaaddff, size: 0.12, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
});
const particles = new THREE.Points(pGeo, pMat);
scene.add(particles);

// ── Ring of game cards ──────────────────────────────────────────────────────
const RING_R = 12;
const ring = new THREE.Group();
scene.add(ring);

const cards = [];  // { mesh, glow, game, baseAngle }
let cardsLoaded = 0;

function loadSVGTexture(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const w = 512, h = 288;
            const cvs = document.createElement('canvas');
            cvs.width = w; cvs.height = h;
            const cx = cvs.getContext('2d');
            // Dark card background
            cx.fillStyle = '#0a0a18';
            cx.beginPath();
            cx.roundRect(0, 0, w, h, 16);
            cx.fill();
            // Draw SVG centered
            const scale = Math.min((w - 32) / img.naturalWidth, (h - 32) / img.naturalHeight);
            const dw = img.naturalWidth * scale;
            const dh = img.naturalHeight * scale;
            cx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            const tex = new THREE.CanvasTexture(cvs);
            tex.colorSpace = THREE.SRGBColorSpace;
            resolve(tex);
        };
        img.onerror = () => {
            // Fallback: plain dark card
            const cvs = document.createElement('canvas');
            cvs.width = 512; cvs.height = 288;
            const cx = cvs.getContext('2d');
            cx.fillStyle = '#0a0a18';
            cx.fillRect(0, 0, 512, 288);
            const tex = new THREE.CanvasTexture(cvs);
            tex.colorSpace = THREE.SRGBColorSpace;
            resolve(tex);
        };
        img.src = url;
    });
}

async function buildCards() {
    for (let i = 0; i < GAMES.length; i++) {
        const game = GAMES[i];
        const angle = (i / GAMES.length) * Math.PI * 2;

        const tex = await loadSVGTexture(`assets/${game.id}-logo.svg`);

        // Card face
        const geo = new THREE.PlaneGeometry(3.8, 2.14);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);

        // Position in ring
        mesh.position.set(
            Math.sin(angle) * RING_R,
            0,
            Math.cos(angle) * RING_R
        );

        // Glow backing (slightly larger, behind)
        const glowGeo = new THREE.PlaneGeometry(4.2, 2.5);
        const col = new THREE.Color(game.color);
        const glowMat = new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.z = -0.05;
        mesh.add(glow);

        // Border frame
        const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.9, 2.2));
        const borderMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 });
        const border = new THREE.LineSegments(borderGeo, borderMat);
        border.position.z = 0.01;
        mesh.add(border);

        ring.add(mesh);
        cards.push({ mesh, glow, border, game, baseAngle: angle, targetScale: 1 });

        cardsLoaded++;
    }
}

buildCards();

// ── Interaction state ───────────────────────────────────────────────────────
let mode = 'overview';  // 'overview' | 'focused'
let focusedCard = null;
let hoveredCard = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-999, -999);

// Ring rotation
let ringAngle = 0;
let ringVelocity = 0.12;  // rad/s auto-rotation
let dragStart = null;
let dragAngleStart = 0;
let isDragging = false;

// Camera lerp targets
const camPos = new THREE.Vector3().copy(CAM_DEFAULT);
const camLook = new THREE.Vector3().copy(CAM_LOOK_DEFAULT);

// ── Pointer events ──────────────────────────────────────────────────────────
function updatePointer(e) {
    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    const y = e.clientY ?? (e.touches && e.touches[0]?.clientY);
    if (x == null) return;
    pointer.x = (x / innerWidth) * 2 - 1;
    pointer.y = -(y / innerHeight) * 2 + 1;
}

canvas.addEventListener('pointermove', e => {
    updatePointer(e);
    if (mode === 'overview' && isDragging && dragStart !== null) {
        const dx = (e.clientX - dragStart) / innerWidth * 3;
        ringAngle = dragAngleStart - dx;
    }
});

canvas.addEventListener('pointerdown', e => {
    updatePointer(e);
    dragStart = e.clientX;
    dragAngleStart = ringAngle;
    isDragging = false;
});

canvas.addEventListener('pointerup', e => {
    if (dragStart !== null && Math.abs(e.clientX - dragStart) > 15) {
        isDragging = true;
        dragStart = null;
        return;
    }
    dragStart = null;

    if (mode === 'overview') {
        // Raycast to find clicked card
        raycaster.setFromCamera(pointer, camera);
        const meshes = cards.map(c => c.mesh);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            const card = cards.find(c => c.mesh === hits[0].object);
            if (card) focusOnCard(card);
        }
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mode === 'focused') unfocus();
});

infoBack.addEventListener('click', unfocus);

// ── Focus / unfocus ─────────────────────────────────────────────────────────
function focusOnCard(card) {
    mode = 'focused';
    focusedCard = card;

    // Camera target: 4 units in front of the card (in world space)
    const wp = new THREE.Vector3();
    card.mesh.getWorldPosition(wp);
    const dir = wp.clone().normalize();
    camPos.copy(wp).add(dir.multiplyScalar(4.5));
    camPos.y = wp.y + 0.5;
    camLook.copy(wp);

    // Fill info panel
    const g = card.game;
    infoName.textContent = g.name;
    infoName.style.color = g.color;
    infoDesc.textContent = g.desc;
    infoTags.innerHTML = g.tags.map(t => `<span class="info-tag">${t}</span>`).join('');
    infoLink.href = g.id + '/';
    infoEl.classList.remove('hidden');
    titleEl.style.opacity = '0';
    hintEl.style.opacity = '0';
}

function unfocus() {
    mode = 'overview';
    focusedCard = null;
    camPos.copy(CAM_DEFAULT);
    camLook.copy(CAM_LOOK_DEFAULT);
    infoEl.classList.add('hidden');
    titleEl.style.opacity = '';
    hintEl.style.opacity = '';
}

// ── Resize ──────────────────────────────────────────────────────────────────
function onResize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
}
addEventListener('resize', onResize);

// ── Animate ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t  = clock.elapsedTime;

    // ── Ring rotation (auto-rotate in overview) ──
    if (mode === 'overview' && !dragStart) {
        ringAngle += ringVelocity * dt;
    }
    ring.rotation.y = ringAngle;

    // ── Card animation ──
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const m = c.mesh;

        // Bob
        m.position.y = Math.sin(t * 0.8 + i * 1.7) * 0.3;

        // Billboard: face camera in world space
        const wp = new THREE.Vector3();
        m.getWorldPosition(wp);
        const lookTarget = camera.position.clone();
        lookTarget.y = wp.y;
        // Convert to local space of parent (ring group)
        const localLook = ring.worldToLocal(lookTarget.clone());
        m.lookAt(localLook);

        // Hover detection (overview only)
        let isHovered = false;
        if (mode === 'overview' && cardsLoaded === GAMES.length) {
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster.intersectObject(m, false);
            isHovered = hit.length > 0;
        }

        // Scale
        const ts = (mode === 'focused' && focusedCard === c) ? 1.15
                 : isHovered ? 1.1 : 1.0;
        const s = m.scale.x + (ts - m.scale.x) * Math.min(1, dt * 8);
        m.scale.setScalar(s);

        // Glow intensity
        const glowTarget = (mode === 'focused' && focusedCard === c) ? 0.35
                         : isHovered ? 0.28 : 0.12;
        c.glow.material.opacity += (glowTarget - c.glow.material.opacity) * Math.min(1, dt * 6);

        // Border brightness
        const borderTarget = isHovered || (mode === 'focused' && focusedCard === c) ? 0.9 : 0.35;
        c.border.material.opacity += (borderTarget - c.border.material.opacity) * Math.min(1, dt * 6);

        if (isHovered) hoveredCard = c;
    }

    // Cursor style
    canvas.style.cursor = (mode === 'overview' && hoveredCard) ? 'pointer' : '';
    hoveredCard = null;

    // ── Particles ──
    const pos = pGeo.attributes.position;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        let y = pos.getY(i) + pVelocities[i] * dt;
        if (y > FIELD_R) y = -FIELD_R;
        pos.setY(i, y);
    }
    pos.needsUpdate = true;
    particles.rotation.y = t * 0.01;

    // ── Orbit lights ──
    for (const ol of orbitLights) {
        const a = t * ol.speed + ol.offset;
        ol.light.position.set(
            Math.sin(a) * ol.radius,
            3 + Math.sin(a * 0.7) * 3,
            Math.cos(a) * ol.radius
        );
    }

    // ── Camera lerp ──
    camera.position.lerp(camPos, Math.min(1, dt * 3.5));
    // Smooth look-at via intermediate target
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook).multiplyScalar(10).add(camera.position);
    currentLook.lerp(camLook, Math.min(1, dt * 3.5));
    camera.lookAt(currentLook);

    // ── Render ──
    composer.render();
}

animate();
