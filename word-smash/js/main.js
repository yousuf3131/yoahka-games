import * as THREE from 'three';

const $ = id => document.getElementById(id);
const track = (name, params) => { if (window.track) window.track(name, params); };

// ── Word data ──────────────────────────────────────────────
const VERBS = [
    { ur: 'کھانا', rom: 'khaana', en: 'to eat', stem: 'کھا' },
    { ur: 'پینا', rom: 'peena', en: 'to drink', stem: 'پی' },
    { ur: 'جانا', rom: 'jaana', en: 'to go', stem: 'جا' },
    { ur: 'آنا', rom: 'aana', en: 'to come', stem: 'آ' },
    { ur: 'پڑھنا', rom: 'parhna', en: 'to read', stem: 'پڑھ' },
    { ur: 'لکھنا', rom: 'likhna', en: 'to write', stem: 'لکھ' },
    { ur: 'کھیلنا', rom: 'khelna', en: 'to play', stem: 'کھیل' },
    { ur: 'دیکھنا', rom: 'dekhna', en: 'to see', stem: 'دیکھ' },
    { ur: 'سننا', rom: 'sunna', en: 'to listen', stem: 'سن' },
    { ur: 'بولنا', rom: 'bolna', en: 'to speak', stem: 'بول' },
    { ur: 'سونا', rom: 'sona', en: 'to sleep', stem: 'سو' },
    { ur: 'اٹھنا', rom: 'uthna', en: 'to wake up', stem: 'اٹھ' },
    { ur: 'دوڑنا', rom: 'dauRna', en: 'to run', stem: 'دوڑ' },
    { ur: 'کرنا', rom: 'karna', en: 'to do', stem: 'کر' },
];

const SUBJECTS = [
    { ur: 'میں', en: 'I (boy)', sfx: 'تا ہوں' },
    { ur: 'وہ (he)', en: 'he', sfx: 'تا ہے' },
    { ur: 'وہ (she)', en: 'she', sfx: 'تی ہے' },
    { ur: 'ہم', en: 'we', sfx: 'تے ہیں' },
    { ur: 'وہ (they)', en: 'they', sfx: 'تے ہیں' },
];

const BLOCK_COLORS = [0x059669, 0x2563eb, 0xd97706, 0xdc2626, 0x7c3aed, 0xec4899];

function shuffle(a) {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
}

// ── Question generators ────────────────────────────────────
function makeQuestions(mode) {
    const qs = [];
    if (mode === 'vocab') {
        for (const v of shuffle(VERBS)) {
            const wrongs = shuffle(VERBS.filter(x => x !== v)).slice(0, 3).map(x => x.en);
            qs.push({ prompt: v.ur, promptIsUrdu: true, hint: v.rom, answer: v.en, options: shuffle([v.en, ...wrongs]), optionsUrdu: false });
        }
    } else if (mode === 'reverse') {
        for (const v of shuffle(VERBS)) {
            const wrongs = shuffle(VERBS.filter(x => x !== v)).slice(0, 3).map(x => x.ur);
            qs.push({ prompt: v.en, promptIsUrdu: false, hint: '', answer: v.ur, options: shuffle([v.ur, ...wrongs]), optionsUrdu: true });
        }
    } else if (mode === 'conjugation') {
        for (const v of shuffle(VERBS)) {
            const s = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
            const correct = v.stem + s.sfx;
            const allForms = SUBJECTS.map(x => v.stem + x.sfx);
            const wrongs = shuffle(allForms.filter(f => f !== correct)).slice(0, 3);
            qs.push({ prompt: `${s.en}: "${v.en}"`, promptIsUrdu: false, hint: v.ur, answer: correct, options: shuffle([correct, ...wrongs]), optionsUrdu: true });
        }
    } else {
        const a = makeQuestions('vocab').slice(0, 5);
        const b = makeQuestions('reverse').slice(0, 5);
        const c = makeQuestions('conjugation').slice(0, 5);
        return shuffle([...a, ...b, ...c]);
    }
    return qs;
}

// ── Audio (web audio API, no files needed) ─────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
let muted = false;

function ensureAudio() { if (!actx) actx = new AudioCtx(); }

function playTone(freq, dur, type = 'square', vol = 0.15) {
    if (muted || !actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
}

function sfxCorrect() {
    playTone(523, 0.1, 'square', 0.12);
    setTimeout(() => playTone(659, 0.1, 'square', 0.12), 60);
    setTimeout(() => playTone(784, 0.15, 'square', 0.12), 120);
}
function sfxWrong() {
    playTone(200, 0.2, 'sawtooth', 0.1);
    setTimeout(() => playTone(150, 0.3, 'sawtooth', 0.1), 100);
}
function sfxStreak() {
    playTone(784, 0.08, 'square', 0.15);
    setTimeout(() => playTone(988, 0.08, 'square', 0.15), 70);
    setTimeout(() => playTone(1175, 0.15, 'square', 0.15), 140);
    setTimeout(() => playTone(1319, 0.2, 'square', 0.18), 210);
}
function sfxGameOver() {
    playTone(392, 0.25, 'triangle', 0.15);
    setTimeout(() => playTone(330, 0.25, 'triangle', 0.15), 200);
    setTimeout(() => playTone(262, 0.5, 'triangle', 0.15), 400);
}
function sfxPerfect() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'square', 0.15), i * 100));
}

// ── Three.js setup ─────────────────────────────────────────
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f1a);
scene.fog = new THREE.FogExp2(0x0a0f1a, 0.025);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 8, 10);
camera.lookAt(0, 0.5, 0);

// Lights
const ambient = new THREE.AmbientLight(0x334455, 0.6);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 12, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 30;
dirLight.shadow.camera.left = -10; dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10; dirLight.shadow.camera.bottom = -10;
scene.add(dirLight);

const pointLight = new THREE.PointLight(0x34d399, 1.5, 20);
pointLight.position.set(0, 5, 0);
scene.add(pointLight);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid lines on ground
const gridHelper = new THREE.GridHelper(20, 20, 0x1e293b, 0x1e293b);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Platform slots (where blocks pop up)
const SLOT_POSITIONS = [
    new THREE.Vector3(-3, 0, -1),
    new THREE.Vector3(-1, 0, -1),
    new THREE.Vector3(1, 0, -1),
    new THREE.Vector3(3, 0, -1),
];

// Pedestals
const pedestalGeo = new THREE.CylinderGeometry(0.7, 0.8, 0.15, 16);
const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.3 });
SLOT_POSITIONS.forEach(pos => {
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.copy(pos);
    pedestal.position.y = 0.075;
    pedestal.receiveShadow = true;
    scene.add(pedestal);
});

// Stars in the sky
const starGeo = new THREE.BufferGeometry();
const starVerts = [];
for (let i = 0; i < 500; i++) {
    starVerts.push((Math.random() - 0.5) * 60, Math.random() * 20 + 5, (Math.random() - 0.5) * 60);
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, sizeAttenuation: true });
scene.add(new THREE.Points(starGeo, starMat));

// ── Text texture for blocks ────────────────────────────────
function makeTextTexture(text, isUrdu = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isUrdu) {
        ctx.font = 'bold 56px "Noto Nastaliq Urdu", "Segoe UI", serif';
        ctx.direction = 'rtl';
    } else {
        const fontSize = text.length > 12 ? 28 : text.length > 8 ? 34 : 42;
        ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
    }
    ctx.fillText(text, 128, isUrdu ? 140 : 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

// ── Block objects ──────────────────────────────────────────
const blocks = [];
const particles = [];

class WordBlock {
    constructor(slot, text, isUrdu, colorHex, isCorrect) {
        this.slot = slot;
        this.isCorrect = isCorrect;
        this.alive = true;
        this.age = 0;

        const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        const mat = new THREE.MeshStandardMaterial({
            color: colorHex, roughness: 0.3, metalness: 0.4,
            emissive: colorHex, emissiveIntensity: 0.15,
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow = true;

        // Text on front face
        const textTex = makeTextTexture(text, isUrdu);
        const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true });
        const textPlane = new THREE.PlaneGeometry(1.18, 1.18);
        const textMesh = new THREE.Mesh(textPlane, textMat);
        textMesh.position.z = 0.601;
        this.mesh.add(textMesh);

        // Back face
        const textMeshBack = new THREE.Mesh(textPlane.clone(), textMat.clone());
        textMeshBack.position.z = -0.601;
        textMeshBack.rotation.y = Math.PI;
        this.mesh.add(textMeshBack);

        const pos = SLOT_POSITIONS[slot];
        this.mesh.position.set(pos.x, -1.5, pos.z);
        this.targetY = 1.0;
        this.mesh.userData.block = this;
        scene.add(this.mesh);
    }

    update(dt) {
        this.age += dt;
        // Rise up
        if (this.mesh.position.y < this.targetY) {
            this.mesh.position.y += dt * 4;
            if (this.mesh.position.y > this.targetY) this.mesh.position.y = this.targetY;
        }
        // Gentle bob + rotate
        this.mesh.position.y = this.targetY + Math.sin(this.age * 2) * 0.05;
        this.mesh.rotation.y += dt * 0.5;
    }

    smash(correct) {
        this.alive = false;
        const color = correct ? 0x34d399 : 0xef4444;
        // Spawn particles
        for (let i = 0; i < 20; i++) {
            spawnParticle(this.mesh.position.clone(), color);
        }
        // Flash the emissive
        this.mesh.material.emissive.setHex(color);
        this.mesh.material.emissiveIntensity = 2;

        // Animate out
        this.dying = true;
        this.deathTimer = 0;
    }

    updateDeath(dt) {
        this.deathTimer += dt;
        const t = this.deathTimer;
        this.mesh.scale.setScalar(Math.max(0, 1 - t * 4));
        this.mesh.position.y += (this.isCorrect ? dt * 6 : -dt * 8);
        this.mesh.rotation.x += dt * 10;
        if (t > 0.4) {
            scene.remove(this.mesh);
            return true;
        }
        return false;
    }
}

function clearBlocks() {
    for (const b of blocks) scene.remove(b.mesh);
    blocks.length = 0;
}

// ── Particles ──────────────────────────────────────────────
const particleGeo = new THREE.SphereGeometry(0.06, 4, 4);

function spawnParticle(pos, color) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.copy(pos);
    const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6 + 2,
        (Math.random() - 0.5) * 8
    );
    scene.add(mesh);
    particles.push({ mesh, vel, life: 0 });
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        p.vel.y -= 15 * dt; // gravity
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.material.opacity = Math.max(0, 1 - p.life * 1.5);
        p.mesh.material.transparent = true;
        if (p.life > 1) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }
}

// ── Game state ─────────────────────────────────────────────
let gameMode = 'vocab';
let questions = [];
let qi = 0;
let score = 0, streak = 0, bestStreak = 0, correct = 0, wrong = 0, lives = 5;
let gameRunning = false;
let startTime = 0;
let roundTimer = 0;
let locked = false;
const ROUND_TIME = 8; // seconds per question

// ── Raycaster (click/tap detection) ────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onPointerDown(e) {
    if (!gameRunning || locked) return;
    ensureAudio();

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(blocks.filter(b => b.alive).map(b => b.mesh), true);

    if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData.block) obj = obj.parent;
        if (obj && obj.userData.block) {
            handlePick(obj.userData.block);
        }
    }
}
canvas.addEventListener('pointerdown', onPointerDown);

function handlePick(block) {
    if (locked || !block.alive) return;
    locked = true;

    if (block.isCorrect) {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
        const bonus = Math.min(streak - 1, 5) * 5;
        const timeBonus = Math.floor(roundTimer * 3);
        const pts = 10 + bonus + timeBonus;
        score += pts;
        correct++;

        block.smash(true);
        sfxCorrect();
        showHitFeedback(`+${pts}`, '#34d399');

        if (streak >= 3 && streak % 3 === 0) {
            sfxStreak();
            showStreakBanner(`${streak}x STREAK!`);
        }

        // Kill all other blocks
        for (const b of blocks) if (b !== block && b.alive) b.smash(false);
    } else {
        streak = 0;
        wrong++;
        lives--;
        block.smash(false);
        sfxWrong();
        showHitFeedback('WRONG!', '#ef4444');

        // Highlight the correct one
        for (const b of blocks) {
            if (b.isCorrect && b.alive) {
                b.mesh.material.emissive.setHex(0x34d399);
                b.mesh.material.emissiveIntensity = 2;
            }
        }

        // Kill remaining after a moment
        setTimeout(() => {
            for (const b of blocks) if (b.alive) b.smash(false);
        }, 600);
    }

    updateHUD();
    setTimeout(() => nextQuestion(), 1000);
}

function timeOut() {
    if (locked) return;
    locked = true;
    streak = 0;
    wrong++;
    lives--;
    sfxWrong();
    showHitFeedback('TIME UP!', '#f59e0b');

    for (const b of blocks) if (b.alive) {
        if (b.isCorrect) {
            b.mesh.material.emissive.setHex(0x34d399);
            b.mesh.material.emissiveIntensity = 2;
        }
    }
    setTimeout(() => {
        for (const b of blocks) if (b.alive) b.smash(false);
    }, 600);

    updateHUD();
    setTimeout(() => nextQuestion(), 1200);
}

// ── HUD ────────────────────────────────────────────────────
function updateHUD() {
    $('hud-score').textContent = score;
    $('hud-streak').textContent = streak;
    $('hud-lives').textContent = lives;
    $('hud-round').textContent = `${Math.min(qi + 1, questions.length)}/${questions.length}`;
}

function updateTimeHUD() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    $('hud-time').textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function showHitFeedback(text, color) {
    const el = $('hit-feedback');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 700);
}

function showStreakBanner(text) {
    const el = $('streak-banner');
    el.textContent = text;
    el.style.color = '#f59e0b';
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 900);
}

// ── Game flow ──────────────────────────────────────────────
function startGame() {
    ensureAudio();
    questions = makeQuestions(gameMode);
    qi = 0;
    score = 0; streak = 0; bestStreak = 0; correct = 0; wrong = 0; lives = 5;
    startTime = Date.now();
    gameRunning = true;
    locked = false;
    $('main').classList.add('hidden');
    $('results').classList.add('hidden');
    $('hud').classList.remove('hidden');
    updateHUD();
    nextQuestion();
    track('word_smash_start', { mode: gameMode });
}

function nextQuestion() {
    clearBlocks();
    if (qi >= questions.length || lives <= 0) {
        endGame();
        return;
    }

    const q = questions[qi];
    $('hud-prompt').textContent = q.prompt;
    if (q.promptIsUrdu) {
        $('hud-prompt').style.fontFamily = '"Noto Nastaliq Urdu", "Segoe UI", serif';
        $('hud-prompt').style.direction = 'rtl';
        $('hud-prompt').style.fontSize = '2.2rem';
    } else {
        $('hud-prompt').style.fontFamily = '';
        $('hud-prompt').style.direction = '';
        $('hud-prompt').style.fontSize = '';
    }

    // Spawn 4 blocks
    const colors = shuffle([...BLOCK_COLORS]);
    q.options.forEach((opt, i) => {
        const isUrdu = q.optionsUrdu;
        const isCorrect = opt === q.answer;
        const block = new WordBlock(i, opt, isUrdu, colors[i], isCorrect);
        blocks.push(block);
    });

    roundTimer = ROUND_TIME;
    locked = false;
    qi++;
    updateHUD();
}

function endGame() {
    gameRunning = false;
    clearBlocks();
    $('hud').classList.add('hidden');

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;

    $('res-score').textContent = score;
    $('res-correct').textContent = correct;
    $('res-wrong').textContent = wrong;
    $('res-best-streak').textContent = bestStreak;
    $('res-time').textContent = `${m}:${s.toString().padStart(2, '0')}`;

    const total = correct + wrong;
    const pct = total > 0 ? correct / total : 0;
    const msgEl = $('res-msg');

    if (pct === 1 && total === questions.length) {
        $('res-title').textContent = 'PERFECT!';
        $('res-kicker').textContent = 'Unbelievable!';
        msgEl.textContent = 'You smashed every single one!';
        msgEl.className = 'res-msg gold';
        sfxPerfect();
    } else if (pct >= 0.8) {
        $('res-title').textContent = 'Amazing!';
        $('res-kicker').textContent = 'Great job!';
        msgEl.textContent = 'You really know your verbs!';
        msgEl.className = 'res-msg green';
        sfxPerfect();
    } else if (pct >= 0.5) {
        $('res-title').textContent = 'Good Try!';
        $('res-kicker').textContent = 'Keep it up';
        msgEl.textContent = 'Practice makes perfect!';
        msgEl.className = 'res-msg silver';
        sfxGameOver();
    } else {
        $('res-title').textContent = 'Keep Going!';
        $('res-kicker').textContent = 'Don\'t give up';
        msgEl.textContent = 'Play again to beat your score!';
        msgEl.className = 'res-msg silver';
        sfxGameOver();
    }

    $('results').classList.remove('hidden');
    track('word_smash_end', { mode: gameMode, score, correct, wrong, bestStreak });
}

// ── Menu ───────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gameMode = btn.dataset.mode;
    });
});

$('btn-play').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-menu').addEventListener('click', () => {
    $('results').classList.add('hidden');
    $('main').classList.remove('hidden');
});

$('mute-btn').addEventListener('click', () => {
    muted = !muted;
    $('mute-btn').textContent = muted ? '\u{1F507}' : '\u{1F50A}';
});

// ── Resize ─────────────────────────────────────────────────
function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);
onResize();

// ── Animate ────────────────────────────────────────────────
const clock = new THREE.Clock();

// Ambient floating light animation
let lightAngle = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    // Animate the point light in a circle
    lightAngle += dt * 0.5;
    pointLight.position.x = Math.sin(lightAngle) * 4;
    pointLight.position.z = Math.cos(lightAngle) * 3;
    pointLight.intensity = 1.5 + Math.sin(lightAngle * 2) * 0.3;

    // Update blocks
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.dying) {
            if (b.updateDeath(dt)) blocks.splice(i, 1);
        } else {
            b.update(dt);
        }
    }

    // Update particles
    updateParticles(dt);

    // Round timer
    if (gameRunning && !locked) {
        roundTimer -= dt;
        if (roundTimer <= 0) timeOut();
    }

    // Camera gentle sway
    camera.position.x = Math.sin(Date.now() * 0.0003) * 0.3;

    if (gameRunning) updateTimeHUD();

    renderer.render(scene, camera);
}
animate();

// Preload Noto Nastaliq for canvas text
document.fonts.load('bold 56px "Noto Nastaliq Urdu"').catch(() => {});
