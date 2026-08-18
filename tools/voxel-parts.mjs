#!/usr/bin/env node
/**
 * voxel-parts.mjs — automatic bone split for voxelized animal models.
 *
 * Works on the GRID-SPACE boxes produced by voxelize() ({x, z, y0, y1, color}):
 *   1. dropPedestal  — remove a flat backdrop/cloth sheet at the bottom
 *   2. orient        — flip x/z so the head side becomes +Z (Bedrock front)
 *   3. legs          — narrow columns growing up from the ground; if none
 *                      (belly-dragging models), sparse x-columns in the
 *                      lower region
 *   4. head          — topmost protrusion (BFS down until the region widens)
 *   5. wings         — sparse x-columns in the upper region (sides)
 *   6. z-protrusions — sparse z-columns in the upper region: at both z-ends
 *                      = swept wings, at one end = tail
 *   7. body          — everything remaining
 *
 * Returns cell sets per part; the caller re-merges cells into column-run
 * boxes and builds Bedrock bones + animations.
 */
export function cellKey(x, y, z) { return `${x},${y},${z}`; }
export function parseKey(k) { const [x, y, z] = k.split(',').map(Number); return [x, y, z]; }

export function dropPedestal(boxes) {
    let mnY = Infinity, mxY = -Infinity;
    for (const b of boxes) { mnY = Math.min(mnY, b.y0); mxY = Math.max(mxY, b.y1); }
    const cnt = new Array(mxY - mnY + 1).fill(0);
    for (const b of boxes) for (let y = b.y0; y <= b.y1; y++) cnt[y - mnY]++;
    const maxC = Math.max(...cnt);
    let dropTo = mnY - 1;
    for (let y = mnY; y <= mxY; y++) { if (cnt[y - mnY] >= 0.6 * maxC) dropTo = y; else break; }
    if (dropTo < mnY) return boxes;
    // Leikkaa pedestal-solut pois — myös laatikoista jotka ulottuvat mallin
    // puolelle (dropPedestal ei saa poistaa kokonaista pylvästä).
    const out = [];
    for (const b of boxes) {
        const y0 = Math.max(b.y0, dropTo + 1);
        if (y0 <= b.y1) out.push({ ...b, y0 });
    }
    return out;
}

export function boxesToCells(boxes) {
    const cells = new Set();
    const cellBox = new Map(); // key -> box index
    boxes.forEach((b, i) => {
        for (let y = b.y0; y <= b.y1; y++) {
            const k = cellKey(b.x, y, b.z);
            cells.add(k);
            cellBox.set(k, i);
        }
    });
    return { cells, cellBox };
}

export function levelComps(cells, y) {
    const seen = new Set();
    const comps = [];
    for (const k of cells) {
        const [, yy] = parseKey(k);
        if (yy !== y || seen.has(k)) continue;
        const stack = [k]; seen.add(k);
        const comp = [];
        while (stack.length) {
            const ck = stack.pop();
            comp.push(ck);
            const [x, , z] = parseKey(ck);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nk = cellKey(x + dx, y, z + dz);
                if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
            }
        }
        comps.push(comp);
    }
    return comps;
}

export function bboxOf(keys) {
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (const k of keys) {
        const [x, y, z] = parseKey(k);
        mnX = Math.min(mnX, x); mxX = Math.max(mxX, x);
        mnY = Math.min(mnY, y); mxY = Math.max(mxY, y);
        mnZ = Math.min(mnZ, z); mxZ = Math.max(mxZ, z);
    }
    return { mnX, mxX, mnY, mxY, mnZ, mxZ };
}

/** Narrow columns growing up from the ground (separate legs at ground plane). */
function legsFromGround(cells, minY) {
    const leg = new Set();
    const comps = levelComps(cells, minY);
    let frontier = [];
    for (const comp of comps) {
        const bb = bboxOf(comp);
        if (bb.mxX - bb.mnX <= 7 && bb.mxZ - bb.mnZ <= 7) {
            for (const k of comp) { leg.add(k); frontier.push(k); }
        }
    }
    let y = minY + 1;
    while (frontier.length) {
        const prev = frontier;
        const compsY = levelComps(cells, y);
        if (!compsY.length) break;
        const next = [];
        const used = new Set();
        for (const k of prev) {
            const [x, , z] = parseKey(k);
            const nk = cellKey(x, y, z);
            if (!cells.has(nk)) continue;
            const ci = compsY.findIndex(c => c.includes(nk));
            if (ci < 0 || used.has(ci)) continue;
            const bb = bboxOf(compsY[ci]);
            if (bb.mxX - bb.mnX <= 7 && bb.mxZ - bb.mnZ <= 7) {
                used.add(ci);
                for (const ck of compsY[ci]) { leg.add(ck); next.push(ck); }
            }
        }
        frontier = next;
        y++;
    }
    return leg;
}

/** Sparse x-column cells in the lower region (belly-dragging models). */
function legsFromSparse(cells) {
    const bb = bboxOf(cells);
    const xcnt = new Map();
    for (const k of cells) { const [x] = parseKey(k); xcnt.set(x, (xcnt.get(x) || 0) + 1); }
    const maxC = Math.max(...xcnt.values());
    const sparse = new Set();
    for (const [x, c] of xcnt) if (c < 0.35 * maxC) sparse.add(x);
    if (!sparse.size) return new Set();
    const lower = bb.mnY + 0.3 * (bb.mxY - bb.mnY);
    const leg = new Set();
    for (const k of cells) {
        const [x, y] = parseKey(k);
        if (sparse.has(x) && y <= lower) leg.add(k);
    }
    return leg;
}

/** Topmost protrusion: BFS down from the highest cells while the region stays narrow. */
function findHead(cells, exclude) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return new Set();
    const bb = bboxOf(rem);
    const region = new Set([...rem].filter(k => { const [, y] = parseKey(k); return y === bb.mxY; }));
    for (let y = bb.mxY - 1; y >= bb.mnY; y--) {
        const compsY = levelComps(rem, y);
        const proj = new Set([...region].map(k => { const [x, , z] = parseKey(k); return cellKey(x, y, z); }));
        const used = new Set();
        let grew = false;
        for (const k of proj) {
            if (!rem.has(k)) continue;
            const ci = compsY.findIndex(c => c.includes(k));
            if (ci < 0 || used.has(ci)) continue;
            const cb = bboxOf(compsY[ci]);
            if (cb.mxX - cb.mnX >= 12 || cb.mxZ - cb.mnZ >= 12) continue;
            used.add(ci);
            for (const ck of compsY[ci]) region.add(ck);
            grew = true;
        }
        if (!grew) break;
    }
    return region;
}

/** Sparse x-column cells in the upper region (spread wings / side protrusions). */
function findXWings(cells, exclude) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return new Set();
    const bb = bboxOf(rem);
    const xcnt = new Map();
    for (const k of rem) { const [x] = parseKey(k); xcnt.set(x, (xcnt.get(x) || 0) + 1); }
    const maxC = Math.max(...xcnt.values());
    const sparse = new Set();
    for (const [x, c] of xcnt) if (c < 0.35 * maxC) sparse.add(x);
    const upper = bb.mnY + 0.35 * (bb.mxY - bb.mnY);
    const wing = new Set();
    for (const k of rem) {
        const [x, y] = parseKey(k);
        if (sparse.has(x) && y >= upper) wing.add(k);
    }
    return wing;
}

/** Sparse z-column cells in the upper region (tail or swept wings). */
function findZProtrusions(cells, exclude) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return { cells: new Set(), minZ: 0, maxZ: 0 };
    const bb = bboxOf(rem);
    const zcnt = new Map();
    for (const k of rem) { const [, , z] = parseKey(k); zcnt.set(z, (zcnt.get(z) || 0) + 1); }
    const maxC = Math.max(...zcnt.values());
    const sparse = new Set();
    for (const [z, c] of zcnt) if (c < 0.35 * maxC) sparse.add(z);
    const upper = bb.mnY + 0.3 * (bb.mxY - bb.mnY);
    const out = new Set();
    for (const k of rem) {
        const [, y, z] = parseKey(k);
        if (sparse.has(z) && y >= upper) out.add(k);
    }
    return out;
}

/** Cluster cells into connected groups (6-connectivity via column boxes). */
export function clusterCells(cells) {
    // build per-column runs to get adjacency cheaply: group by (x,z), y-runs
    const cols = new Map(); // "x,z" -> array of [y0, y1]
    for (const k of cells) {
        const [x, y, z] = parseKey(k);
        const key = x + ',' + z;
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(y);
    }
    // union-find over runs
    const runs = []; // {x, z, y0, y1}
    const runCells = []; // cells per run
    for (const [key, ys] of cols) {
        const [x, z] = key.split(',').map(Number);
        ys.sort((a, b) => a - b);
        let start = ys[0], prev = ys[0];
        const cl = [];
        for (let i = 1; i <= ys.length; i++) {
            const y = ys[i];
            if (y === prev + 1) { prev = y; continue; }
            runs.push({ x, z, y0: start, y1: prev });
            const ck = [];
            for (let yy = start; yy <= prev; yy++) ck.push(cellKey(x, yy, z));
            runCells.push(ck);
            if (i < ys.length) { start = ys[i]; prev = ys[i]; }
        }
    }
    const parent = runs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    // adjacency: same (x,z) adjacent runs already merged; check x±1, z±1 overlaps
    const byCol = new Map();
    runs.forEach((r, i) => {
        const key = r.x + ',' + r.z;
        if (!byCol.has(key)) byCol.set(key, []);
        byCol.get(key).push(i);
    });
    for (const [key, idxs] of byCol) {
        const [x, z] = key.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = (x + dx) + ',' + (z + dz);
            if (!byCol.has(nk)) continue;
            for (const i of idxs) for (const j of byCol.get(nk)) {
                if (runs[i].y0 <= runs[j].y1 && runs[j].y0 <= runs[i].y1) union(i, j);
            }
        }
    }
    const groups = new Map();
    runs.forEach((_, i) => {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, new Set());
        for (const ck of runCells[i]) groups.get(r).add(ck);
    });
    return [...groups.values()];
}

/**
 * Main classification. Returns:
 *   { flip: bool, parts: { body, head, legs: [{name, cells}], wings: [{name, cells, axis}], tail }, report }
 * All cell sets contain "x,y,z" keys. The input boxes are grid-space.
 */
export function classifyVoxelParts(boxes) {
    const clean = dropPedestal(boxes);
    let { cells } = boxesToCells(clean);
    let bb = bboxOf(cells);
    const report = {};

    // ---- orientation: head side -> +Z. Head is found before flipping by
    // the topmost-protrusion rule (orientation-independent), then we flip
    // x and z around the center so the head ends up at large z (front).
    const headPre = findHead(cells, new Set());
    let flip = false;
    if (headPre.size) {
        const hb = bboxOf(headPre);
        const mid = (bb.mnZ + bb.mxZ) / 2;
        if (hb.mnZ < mid && hb.mxZ < mid) flip = true; // head at small-z side
    }
    if (flip) {
        const flipX = bb.mnX + bb.mxX;
        const flipZ = bb.mnZ + bb.mxZ;
        const flipped = new Set();
        for (const k of cells) {
            const [x, y, z] = parseKey(k);
            flipped.add(cellKey(flipX - x, y, flipZ - z));
        }
        cells = flipped;
        bb = bboxOf(cells);
    }
    report.flip = flip;

    // ---- legs (method A: ground columns)
    let legCells = legsFromGround(cells, bb.mnY);
    const legClusters = clusterCells(legCells);
    let legs = legClusters.filter(c => c.size >= 4);
    if (legs.length < 2) {
        // method B: belly-dragging model (e.g. dragon)
        const sparseLegs = legsFromSparse(cells);
        legCells = sparseLegs;
        legs = clusterCells(sparseLegs).filter(c => c.size >= 4);
    }
    report.legs = legs.map(c => ({ cells: c.size, bb: bboxOf(c) }));

    // ---- head
    const head = findHead(cells, legCells);
    report.head = { cells: head.size, bb: bboxOf(head) };

    // ---- wings (sparse x-columns, upper)
    const xWings = findXWings(cells, new Set([...legCells, ...head]));
    report.xWings = xWings.size;
    // ---- z-protrusions (tail or swept wings)
    const zProts = findZProtrusions(cells, new Set([...legCells, ...head, ...xWings]));
    report.zProts = zProts.size;

    // body center (for side assignment)
    const bodyPre = new Set([...cells].filter(k => !legCells.has(k) && !head.has(k)));
    const bodyBb = bboxOf(bodyPre);
    const bodyCx = (bodyBb.mnX + bodyBb.mxX) / 2;
    const bodyCz = (bodyBb.mnZ + bodyBb.mxZ) / 2;

    // assemble wing groups: x-wings split left/right; z-protrusions at both
    // z-ends become wings too, one end = tail
    const wings = [];
    const tail = new Set();
    const xWingClusters = clusterCells(xWings).filter(c => c.size >= 8);
    for (const cl of xWingClusters) {
        const cb = bboxOf(cl);
        const side = (cb.mnX + cb.mxX) / 2 < bodyCx ? 'left' : 'right';
        const axis = (cb.mxX - cb.mnX) >= (cb.mxZ - cb.mnZ) ? 'z' : 'x';
        wings.push({ side, axis, cells: cl });
    }
    const zClusters = clusterCells(zProts).filter(c => c.size >= 6);
    const lowZ = zClusters.filter(c => { const cb = bboxOf(c); return (cb.mnZ + cb.mxZ) / 2 < bodyCz; });
    const highZ = zClusters.filter(c => { const cb = bboxOf(c); return (cb.mnZ + cb.mxZ) / 2 > bodyCz; });
    if (lowZ.length && highZ.length) {
        // swept wings at both ends -> wings
        for (const cl of [...lowZ, ...highZ]) {
            const cb = bboxOf(cl);
            const side = (cb.mnZ + cb.mxZ) / 2 < bodyCz ? 'left' : 'right';
            wings.push({ side, axis: 'x', cells: cl, fromZ: true });
        }
    } else {
        for (const cl of [...lowZ, ...highZ]) for (const k of cl) tail.add(k);
    }
    // dedupe wing cells (a cell can't be in two wings)
    const wingCells = new Set();
    for (const w of wings) for (const k of w.cells) wingCells.add(k);

    // ---- body: everything remaining
    const body = new Set();
    for (const k of cells) {
        if (!legCells.has(k) && !head.has(k) && !wingCells.has(k) && !tail.has(k)) body.add(k);
    }
    report.body = { cells: body.size, bb: bboxOf(body) };
    report.wings = wings.map(w => ({ side: w.side, axis: w.axis, fromZ: !!w.fromZ, cells: w.cells.size, bb: bboxOf(w.cells) }));
    report.tail = tail.size;

    // finalize leg names & side/front-back
    const legList = [];
    for (let i = 0; i < legs.length; i++) {
        const cl = legs[i];
        const cb = bboxOf(cl);
        const side = (cb.mnX + cb.mxX) / 2 < bodyCx ? 'left' : 'right';
        const front = (cb.mnZ + cb.mxZ) / 2 > bodyCz; // +Z = front after flip
        legList.push({ name: side + (front ? '_front' : '_back'), side, front, cells: cl });
    }

    return {
        flip,
        parts: {
            body,
            head,
            legs: legList,
            wings,
            tail
        },
        bodyCx,
        bodyCz,
        report
    };
}
