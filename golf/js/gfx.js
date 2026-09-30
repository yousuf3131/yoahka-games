// Mini Golf — Three.js rendering: sky, lighting, procedural textures, course meshes, fx, camera.
import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALL_R, CUP_R, heightAt, windmillAngle, moverPos, polyArea } from './course.js?v=1';

export let renderer, scene, camera;
let sun, hemi, holeGroup = null, curHole = null;
const TEX = {}, MAT = {};
const RAIL_W = 0.12, RAIL_H = 0.16;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ── Init ───────────────────────────────────────────────────────────────────
export function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.75 : 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe6f3, 45, 170);
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 900);

    buildSky();
    makeTextures();
    makeMaterials();

    sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    hemi = new THREE.HemisphereLight(0xd6ecff, 0x5d7f3c, 0.6);
    scene.add(hemi);

    buildFxPools();

    addEventListener('resize', () => {
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
    });
}

// ── Sky (gradient dome + sun glow), also used as the reflection environment ─
function buildSky() {
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
            top: { value: new THREE.Color(0x3d8ee0) }, mid: { value: new THREE.Color(0x9fd0f5) },
            horizon: { value: new THREE.Color(0xe4f2fb) }, sunDir: { value: new THREE.Vector3(-0.5, 0.55, 0.35).normalize() },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top, mid, horizon, sunDir; varying vec3 vDir;
            void main(){
                float y = vDir.y;
                vec3 c = y > 0.0 ? mix(horizon, mid, smoothstep(0.0, 0.18, y)) : horizon;
                c = mix(c, top, smoothstep(0.18, 0.75, y));
                float s = max(dot(normalize(vDir), sunDir), 0.0);
                c += vec3(1.0, 0.93, 0.78) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.22);
                gl_FragColor = vec4(c, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), skyMat);
    scene.add(dome);

    // Reflections: render the sky (plus a green floor) into a PMREM env map
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: 0x4f7f3a }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -2; envScene.add(floor);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    // Soft clouds
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdde9f2, emissiveIntensity: 0.55, fog: false });
    const puff = new THREE.IcosahedronGeometry(1, 2);
    const parts = [];
    for (let c = 0; c < 9; c++) {
        const a = c / 9 * Math.PI * 2 + Math.random() * 0.4, r = 220 + Math.random() * 160;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 60 + Math.random() * 50;
        for (let i = 0; i < 6; i++) {
            const g = puff.clone(), s = 9 + Math.random() * 10;
            g.scale(s * 1.4, s * 0.75, s);
            g.translate(cx + (Math.random() - 0.5) * 40, cy + Math.random() * 6, cz + (Math.random() - 0.5) * 20);
            parts.push(g);
        }
    }
    clouds = new THREE.Mesh(mergeGeometries(parts), cloudMat);
    scene.add(clouds);
}
let clouds;

// ── Procedural textures ────────────────────────────────────────────────────
function canvasTex(size, draw, { srgb = true, repeat = true } = {}) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function speckle(g, s, n, cols, rMin, rMax) {
    for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; const r = rnd(rMin, rMax); g.fillRect(rnd(0, s), rnd(0, s), r, r); }
}
function makeTextures() {
    // Felt with mowing stripes
    TEX.felt = canvasTex(512, (g, s) => {
        g.fillStyle = '#3aa04a'; g.fillRect(0, 0, s, s);
        g.fillStyle = 'rgba(255,255,255,0.055)'; g.fillRect(0, 0, s, s / 2);
        speckle(g, s, 26000, ['rgba(20,70,25,0.35)', 'rgba(120,200,110,0.22)', 'rgba(40,120,50,0.4)'], 1, 2.2);
    });
    TEX.feltBump = canvasTex(256, (g, s) => {
        g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
        speckle(g, s, 14000, ['#6a6a6a', '#999', '#777'], 1, 2);
    }, { srgb: false });
    TEX.grass = canvasTex(512, (g, s) => {
        g.fillStyle = '#4f8a36'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 70; i++) {
            const x = rnd(0, s), y = rnd(0, s), r = rnd(20, 70);
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            const c = Math.random() < 0.5 ? '70,125,45' : '95,150,55';
            gr.addColorStop(0, `rgba(${c},0.35)`); gr.addColorStop(1, `rgba(${c},0)`);
            g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        speckle(g, s, 30000, ['rgba(30,70,20,0.45)', 'rgba(140,190,80,0.3)', 'rgba(60,110,35,0.5)'], 1, 3);
    });
    TEX.wood = canvasTex(256, (g, s) => {
        g.fillStyle = '#d9a86c'; g.fillRect(0, 0, s, s);
        for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(120,70,30,${rnd(0.03, 0.14)})`; g.fillRect(0, y, s, rnd(1, 2)); }
        for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(90,50,20,0.25)'; g.fillRect(0, rnd(0, s), s, 1); }
        g.fillStyle = 'rgba(80,45,20,0.5)'; for (let x = 0; x < s; x += 64) g.fillRect(x, 0, 2, s);
    });
    TEX.stone = canvasTex(256, (g, s) => {
        g.fillStyle = '#9d948a'; g.fillRect(0, 0, s, s);
        const bh = 32, bw = 64;
        for (let row = 0; row < s / bh; row++) for (let col = -1; col < s / bw + 1; col++) {
            const x = col * bw + (row % 2) * bw / 2, y = row * bh;
            const v = rnd(-18, 18) | 0;
            g.fillStyle = `rgb(${160 + v},${150 + v},${138 + v})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        }
        speckle(g, s, 5000, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)'], 1, 2);
    });
    TEX.sand = canvasTex(256, (g, s) => {
        g.fillStyle = '#e6cf94'; g.fillRect(0, 0, s, s);
        speckle(g, s, 16000, ['rgba(160,120,60,0.35)', 'rgba(255,245,210,0.5)', 'rgba(190,150,90,0.3)'], 1, 2);
    });
    TEX.hazard = canvasTex(128, (g, s) => {
        g.fillStyle = '#facc15'; g.fillRect(0, 0, s, s);
        g.fillStyle = '#1f2937';
        for (let i = -s; i < s * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - s, s); g.lineTo(i - s, s); g.fill(); }
    });
    TEX.cup = canvasTex(64, (g, s) => {
        const gr = g.createLinearGradient(0, 0, 0, s);
        gr.addColorStop(0, '#f1f5f9'); gr.addColorStop(0.18, '#cbd5e1'); gr.addColorStop(0.22, '#334155'); gr.addColorStop(1, '#0f172a');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, { repeat: false });
    TEX.dimple = canvasTex(256, (g, s) => {
        g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
        g.fillStyle = '#555';
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            g.beginPath(); g.arc((x + (y % 2) * 0.5) * s / 16, (y + 0.5) * s / 16, s / 44, 0, Math.PI * 2); g.fill();
        }
    }, { srgb: false });
    TEX.blob = canvasTex(64, (g, s) => {
        const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, { repeat: false });
    // Tileable water normals from integer-frequency sines
    TEX.water = (() => {
        const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
        const g = cv.getContext('2d'), img = g.createImageData(s, s);
        const waves = Array.from({ length: 7 }, () => ({ fx: (Math.random() * 6 | 0) + 1, fy: (Math.random() * 6 | 0) + 1, p: Math.random() * 6.28, a: rnd(0.4, 1) }));
        const H = (x, y) => waves.reduce((h, w) => h + w.a * Math.sin((w.fx * x + w.fy * y) / s * Math.PI * 2 + w.p), 0);
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
            const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize(), i = (y * s + x) * 4;
            img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
}
function makeMaterials() {
    MAT.felt = new THREE.MeshStandardMaterial({ map: TEX.felt, bumpMap: TEX.feltBump, bumpScale: 0.35, roughness: 0.95, metalness: 0 });
    MAT.sand = new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MAT.wood = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.6, metalness: 0 });
    MAT.stone = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.9 });
    MAT.grass = new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 });
    MAT.white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    MAT.dark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    MAT.hazard = new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.5 });
    MAT.cup = new THREE.MeshStandardMaterial({ map: TEX.cup, side: THREE.BackSide, roughness: 0.4, metalness: 0.3 });
    MAT.cupBottom = new THREE.MeshBasicMaterial({ color: 0x0b1220 });
    MAT.water = new THREE.MeshStandardMaterial({ color: 0x1b8db3, roughness: 0.06, metalness: 0.05, normalMap: TEX.water,
        normalScale: new THREE.Vector2(0.14, 0.14), transparent: true, opacity: 0.88 });
    MAT.lakebed = new THREE.MeshStandardMaterial({ color: 0x2c5e55, roughness: 1 });
    MAT.trunk = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
    MAT.leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    MAT.rock = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.85, flatShading: true });
    MAT.tuft = new THREE.MeshStandardMaterial({ color: 0x5f9a3c, roughness: 1 });
    MAT.flower = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    MAT.blob = new THREE.MeshBasicMaterial({ map: TEX.blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    MAT.mat = new THREE.MeshStandardMaterial({ color: 0x2b7a3d, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    MAT.roof = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.6, flatShading: true });
    MAT.sail = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8, side: THREE.DoubleSide });
}

// ── Geometry helpers ───────────────────────────────────────────────────────
// Surface mesh for a polygon, draped over the hole's height field
function surfaceGeo(h, poly, holes = [], yOff = 0, uvScale = 0.25) {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
    for (const hp of holes) shape.holes.push(hp);
    let g = new THREE.ShapeGeometry(shape, 40).toNonIndexed();
    g = new TessellateModifier(0.3, 14).modify(g);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { const x = p[i], z = p[i + 1]; p[i] = x; p[i + 1] = heightAt(h, x, z) + yOff; p[i + 2] = z; }
    // Shape space → XZ mirrors the winding; flip so faces point up
    for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    g = mergeVertices(g, 1e-4);
    const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * uvScale; uv[i * 2 + 1] = pos.getZ(i) * uvScale; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
}

// Collects quads with a desired facing, builds one BufferGeometry
class QuadBuilder {
    constructor() { this.p = []; this.uv = []; }
    quad(a, b, c, d, want, uva, uvb, uvc, uvd) {
        const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
        const n = ab.cross(ac);
        const tri = (x, y, z, ux, uy, uz) => { this.p.push(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z); this.uv.push(...ux, ...uy, ...uz); };
        if (n.dot(want) >= 0) { tri(a, b, c, uva, uvb, uvc); tri(a, c, d, uva, uvc, uvd); }
        else { tri(a, c, b, uva, uvc, uvb); tri(a, d, c, uva, uvd, uvc); }
    }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.computeVertexNormals();
        return g;
    }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Offset polygon where each edge moves outward by its own distance
function offsetPoly(poly, dists, sign) {
    const n = poly.length, lines = [];
    for (let i = 0; i < n; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
        const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
        const nx = dz * sign, nz = -dx * sign;
        lines.push({ x: x0 + nx * dists[i], z: z0 + nz * dists[i], dx, dz, nx, nz });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const A = lines[(i - 1 + n) % n], B = lines[i];
        const den = A.dx * B.dz - A.dz * B.dx;
        if (Math.abs(den) < 1e-6) { out.push([B.x, B.z]); continue; }
        const t = ((B.x - A.x) * B.dz - (B.z - A.z) * B.dx) / den;
        out.push([A.x + A.dx * t, A.z + A.dz * t]);
    }
    return { pts: out, lines };
}

// ── Build a hole ───────────────────────────────────────────────────────────
const dyn = { windmill: null, movers: [], bumpers: [], flag: null, flagPole: null, flagLift: 0, waterMat: null };

export function buildHole(h) {
    if (holeGroup) { disposeGroup(holeGroup); scene.remove(holeGroup); }
    holeGroup = new THREE.Group(); scene.add(holeGroup);
    curHole = h;
    dyn.movers = []; dyn.bumpers = []; dyn.windmill = null;
    const accent = new THREE.Color(h.accent);
    const accentMat = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
    const groundY = h.minH - 0.32;
    const sign = polyArea(h.shape) > 0 ? 1 : -1;
    const add = (geo, mat, shadow = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = recv; holeGroup.add(m); return m; };

    // Fairway with a real cup hole
    const cupPath = new THREE.Path(); cupPath.absarc(h.cup[0], h.cup[1], CUP_R, 0, Math.PI * 2, true);
    add(surfaceGeo(h, h.shape, [cupPath]), MAT.felt, false, true);
    for (const s of h.sand) add(surfaceGeo(h, s, [], 0.004, 0.5), MAT.sand, false, true);

    // Rails + skirt
    const dists = h.shape.map((_, i) => h.open.has(i) ? 0 : RAIL_W);
    const { pts: outer, lines } = offsetPoly(h.shape, dists, sign);
    const baseY = h.water ? groundY - 0.7 : groundY;
    const rails = new QuadBuilder(), skirt = new QuadBuilder();
    const n = h.shape.length;
    const postGeo = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, P0 = h.shape[i], P1 = h.shape[j], O0 = outer[i], O1 = outer[j];
        const railed = !h.open.has(i), L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
        const seg = Math.max(1, Math.ceil(L / 0.4)), out = V(lines[i].nx, 0, lines[i].nz), inward = out.clone().negate();
        let u0 = 0;
        for (let k = 0; k < seg; k++) {
            const t0 = k / seg, t1 = (k + 1) / seg;
            const ix0 = P0[0] + (P1[0] - P0[0]) * t0, iz0 = P0[1] + (P1[1] - P0[1]) * t0;
            const ix1 = P0[0] + (P1[0] - P0[0]) * t1, iz1 = P0[1] + (P1[1] - P0[1]) * t1;
            const ox0 = O0[0] + (O1[0] - O0[0]) * t0, oz0 = O0[1] + (O1[1] - O0[1]) * t0;
            const ox1 = O0[0] + (O1[0] - O0[0]) * t1, oz1 = O0[1] + (O1[1] - O0[1]) * t1;
            const h0 = heightAt(h, ix0, iz0), h1 = heightAt(h, ix1, iz1);
            const top0 = railed ? h0 + RAIL_H : h0, top1 = railed ? h1 + RAIL_H : h1;
            const u1 = u0 + L / seg;
            if (railed) {
                rails.quad(V(ix0, top0, iz0), V(ox0, top0, oz0), V(ox1, top1, oz1), V(ix1, top1, iz1), V(0, 1, 0),
                    [u0, 0], [u0, 0.25], [u1, 0.25], [u1, 0]);
                rails.quad(V(ix0, h0 - 0.01, iz0), V(ix1, h1 - 0.01, iz1), V(ix1, top1, iz1), V(ix0, top0, iz0), inward,
                    [u0, 0.3], [u1, 0.3], [u1, 0.62], [u0, 0.62]);
            }
            skirt.quad(V(ox0, baseY, oz0), V(ox1, baseY, oz1), V(ox1, top1, oz1), V(ox0, top0, oz0), out,
                [u0 * 0.5, baseY * 0.5], [u1 * 0.5, baseY * 0.5], [u1 * 0.5, top1 * 0.5], [u0 * 0.5, top0 * 0.5]);
            u0 = u1;
        }
        if (railed) {
            // End caps where a rail meets an open (water) edge
            const dir = V(P1[0] - P0[0], 0, P1[1] - P0[1]).normalize();
            const cap = (P, O, want) => { const y = heightAt(h, P[0], P[1]);
                rails.quad(V(P[0], y - 0.01, P[1]), V(O[0], y - 0.01, O[1]), V(O[0], y + RAIL_H, O[1]), V(P[0], y + RAIL_H, P[1]), want, [0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]); };
            if (h.open.has(j)) cap(P1, O1, dir);
            if (h.open.has((i - 1 + n) % n)) cap(P0, O0, dir.clone().negate());
            // Rounded post at each railed corner
            const mx = (P0[0] + O0[0]) / 2, mz = (P0[1] + O0[1]) / 2, y = heightAt(h, P0[0], P0[1]) + RAIL_H;
            const pg = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20); pg.translate(mx, y + 0.015, mz);
            const cg = new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); cg.scale(1, 0.6, 1); cg.translate(mx, y + 0.03, mz);
            postGeo.push(pg, cg);
        }
    }
    add(rails.build(), MAT.wood);
    add(skirt.build(), MAT.stone, true, true);
    if (postGeo.length) add(mergeGeometries(postGeo), accentMat);

    // Blocks
    for (const b of h.blocks) {
        const shape = new THREE.Shape(b.map(([x, z]) => new THREE.Vector2(x, -z)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 2 });
        g.rotateX(-Math.PI / 2);
        const y = Math.min(...b.map(([x, z]) => heightAt(h, x, z))) - 0.01;
        g.translate(0, y, 0);
        add(g, MAT.stone);
    }

    // Bumpers
    for (const bp of h.bumpers) {
        const grp = new THREE.Group(), y = heightAt(h, bp.x, bp.z);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(bp.r, bp.r * 1.04, 0.22, 32), accentMat); body.position.y = 0.11;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(bp.r + 0.01, 0.035, 10, 40), MAT.dark); ring.rotation.x = Math.PI / 2; ring.position.y = 0.09;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(bp.r * 0.72, bp.r * 0.72, 0.03, 32), MAT.white); cap.position.y = 0.23;
        for (const m of [body, ring, cap]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
        grp.position.set(bp.x, y, bp.z);
        holeGroup.add(grp); dyn.bumpers.push({ grp, pulse: 0 });
    }

    // Movers
    for (const m of h.movers) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(m.w, 0.24, m.d), MAT.hazard);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.set(m.x, heightAt(h, m.x, m.z) + 0.12, m.z);
        holeGroup.add(mesh); dyn.movers.push({ m, mesh });
    }

    // Windmill
    if (h.windmill) buildWindmill(h, accentMat);

    // Cup liner + flag
    const cy = heightAt(h, h.cup[0], h.cup[1]);
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R, CUP_R, 0.24, 40, 1, true), MAT.cup);
    liner.position.set(h.cup[0], cy - 0.12, h.cup[1]); holeGroup.add(liner);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 40), MAT.cupBottom);
    bottom.rotation.x = -Math.PI / 2; bottom.position.set(h.cup[0], cy - 0.235, h.cup[1]); holeGroup.add(bottom);
    buildFlag(h, cy, accent);

    // Tee mat
    const tee = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), MAT.mat);
    tee.rotation.x = -Math.PI / 2; tee.position.set(h.tee[0], heightAt(h, h.tee[0], h.tee[1]) + 0.003, h.tee[1]);
    tee.receiveShadow = true; holeGroup.add(tee);
    for (const sx of [-0.45, 0.45]) {
        const mk = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8), accentMat);
        mk.position.set(h.tee[0] + sx, heightAt(h, h.tee[0] + sx, h.tee[1]) + 0.03, h.tee[1] + 0.25);
        mk.castShadow = true; holeGroup.add(mk);
    }

    // Ground / lake
    const B = h.bounds, lakeR = B.r + 4.5;
    if (h.water) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(lakeR, 260, 96, 1), MAT.grass);
        ring.rotation.x = -Math.PI / 2; ring.position.set(B.cx, groundY, B.cz); ring.receiveShadow = true; holeGroup.add(ring);
        setGrassUV(ring.geometry, B.cx, B.cz);
        const bed = new THREE.Mesh(new THREE.CircleGeometry(lakeR + 0.5, 64), MAT.lakebed);
        bed.rotation.x = -Math.PI / 2; bed.position.set(B.cx, groundY - 0.9, B.cz); holeGroup.add(bed);
        const water = new THREE.Mesh(new THREE.CircleGeometry(lakeR + 0.4, 96), MAT.water);
        water.rotation.x = -Math.PI / 2; water.position.set(B.cx, groundY - 0.05, B.cz); water.receiveShadow = true; holeGroup.add(water);
        MAT.water.normalMap.repeat.set(lakeR / 1.2, lakeR / 1.2);
        dyn.waterY = groundY - 0.05;
    } else {
        const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 96), MAT.grass);
        ground.rotation.x = -Math.PI / 2; ground.position.set(B.cx, groundY, B.cz); ground.receiveShadow = true; holeGroup.add(ground);
        setGrassUV(ground.geometry, B.cx, B.cz);
        dyn.waterY = null;
    }
    buildDecor(h, groundY, h.water ? lakeR + 1.2 : B.r + 2.2);

    // Fit the shadow camera to this hole
    const R = B.r + 4;
    sun.position.set(B.cx - 14, 22, B.cz + 10);
    sun.target.position.set(B.cx, 0, B.cz);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 60;
    sc.updateProjectionMatrix();
}

function setGrassUV(g, cx, cz) {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + cx) / 7, (p.getY(i) + cz) / 7);
    uv.needsUpdate = true;
}

function buildWindmill(h, accentMat) {
    const wm = h.windmill, y0 = heightAt(h, wm.x, wm.z);
    const grp = new THREE.Group(); grp.position.set(wm.x, y0, wm.z);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfaf5eb, roughness: 0.8 });
    const W = 2.2, D = wm.depth + 0.1, Hh = 1.25, zc = -wm.depth / 2;
    const box = (w, hh, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; grp.add(m); return m; };
    const side = (W / 2 - wm.gap);
    box(side, Hh, D, -(wm.gap + side / 2), Hh / 2, zc, wallMat);
    box(side, Hh, D, (wm.gap + side / 2), Hh / 2, zc, wallMat);
    box(wm.gap * 2, Hh - 0.42, D, 0, 0.42 + (Hh - 0.42) / 2, zc, wallMat);
    // Timber trim
    for (const x of [-W / 2, W / 2]) box(0.07, Hh, 0.07, x, Hh / 2, 0.02, MAT.wood);
    box(W + 0.07, 0.07, 0.07, 0, Hh, 0.02, MAT.wood);
    box(wm.gap * 2 + 0.1, 0.06, 0.06, 0, 0.42, 0.03, MAT.wood);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(W * 0.78, 0.95, 4), MAT.roof);
    roof.rotation.y = Math.PI / 4; roof.scale.z = D / W * 1.3; roof.position.set(0, Hh + 0.47, zc);
    roof.castShadow = true; grp.add(roof);
    // Blades
    const hub = new THREE.Group(); hub.position.set(0, 1.2, 0.14); grp.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 20), accentMat); cap.rotation.x = Math.PI / 2; cap.castShadow = true; hub.add(cap);
    for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2;
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.04), MAT.wood); spar.position.y = 0.55;
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.8), MAT.sail); sail.position.set(0.14, 0.62, 0);
        for (const m of [spar, sail]) { m.castShadow = true; arm.add(m); }
        hub.add(arm);
    }
    holeGroup.add(grp);
    dyn.windmill = hub;
}

function buildFlag(h, cy, accent) {
    const pole = new THREE.Group(); pole.position.set(h.cup[0], cy, h.cup[1]);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.55, 10), MAT.white); stick.position.y = 0.55; stick.castShadow = true; pole.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.6, roughness: 0.3 })); knob.position.y = 1.33; pole.add(knob);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3, 14, 6),
        new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide, roughness: 0.7 }));
    cloth.geometry.translate(0.23 + 0.013, 0, 0);
    cloth.position.y = 1.15; cloth.castShadow = true; pole.add(cloth);
    cloth.userData.base = cloth.geometry.attributes.position.array.slice();
    holeGroup.add(pole);
    dyn.flag = cloth; dyn.flagPole = pole; dyn.flagY = cy; dyn.flagLift = 0;
}

// ── Decor: trees, bushes, rocks, flowers, grass tufts (instanced) ─────────
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildDecor(h, gy, minR) {
    const B = h.bounds, R = mulberry(h.name.length * 7919 + Math.round(B.r * 100));
    const spot = (r0, r1) => { const a = R() * Math.PI * 2, r = r0 + Math.sqrt(R()) * (r1 - r0); return [B.cx + Math.cos(a) * r, B.cz + Math.sin(a) * r]; };
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
    const inst = (geo, mat, count, shadow) => { const m = new THREE.InstancedMesh(geo, mat, count); m.castShadow = shadow; m.receiveShadow = true; holeGroup.add(m); return m; };

    const nTrees = 46;
    const trunk = inst(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 7).translate(0, 0.7, 0), MAT.trunk, nTrees, true);
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const leaves = inst(leafGeo, MAT.leaf, nTrees * 3, true);
    const pineGeo = new THREE.ConeGeometry(1, 1.6, 8);
    const pines = inst(pineGeo, MAT.leaf, nTrees * 3, true);
    let li = 0, pi = 0;
    for (let i = 0; i < nTrees; i++) {
        const [x, z] = spot(minR + 1.5, minR + 26), s = 0.8 + R() * 0.7, pine = R() < 0.35;
        M4.compose(P.set(x, gy, z), Q.identity(), S.set(s, s * (pine ? 1.2 : 1), s)); trunk.setMatrixAt(i, M4);
        for (let k = 0; k < 3; k++) {
            if (pine) {
                const ss = s * (1.1 - k * 0.28);
                M4.compose(P.set(x, gy + s * (1.5 + k * 0.7), z), Q.setFromEuler(new THREE.Euler(0, R() * 3, 0)), S.set(ss, ss, ss));
                pines.setMatrixAt(pi, M4); pines.setColorAt(pi++, C.setHSL(0.33 + R() * 0.04, 0.45, 0.24 + R() * 0.06));
            } else {
                const ss = s * (0.75 + R() * 0.45);
                M4.compose(P.set(x + (R() - 0.5) * s * 0.9, gy + s * (1.7 + R() * 0.7), z + (R() - 0.5) * s * 0.9),
                    Q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, 0)), S.set(ss, ss * 0.85, ss));
                leaves.setMatrixAt(li, M4); leaves.setColorAt(li++, C.setHSL(0.24 + R() * 0.1, 0.5 + R() * 0.2, 0.33 + R() * 0.1));
            }
        }
    }
    leaves.count = li; pines.count = pi;

    const nBush = 40, bush = inst(new THREE.IcosahedronGeometry(1, 1), MAT.leaf, nBush, true);
    for (let i = 0; i < nBush; i++) {
        const [x, z] = spot(minR, minR + 14), s = 0.3 + R() * 0.35;
        M4.compose(P.set(x, gy + s * 0.5, z), Q.setFromEuler(new THREE.Euler(R(), R() * 3, R())), S.set(s * 1.3, s, s * 1.2));
        bush.setMatrixAt(i, M4); bush.setColorAt(i, C.setHSL(0.26 + R() * 0.08, 0.5, 0.3 + R() * 0.08));
    }
    const nRock = 26, rock = inst(new THREE.DodecahedronGeometry(1, 0), MAT.rock, nRock, true);
    for (let i = 0; i < nRock; i++) {
        const [x, z] = spot(minR - (h.water ? 1.4 : 0), minR + 18), s = 0.12 + R() * 0.35;
        M4.compose(P.set(x, gy + s * 0.25, z), Q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), S.set(s * 1.3, s * 0.7, s));
        rock.setMatrixAt(i, M4); rock.setColorAt(i, C.setHSL(0.08, 0.05, 0.5 + R() * 0.15));
    }
    const nFlower = 240, flower = inst(new THREE.IcosahedronGeometry(0.045, 0), MAT.flower, nFlower, false);
    const fcols = [0xf472b6, 0xfacc15, 0xffffff, 0xa78bfa, 0xfb7185, 0x60a5fa];
    for (let i = 0; i < nFlower; i++) {
        if (i % 8 === 0) flower.userData.c = spot(minR, minR + 12);
        const [cx, cz] = flower.userData.c, x = cx + (R() - 0.5) * 1.4, z = cz + (R() - 0.5) * 1.4;
        M4.compose(P.set(x, gy + 0.06 + R() * 0.05, z), Q.identity(), S.set(1, 1, 1));
        flower.setMatrixAt(i, M4); flower.setColorAt(i, C.set(fcols[(i / 8 | 0) % fcols.length]));
    }
    const nTuft = isTouch ? 350 : 700, tuft = inst(new THREE.ConeGeometry(0.025, 0.2, 4).translate(0, 0.1, 0), MAT.tuft, nTuft, false);
    for (let i = 0; i < nTuft; i++) {
        const [x, z] = spot(minR - 0.8, minR + 16), s = 0.6 + R() * 0.9;
        M4.compose(P.set(x, gy, z), Q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5)), S.set(s, s, s));
        tuft.setMatrixAt(i, M4); tuft.setColorAt(i, C.setHSL(0.25 + R() * 0.06, 0.5, 0.3 + R() * 0.12));
    }
}

function disposeGroup(g) {
    g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) if (!Object.values(MAT).includes(m)) m.dispose();
    });
}

// ── Balls ──────────────────────────────────────────────────────────────────
const balls = new Map();
const ballGeo = new THREE.SphereGeometry(BALL_R, 40, 28);
const blobGeo = new THREE.PlaneGeometry(BALL_R * 3.4, BALL_R * 3.4).rotateX(-Math.PI / 2);
export function addBall(id, color, ghost = false) {
    removeBall(id);
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12,
        bumpMap: TEX.dimple, bumpScale: 0.5, transparent: ghost, opacity: ghost ? 0.55 : 1, depthWrite: !ghost });
    const mesh = new THREE.Mesh(ballGeo, mat); mesh.castShadow = !ghost;
    if (ghost) { mesh.renderOrder = 2; mesh.scale.setScalar(0.94); } // your own ball always reads through ghosts
    const blob = new THREE.Mesh(blobGeo, MAT.blob);
    scene.add(mesh, blob);
    balls.set(id, { mesh, blob, x: 0, z: 0 });
}
export function removeBall(id) { const b = balls.get(id); if (!b) return; scene.remove(b.mesh, b.blob); b.mesh.material.dispose(); balls.delete(id); }
export function clearBalls() { for (const id of [...balls.keys()]) removeBall(id); }
const _axis = new THREE.Vector3(), _q = new THREE.Quaternion();
// y = centre height; sink = extra drop into cup/water
export function setBall(id, x, z, y, visible = true) {
    const b = balls.get(id); if (!b) return;
    const dx = x - b.mesh.position.x, dz = z - b.mesh.position.z, d = Math.hypot(dx, dz);
    if (d > 1e-5 && d < 1) { _axis.set(dz, 0, -dx).normalize(); _q.setFromAxisAngle(_axis, d / BALL_R); b.mesh.quaternion.premultiply(_q); }
    b.mesh.position.set(x, y, z); b.mesh.visible = visible;
    const gy = curHole ? heightAt(curHole, x, z) : 0;
    b.blob.position.set(x, gy + 0.004, z);
    b.blob.visible = visible && y > gy - 0.02;
    b.x = x; b.z = z;
}

// ── Aim guide ──────────────────────────────────────────────────────────────
let arrow, dots;
const DOTS = 48;
function buildAim() {
    const s = new THREE.Shape();
    s.moveTo(-0.035, 0); s.lineTo(0.035, 0); s.lineTo(0.035, 0.75); s.lineTo(0.11, 0.75); s.lineTo(0, 1); s.lineTo(-0.11, 0.75); s.lineTo(-0.035, 0.75); s.closePath();
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); // tip points toward -Z; rotated by yaw below
    arrow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide }));
    arrow.renderOrder = 5; arrow.visible = false; scene.add(arrow);
    dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), DOTS);
    dots.visible = false; dots.frustumCulled = false; scene.add(dots);
}
const _c1 = new THREE.Color(0x4ade80), _c2 = new THREE.Color(0xfacc15), _c3 = new THREE.Color(0xef4444);
export function setAim(on, x, z, dx, dz, power, path) {
    if (!arrow) buildAim();
    arrow.visible = dots.visible = on;
    if (!on) return;
    const y = heightAt(curHole, x, z) + 0.012;
    arrow.position.set(x + dx * 0.14, y, z + dz * 0.14);
    arrow.rotation.y = Math.atan2(-dx, -dz);
    const len = 0.25 + power * 0.75;
    arrow.scale.set(0.7 + power * 0.5, 1, len);
    const c = power < 0.5 ? _c1.clone().lerp(_c2, power * 2) : _c2.clone().lerp(_c3, (power - 0.5) * 2);
    arrow.material.color.copy(c);
    const M4 = new THREE.Matrix4(); let n = 0;
    for (let i = 0; i + 1 < path.length && n < DOTS; i += 2) {
        const px = path[i], pz = path[i + 1], f = 1 - n / DOTS;
        M4.makeScale(f, f, f).setPosition(px, heightAt(curHole, px, pz) + 0.03, pz);
        dots.setMatrixAt(n++, M4);
    }
    dots.count = n; dots.instanceMatrix.needsUpdate = true;
}

// ── Particles ──────────────────────────────────────────────────────────────
const MAXP = 500;
let pMesh; const parts = [];
function buildFxPools() {
    pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), MAXP);
    pMesh.count = 0; pMesh.frustumCulled = false; pMesh.castShadow = false;
    pMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    scene.add(pMesh);
}
function spawn(x, y, z, vx, vy, vz, size, color, life, grav = 9.8, spin = 0, flat = false) {
    if (parts.length >= MAXP) parts.shift();
    parts.push({ x, y, z, vx, vy, vz, size, color: new THREE.Color(color), life, max: life, grav, spin, rx: Math.random() * 6, ry: Math.random() * 6, flat });
}
export function confetti(x, y, z) {
    const cols = [0xef4444, 0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xec4899, 0xffffff];
    for (let i = 0; i < 160; i++) {
        const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.4;
        spawn(x, y + 0.1, z, Math.cos(a) * s * 0.6, 3 + Math.random() * 3.5, Math.sin(a) * s * 0.6, 0.05, cols[i % cols.length], 2.2 + Math.random(), 4, 8, true);
    }
}
export function splash(x, y, z) {
    for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * 1.2;
        spawn(x, y, z, Math.cos(a) * s, 1.5 + Math.random() * 2.2, Math.sin(a) * s, 0.03 + Math.random() * 0.03, Math.random() < 0.5 ? 0xffffff : 0x9fd8ee, 0.8 + Math.random() * 0.4);
    }
}
export function puff(x, y, z, color = 0xe6cf94, n = 14) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.3 + Math.random() * 0.5;
        spawn(x, y, z, Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s, 0.025 + Math.random() * 0.02, color, 0.5 + Math.random() * 0.3, 3);
    }
}
export function sparks(x, y, z, color) {
    for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 1.5;
        spawn(x, y, z, Math.cos(a) * s, 0.8 + Math.random(), Math.sin(a) * s, 0.02, color, 0.35 + Math.random() * 0.2, 6);
    }
}
export function bumperHit(i) { if (dyn.bumpers[i]) dyn.bumpers[i].pulse = 1; }
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _qq = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function updateParticles(dt) {
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy -= p.grav * dt;
        if (p.flat) { p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5; p.vy = Math.max(p.vy, -0.9); }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const floor = curHole ? heightAt(curHole, p.x, p.z) : 0;
        if (p.y < floor + 0.01 && p.flat) { p.y = floor + 0.01; p.vx = p.vz = 0; p.spin = 0; }
        p.rx += p.spin * dt; p.ry += p.spin * dt * 0.7;
        const f = Math.min(1, p.life / p.max * 3);
        const s = p.size * (p.flat ? 1 : f);
        _s.set(s, p.flat ? s * 0.15 : s, p.flat ? s * 0.7 : s);
        _m.compose(_p.set(p.x, p.y, p.z), _qq.setFromEuler(_e.set(p.rx, p.ry, 0)), _s);
        pMesh.setMatrixAt(n, _m); pMesh.setColorAt(n, p.color); n++;
    }
    pMesh.count = n;
    pMesh.instanceMatrix.needsUpdate = true;
    if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

// ── Per-frame animation ────────────────────────────────────────────────────
let clock = 0;
// holeT: physics time of the local player (moving parts match what they collide with)
export function update(dt, holeT, ballsNearCup) {
    clock += dt;
    if (clouds) clouds.rotation.y += dt * 0.004;
    if (!curHole) return;
    if (dyn.windmill) dyn.windmill.rotation.z = windmillAngle(curHole, holeT) - Math.PI / 2; // blade 0 angle == physics angle
    for (const { m, mesh } of dyn.movers) mesh.position.x = moverPos(m, holeT).x;
    for (const b of dyn.bumpers) {
        b.pulse = Math.max(0, b.pulse - dt * 4);
        const s = 1 + Math.sin(b.pulse * Math.PI) * 0.12; b.grp.scale.set(s, 1, s);
    }
    if (dyn.flag) {
        const pos = dyn.flag.geometry.attributes.position, base = dyn.flag.userData.base;
        for (let i = 0; i < pos.count; i++) {
            const x = base[i * 3], y = base[i * 3 + 1], w = x / 0.47;
            pos.setZ(i, Math.sin(x * 11 - clock * 6.5 + y * 2) * 0.045 * w + Math.sin(x * 5 - clock * 3.1) * 0.02 * w);
        }
        pos.needsUpdate = true; dyn.flag.geometry.computeVertexNormals();
        dyn.flagLift += ((ballsNearCup ? 0.65 : 0) - dyn.flagLift) * Math.min(1, dt * 4);
        dyn.flagPole.position.y = dyn.flagY + dyn.flagLift;
    }
    if (MAT.water.normalMap) { MAT.water.normalMap.offset.x += dt * 0.012; MAT.water.normalMap.offset.y += dt * 0.007; }
    updateParticles(dt);
}
export const waterLevel = () => dyn.waterY;

// ── Camera rig ─────────────────────────────────────────────────────────────
export const rig = { yaw: 0, pitch: 0.45, dist: 4, fx: 0, fy: 0, fz: 0, tYaw: 0, tPitch: 0.45, tDist: 4, tfx: 0, tfy: 0, tfz: 0 };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export function snapCamera() { rig.yaw = rig.tYaw; rig.pitch = rig.tPitch; rig.dist = rig.tDist; rig.fx = rig.tfx; rig.fy = rig.tfy; rig.fz = rig.tfz; }
export function updateCamera(dt, rate = 5) {
    const k = 1 - Math.exp(-dt * rate), kf = 1 - Math.exp(-dt * rate * 1.4);
    rig.yaw += angDiff(rig.yaw, rig.tYaw) * k;
    rig.pitch += (rig.tPitch - rig.pitch) * k;
    rig.dist += (rig.tDist - rig.dist) * k;
    rig.fx += (rig.tfx - rig.fx) * kf; rig.fy += (rig.tfy - rig.fy) * kf; rig.fz += (rig.tfz - rig.fz) * kf;
    const cp = Math.cos(rig.pitch);
    let cx = rig.fx + Math.sin(rig.yaw) * cp * rig.dist, cz = rig.fz + Math.cos(rig.yaw) * cp * rig.dist;
    let cy = rig.fy + Math.sin(rig.pitch) * rig.dist;
    if (curHole) cy = Math.max(cy, heightAt(curHole, cx, cz) + 0.25);
    camera.position.set(cx, cy, cz);
    camera.lookAt(rig.fx, rig.fy + 0.12, rig.fz);
}
export const yawBehind = (dx, dz) => Math.atan2(-dx, -dz);

// ── Picking helpers ────────────────────────────────────────────────────────
const _v = new THREE.Vector3(), _ray = new THREE.Raycaster(), _plane = new THREE.Plane(), _hit = new THREE.Vector3();
export function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, behind: _v.z > 1 };
}
export function screenToGround(sx, sy, y) {
    _ray.setFromCamera({ x: sx / innerWidth * 2 - 1, y: -(sy / innerHeight) * 2 + 1 }, camera);
    _plane.set(new THREE.Vector3(0, 1, 0), -y);
    return _ray.ray.intersectPlane(_plane, _hit) ? { x: _hit.x, z: _hit.z } : null;
}

// ── Adaptive quality ───────────────────────────────────────────────────────
let fpsAcc = 0, fpsN = 0, pr = renderer ? renderer.getPixelRatio() : 1;
export function render(dt) {
    renderer.render(scene, camera);
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 2.5) {
        const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
        pr = renderer.getPixelRatio();
        if (avg > 1 / 45 && pr > 0.8) renderer.setPixelRatio(Math.max(0.8, pr - 0.25));
        else if (avg < 1 / 58 && pr < Math.min(devicePixelRatio, isTouch ? 1.75 : 2) - 0.01) renderer.setPixelRatio(Math.min(pr + 0.25, devicePixelRatio));
    }
}
