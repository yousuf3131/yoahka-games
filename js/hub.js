// Yoahka Games — hub.js  (subtle Three.js background only)
// Page content is static HTML — this is purely decorative.
// If Three.js fails to load, the page still works fine.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('c');
if (!canvas) throw '';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = null; // transparent — let CSS background show through

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 30);

// Subtle bloom
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.4, 0.8));
composer.addPass(new OutputPass());

// Particles
const isMobile = innerWidth < 768;
const COUNT = isMobile ? 200 : 500;
const geo = new THREE.BufferGeometry();
const positions = new Float32Array(COUNT * 3);
const speeds = new Float32Array(COUNT);
const SPREAD = 50;

for (let i = 0; i < COUNT; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * SPREAD * 2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD * 2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20 - 10;
    speeds[i] = 0.08 + Math.random() * 0.2;
}
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// Read theme from body
const isDark = document.body.classList.contains('dark');
const pColor = isDark ? 0x6ee7b7 : 0xcc3333;

const mat = new THREE.PointsMaterial({
    color: pColor, size: 0.09, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
});
scene.add(new THREE.Points(geo, mat));

// Soft glow orbs
const orbColors = isDark ? [0x6ee7b7, 0x8b5cf6, 0x00e5ff] : [0xdd2222, 0xff6666, 0xcc0000];
for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 12),
        new THREE.MeshBasicMaterial({ color: orbColors[i], transparent: true, opacity: 0.06 })
    );
    s.position.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 20, -15);
    s.scale.setScalar(2 + Math.random() * 3);
    scene.add(s);
}

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    const pos = geo.attributes.position;
    for (let i = 0; i < COUNT; i++) {
        let y = pos.getY(i) + speeds[i] * dt;
        if (y > SPREAD) y = -SPREAD;
        pos.setY(i, y);
    }
    pos.needsUpdate = true;

    camera.position.x = Math.sin(t * 0.06) * 1;
    camera.position.y = Math.cos(t * 0.04) * 0.5;

    composer.render();
}
animate();
