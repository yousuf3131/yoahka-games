// Mini Golf — hole layouts and ball physics. Pure JS (no rendering) so bots can
// simulate shots and the whole thing can be tested headlessly.

export const BALL_R = 0.1;
export const CUP_R = 0.2;
export const MAX_STROKES = 8;
export const MAX_SPEED = 9;
export const PHYS_DT = 1 / 240;

const G_ROLL = 9.81 * 5 / 7;   // rolling ball on an incline
const FRICTION = 0.85;         // m/s² rolling resistance on felt
const SAND_FRICTION = 4.5;
const DRAG = 0.2;              // speed-proportional loss
const E_WALL = 0.72, E_BUMPER = 1.3, E_MOVER = 0.6;
const CUP_SPEED = 1.75;        // faster than this and it lips out

// ── Layout helpers ─────────────────────────────────────────────────────────
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const ngon = (cx, cz, r, n, rot = 0) =>
    Array.from({ length: n }, (_, i) => { const a = rot + i / n * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });

// ── Holes ──────────────────────────────────────────────────────────────────
// shape: fairway outline (railed unless the edge index is in `open`)
// blocks: solid obstacles · hills: {x,z,r,h} (h<0 = dip) · ramps: height +h over len along (dx,dz)
// path: waypoints tee → cup, used by bots and the camera
export const HOLES = [
    {
        name: 'First Putt', par: 2, accent: '#ef4444',
        shape: rect(-1, 1.2, 1, -10.5),
        tee: [0, 0], cup: [0, -9],
        hills: [{ x: 0, z: -5, r: 1.3, h: 0.07 }],
        path: [[0, 0], [0, -9]],
    },
    {
        name: 'Dogleg', par: 3, accent: '#f97316',
        shape: [[-1, 1.2], [1, 1.2], [1, -7], [8, -7], [8, -11], [0.6, -11], [-1, -9.4]],
        tee: [0, 0], cup: [6.6, -9],
        bumpers: [{ x: 3.4, z: -8.1, r: 0.28 }],
        path: [[0, 0], [0, -8.8], [6.6, -9]],
    },
    {
        name: 'Uphill Battle', par: 2, accent: '#eab308',
        shape: rect(-1.1, 1.2, 1.1, -12),
        tee: [0, 0], cup: [0, -10.3],
        ramps: [{ x: 0, z: -4, dx: 0, dz: -1, len: 3, h: 0.5 }],
        path: [[0, 0], [0, -10.3]],
    },
    {
        name: 'The Windmill', par: 3, accent: '#8b5cf6',
        shape: rect(-1.3, 1.2, 1.3, -13.5),
        tee: [0, 0], cup: [0, -11.5],
        blocks: [rect(-1.3, -6.5, -0.42, -7.4), rect(0.42, -6.5, 1.3, -7.4)],
        windmill: { x: 0, z: -6.5, gap: 0.42, depth: 0.9, speed: 1.3 },
        path: [[0, 0], [0, -6.1], [0, -7.8], [0, -11.5]],
    },
    {
        name: 'Bumper Alley', par: 3, accent: '#ec4899',
        shape: [[-2, 1.2], [2, 1.2], [2, -12], [1, -13.2], [-1, -13.2], [-2, -12]],
        tee: [0, 0], cup: [0, -12],
        bumpers: [
            { x: 0, z: -4, r: 0.35 }, { x: -1.1, z: -6.6, r: 0.3 }, { x: 1.1, z: -6.6, r: 0.3 },
            { x: 0, z: -9, r: 0.35 }, { x: -1.25, z: -10.7, r: 0.25 }, { x: 1.25, z: -10.7, r: 0.25 },
        ],
        path: [[0, 0], [0, -12]],
    },
    {
        name: 'Island Green', par: 3, accent: '#06b6d4', water: true,
        shape: [[-1.2, 1.2], [1.2, 1.2], [1.2, -3], [0.5, -3], [0.5, -8], [2, -8], [2, -12.5],
                [-2, -12.5], [-2, -8], [-0.5, -8], [-0.5, -3], [-1.2, -3]],
        open: [2, 3, 4, 8, 9, 10],
        tee: [0, 0], cup: [1.1, -11.4],
        path: [[0, 0], [0, -8.6], [1.1, -11.4]],
    },
    {
        name: 'Sand Snake', par: 3, accent: '#d97706',
        shape: [[-1, 1.2], [1, 1.2], [1, -3.6], [4.4, -3.6], [5.2, -4.4], [5.2, -12.5],
                [3, -12.5], [3, -6.2], [-0.2, -6.2], [-1, -5.4]],
        tee: [0, 0], cup: [4.1, -11.3],
        sand: [rect(1.7, -4.7, 2.7, -6.2), rect(4.3, -8, 5.2, -9.5)],
        path: [[0, 0], [0, -4.9], [4.1, -4.9], [4.1, -11.3]],
    },
    {
        name: 'The Volcano', par: 3, accent: '#dc2626',
        shape: ngon(0, -5, 4.2, 8, Math.PI / 8),
        tee: [0, -1.6], cup: [0, -5.6],
        hills: [{ x: 0, z: -5.6, r: 2.5, h: 0.32 }, { x: 0, z: -5.6, r: 0.55, h: -0.06 }],
        path: [[0, -1.6], [0, -5.6]],
    },
    {
        name: 'Grand Finale', par: 4, accent: '#22c55e',
        shape: [[-1.5, 1.2], [1.5, 1.2], [1.5, -13], [0.5, -14.5], [-8.5, -14.5], [-8.5, -10.5], [-1.5, -10.5]],
        tee: [0, 0], cup: [-7.2, -12.5],
        movers: [
            { x: 0, z: -3.8, w: 0.9, d: 0.35, amp: 0.85, period: 2.6, phase: 0 },
            { x: 0, z: -6.8, w: 0.9, d: 0.35, amp: 0.85, period: 2.0, phase: 1.7 },
        ],
        ramps: [{ x: 0, z: -8, dx: 0, dz: -1, len: 2.2, h: -0.35 }],
        bumpers: [{ x: -4, z: -12.5, r: 0.3 }],
        sand: [rect(-6.2, -10.5, -5.2, -12)],
        path: [[0, 0], [0, -12.4], [-7.2, -12.5]],
    },
];

// ── Geometry helpers ───────────────────────────────────────────────────────
export function pointInPoly(poly, x, z) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}
export function polyArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; a += x0 * z1 - x1 * z0; }
    return a / 2;
}
function segsCross(ax, az, bx, bz, cx, cz, dx, dz) {
    const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
    const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    return t > 0 && t < 1 && u > 0 && u < 1;
}

// Precompute collision data; call once per hole definition
export function prepareHole(def) {
    if (def._ready) return def;
    const h = def;
    h.open = new Set(h.open || []);
    h.blocks = h.blocks || []; h.bumpers = h.bumpers || []; h.hills = h.hills || [];
    h.ramps = h.ramps || []; h.sand = h.sand || []; h.movers = h.movers || [];
    h.walls = [];
    h.shape.forEach((p, i) => {
        if (h.open.has(i)) return;
        const q = h.shape[(i + 1) % h.shape.length];
        h.walls.push([p[0], p[1], q[0], q[1]]);
    });
    for (const b of h.blocks) b.forEach((p, i) => { const q = b[(i + 1) % b.length]; h.walls.push([p[0], p[1], q[0], q[1]]); });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of h.shape) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    h.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 };
    // Remaining path length from each waypoint to the cup
    h.pathRem = h.path.map(() => 0);
    for (let i = h.path.length - 2; i >= 0; i--)
        h.pathRem[i] = h.pathRem[i + 1] + Math.hypot(h.path[i + 1][0] - h.path[i][0], h.path[i + 1][1] - h.path[i][1]);
    let minH = Infinity, maxH = -Infinity;
    for (let x = minX; x <= maxX; x += 0.25) for (let z = minZ; z <= maxZ; z += 0.25) {
        if (!pointInPoly(h.shape, x, z)) continue;
        const y = heightAt(h, x, z); minH = Math.min(minH, y); maxH = Math.max(maxH, y);
    }
    h.minH = minH; h.maxH = maxH;
    h._ready = true;
    return h;
}

// ── Surface ────────────────────────────────────────────────────────────────
export function heightAt(h, x, z) {
    let y = 0;
    for (const r of h.ramps) {
        const s = (x - r.x) * r.dx + (z - r.z) * r.dz;
        const t = Math.min(1, Math.max(0, s / r.len));
        y += r.h * t * t * (3 - 2 * t);
    }
    for (const hl of h.hills) {
        const d2 = ((x - hl.x) ** 2 + (z - hl.z) ** 2) / (hl.r * hl.r);
        if (d2 < 1) { const q = 1 - d2; y += hl.h * q * q; }
    }
    return y;
}
const EPS = 0.02;
function gradAt(h, x, z) {
    return [(heightAt(h, x + EPS, z) - heightAt(h, x - EPS, z)) / (2 * EPS),
            (heightAt(h, x, z + EPS) - heightAt(h, x, z - EPS)) / (2 * EPS)];
}
export const inSand = (h, x, z) => h.sand.some(p => pointInPoly(p, x, z));

// ── Moving parts (all functions of hole time t) ───────────────────────────
export function windmillAngle(h, t) { return h.windmill ? h.windmill.speed * t : 0; }
export function windmillBlocked(h, t) {
    if (!h.windmill) return false;
    const a = windmillAngle(h, t);
    for (let i = 0; i < 4; i++) {
        let d = (a + i * Math.PI / 2 + Math.PI / 2) % (Math.PI * 2); // 0 when blade points straight down
        if (d < 0) d += Math.PI * 2;
        if (d < 0.3 || d > Math.PI * 2 - 0.3) return true;
    }
    return false;
}
export function moverPos(m, t) {
    const w = Math.PI * 2 / m.period;
    return { x: m.x + m.amp * Math.sin(w * t + m.phase), vx: m.amp * w * Math.cos(w * t + m.phase) };
}

// ── Ball ───────────────────────────────────────────────────────────────────
export function makeBall(x, z) { return { x, z, vx: 0, vz: 0, moving: false, t: 0 }; }

function collideSeg(b, ax, az, bx, bz, e, svx, svz, ev) {
    const ex = bx - ax, ez = bz - az;
    const L2 = ex * ex + ez * ez;
    let t = ((b.x - ax) * ex + (b.z - az) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t, cz = az + ez * t;
    const dx = b.x - cx, dz = b.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= BALL_R * BALL_R) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d, nz = dz / d;
    b.x = cx + nx * BALL_R; b.z = cz + nz * BALL_R;
    const rvx = b.vx - svx, rvz = b.vz - svz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
        b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz;
        const vt = -rvx * nz + rvz * nx;          // a little grip along the rail
        b.vx += vt * 0.05 * nz; b.vz -= vt * 0.05 * nx;
        if (ev && -vn > 0.2) ev.push({ type: 'wall', speed: -vn, x: b.x, z: b.z });
    }
}

// Advance one fixed step. Returns 'holed' | 'ob' | 'rest' | null.
export function stepBall(h, b, t, dt, ev) {
    const [gx, gz] = gradAt(h, b.x, b.z);
    b.vx -= G_ROLL * gx * dt;
    b.vz -= G_ROLL * gz * dt;

    // Cup lip pulls a nearby ball in a little
    const cdx = h.cup[0] - b.x, cdz = h.cup[1] - b.z, cd = Math.hypot(cdx, cdz);
    if (cd < CUP_R && cd > 1e-4) { b.vx += cdx / cd * 3 * dt; b.vz += cdz / cd * 3 * dt; }

    const sand = inSand(h, b.x, b.z);
    const fr = sand ? SAND_FRICTION : FRICTION;
    let s = Math.hypot(b.vx, b.vz);
    if (s > MAX_SPEED) { b.vx *= MAX_SPEED / s; b.vz *= MAX_SPEED / s; s = MAX_SPEED; }
    if (s > 0) { const ns = Math.max(0, s - (fr + DRAG * s) * dt); b.vx *= ns / s; b.vz *= ns / s; s = ns; }

    b.x += b.vx * dt; b.z += b.vz * dt;

    for (const w of h.walls) collideSeg(b, w[0], w[1], w[2], w[3], E_WALL, 0, 0, ev);
    if (h.windmill && windmillBlocked(h, t)) {
        const wm = h.windmill, gz0 = wm.z + 0.12;
        collideSeg(b, wm.x - wm.gap, gz0, wm.x + wm.gap, gz0, 0.5, 0, 0, ev);
    }
    for (const m of h.movers) {
        const { x, vx } = moverPos(m, t);
        const x0 = x - m.w / 2, x1 = x + m.w / 2, z0 = m.z + m.d / 2, z1 = m.z - m.d / 2;
        collideSeg(b, x0, z0, x1, z0, E_MOVER, vx, 0, ev);
        collideSeg(b, x1, z0, x1, z1, E_MOVER, vx, 0, ev);
        collideSeg(b, x1, z1, x0, z1, E_MOVER, vx, 0, ev);
        collideSeg(b, x0, z1, x0, z0, E_MOVER, vx, 0, ev);
    }
    for (let i = 0; i < h.bumpers.length; i++) {
        const bp = h.bumpers[i];
        const dx = b.x - bp.x, dz = b.z - bp.z, d = Math.hypot(dx, dz), min = bp.r + BALL_R;
        if (d >= min || d < 1e-6) continue;
        const nx = dx / d, nz = dz / d;
        b.x = bp.x + nx * min; b.z = bp.z + nz * min;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
            b.vx -= (1 + E_BUMPER) * vn * nx; b.vz -= (1 + E_BUMPER) * vn * nz;
            if (ev) ev.push({ type: 'bumper', i, speed: -vn });
        }
    }

    b.t += dt;
    const nd = Math.hypot(h.cup[0] - b.x, h.cup[1] - b.z);
    if (nd < CUP_R - BALL_R * 0.4) {
        if (s < CUP_SPEED) return 'holed';
        if (ev && !b.lipped) ev.push({ type: 'lip' });
        b.lipped = true;
    } else b.lipped = false;

    if (!pointInPoly(h.shape, b.x, b.z)) return 'ob';

    if (s < 0.045) {
        const slopeAcc = G_ROLL * Math.hypot(gx, gz);
        if (slopeAcc < fr * 0.9 || b.t > 25) { b.vx = b.vz = 0; b.moving = false; return 'rest'; }
    }
    if (b.t > 30) { b.vx = b.vz = 0; b.moving = false; return 'rest'; }
    return null;
}

export function shoot(b, dirX, dirZ, speed) {
    b.vx = dirX * speed; b.vz = dirZ * speed; b.moving = true; b.t = 0; b.lipped = false;
}

// Run a whole shot to completion (for bots / aim preview)
export function simulate(h, x, z, vx, vz, t0, maxT = 14, pathOut = null, pathEvery = 6) {
    const b = makeBall(x, z); b.vx = vx; b.vz = vz; b.moving = true;
    let t = t0, n = 0, res = null;
    const steps = Math.ceil(maxT / PHYS_DT);
    for (let i = 0; i < steps; i++) {
        res = stepBall(h, b, t, PHYS_DT, null);
        t += PHYS_DT;
        if (pathOut && ++n % pathEvery === 0) pathOut.push(b.x, b.z);
        if (res) break;
    }
    return { x: b.x, z: b.z, res: res || 'rest', t: t - t0 };
}

// ── Bot helpers ────────────────────────────────────────────────────────────
export function hasLOS(h, ax, az, bx, bz) {
    for (const w of h.walls) if (segsCross(ax, az, bx, bz, w[0], w[1], w[2], w[3])) return false;
    return true;
}
// Rough "strokes-distance" left: walking distance along the waypoint path
export function pathCost(h, x, z) {
    let best = Infinity;
    for (let i = 0; i < h.path.length; i++) {
        const [px, pz] = h.path[i];
        if (!hasLOS(h, x, z, px, pz)) continue;
        best = Math.min(best, Math.hypot(px - x, pz - z) + h.pathRem[i]);
    }
    if (best === Infinity) {
        for (let i = 0; i < h.path.length; i++)
            best = Math.min(best, Math.hypot(h.path[i][0] - x, h.path[i][1] - z) + h.pathRem[i] + 8);
    }
    return best;
}
// The furthest waypoint visible from (x,z) — a sensible default aim direction
export function aimHint(h, x, z) {
    let best = null, bc = Infinity;
    for (let i = 0; i < h.path.length; i++) {
        const [px, pz] = h.path[i];
        if (Math.hypot(px - x, pz - z) < 0.3 || !hasLOS(h, x, z, px, pz)) continue;
        const c = Math.hypot(px - x, pz - z) + h.pathRem[i];
        if (c < bc) { bc = c; best = [px, pz]; }
    }
    return best || h.cup;
}

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Incremental shot planner: call .work(ms) each frame until .done
export function planShot(h, x, z, t0, skill = 0.8) {
    const base = aimHint(h, x, z);
    const baseA = Math.atan2(base[0] - x, base[1] - z);
    const cands = [];
    for (let da = -60; da <= 60; da += 7.5) for (const sp of [1.2, 1.8, 2.5, 3.2, 4, 4.8, 5.7, 6.7, 7.8, 8.8])
        cands.push([baseA + da * Math.PI / 180, sp]);
    let i = 0, best = null, phase = 0;
    const startCost = pathCost(h, x, z);
    const score = (a, sp) => {
        const r = simulate(h, x, z, Math.sin(a) * sp, Math.cos(a) * sp, t0);
        if (r.res === 'holed') return -100 + r.t * 0.01;
        if (r.res === 'ob') return startCost + 4;
        return pathCost(h, r.x, r.z) + (inSand(h, r.x, r.z) ? 1.5 : 0);
    };
    const plan = {
        done: false, a: baseA, speed: 3,
        work(ms) {
            const end = performance.now() + ms;
            while (performance.now() < end && !plan.done) {
                if (i < cands.length) {
                    const [a, sp] = cands[i++];
                    const s = score(a, sp);
                    if (!best || s < best.s) best = { a, sp, s };
                } else if (phase === 0) {
                    // Refine around the best coarse shot
                    const b0 = best; phase = 1;
                    for (let da = -3; da <= 3; da += 1) for (let ds = -0.45; ds <= 0.45; ds += 0.15)
                        if (da || ds) cands.push([b0.a + da * Math.PI / 180, Math.max(0.6, b0.sp + ds)]);
                } else {
                    // Human-ish error: worse bots miss more
                    const err = 1 - skill;
                    plan.a = best.a + gauss() * err * 0.09;          // ~1° spread at skill 0.8
                    plan.speed = Math.min(MAX_SPEED, best.sp * (1 + gauss() * err * 0.14));
                    plan.done = true;
                }
            }
            return plan.done;
        },
    };
    return plan;
}

export const HOLE_COUNT = HOLES.length;
export function scoreName(strokes, par) {
    if (strokes === 1) return 'HOLE IN ONE!';
    const d = strokes - par;
    return d <= -3 ? 'Albatross!' : d === -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' :
           d === 1 ? 'Bogey' : d === 2 ? 'Double Bogey' : `+${d}`;
}
