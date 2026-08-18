#!/usr/bin/env node
/**
 * voxel-parts.mjs — automatic bone split for voxelized animal models.
 *
 * Works on the GRID-SPACE boxes produced by voxelize() ({x, z, y0, y1, color}):
 *   1. dropPedestal — remove a flat backdrop/cloth sheet at the bottom
 *   2. orient       — flip x/z so the head side becomes +Z (Bedrock front)
 *   3. legs         — narrow columns growing up from the ground; if unusable,
 *                     sparse x-columns in the lower region (dragon belly pose)
 *   4. head         — BFS down from the highest cells while the cross-section
 *                     stays small (stops the moment the neck meets the body)
 *   5. wings        — sparse x-columns OUTSIDE the dense body core (sides)
 *   6. tail / swept wings — BFS probes from the back and front z-ends; the
 *                     back probe is the tail; when side wings are absent and
 *                     both probes are substantial, they are swept wings
 *   7. body         — everything remaining
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
    // Jalusta = leveä pohjalevy, jonka YLÄPUOLELLA jalkajälki kaventuu jyrkästi
    // (esim. lohikäärmeen "Cloth Backdrop"). Tasainen pinta (esim. laatikko,
    // jonka jokainen kerros on yhtä leveä) EI ole jalusta — muuten koko malli
    // katoaisi vokseloinnista.
    let dropTo = mnY - 1;
    for (let y = mnY; y <= mxY; y++) {
        const below = cnt[y - mnY];
        if (below < 0.6 * maxC) break;
        let shrinks = false;
        for (let yy = y + 1; yy <= Math.min(mxY, y + 3); yy++) {
            if (cnt[yy - mnY] < below * 0.7) { shrinks = true; break; }
        }
        if (!shrinks) break;
        dropTo = y;
    }
    if (dropTo < mnY) return boxes;
    // Leikkaa pedestal-solut pois — myös laatikoista jotka ulottuvat mallin puolelle.
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

/**
 * Narrow columns growing up from the ground (separate legs at ground plane).
 * Rajoite: jalan poikkileikkaus saa olla enintään 10×7 solua — syvyys (z)
 * on ratkaiseva, koska rungon poikkileikkaus on aina pitkä (z-suunta) vaikka
 * se olisi kapea (karhun jalat levenevät x-suunnassa ja olivat siksi
 * ennen 7×7-rajoituksella "1-kerroksisia nysiä").
 */
function legsFromGround(cells, minY, modelTop) {
    const leg = new Set();
    const comps = levelComps(cells, minY);
    let frontier = [];
    for (const comp of comps) {
        const bb = bboxOf(comp);
        if (bb.mxX - bb.mnX <= 10 && bb.mxZ - bb.mnZ <= 7) {
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
            if (bb.mxX - bb.mnX <= 10 && bb.mxZ - bb.mnZ <= 7) {
                used.add(ci);
                for (const ck of compsY[ci]) { leg.add(ck); next.push(ck); }
            }
        }
        frontier = next;
        y++;
    }
    // Tosi jalka ei yllä mallin ylimpään neljännekseen — lentävien lintujen
    // levitetyt siivet ulottuvat maasta mallin kattoon asti ja näyttäisivät
    // jaloilta, jos niitä ei hylättäisi.
    const keep = new Set();
    for (const k of leg) {
        const [, yk] = parseKey(k);
        if (yk <= modelTop - (modelTop - minY) * 0.25) keep.add(k);
    }
    return keep;
}

/** Sparse x-column cells in the lower region (belly-dragging models). */
function legsFromSparse(cells) {
    const bb = bboxOf(cells);
    const xcnt = new Map();
    for (const k of cells) { const [x] = parseKey(k); xcnt.set(x, (xcnt.get(x) || 0) + 1); }
    const maxC = Math.max(...xcnt.values());
    const dense = new Set();
    for (const [x, c] of xcnt) if (c >= 0.5 * maxC) dense.add(x);
    let coreMin = Infinity, coreMax = -Infinity;
    for (const x of dense) { coreMin = Math.min(coreMin, x); coreMax = Math.max(coreMax, x); }
    const lower = bb.mnY + 0.3 * (bb.mxY - bb.mnY);
    const leg = new Set();
    for (const k of cells) {
        const [x, y] = parseKey(k);
        if (x < coreMin - 1 || x > coreMax + 1) {
            const c = xcnt.get(x);
            if (c < 0.35 * maxC && y <= lower) leg.add(k);
        }
    }
    return leg;
}

/** Level components along a given axis (connectivity in the other two). */
function levelCompsAxis(cells, axis, level) {
    const other = [0, 1, 2].filter(a => a !== axis);
    const seen = new Set();
    const comps = [];
    for (const k of cells) {
        const p = parseKey(k);
        if (p[axis] !== level || seen.has(k)) continue;
        const stack = [k]; seen.add(k);
        const comp = [];
        while (stack.length) {
            const ck = stack.pop();
            comp.push(ck);
            const cp = parseKey(ck);
            for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const np = cp.slice();
                np[other[0]] += da;
                np[other[1]] += db;
                const nk = cellKey(np[0], np[1], np[2]);
                if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
            }
        }
        comps.push(comp);
    }
    return comps;
}

/**
 * Protrusion BFS along one axis, starting from the LARGEST component at the
 * extreme level, growing toward the body. Stops when the connected component
 * reaches the body: its extent in either of the other two axes fills >= 60%
 * of the MODEL's extent in that axis (or >= 12 cells).
 *   axis: 0=x, 1=y, 2=z   growDir: +1 (from min level) or -1 (from max level)
 *   modelBb: bbox of the FULL model (before part removal)
 */
function findProtrusion(cells, exclude, axis, growDir, modelBb) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return { cells: new Set(), stopped: false };
    const bb = bboxOf(rem);
    const coord = (k) => parseKey(k)[axis];
    const lo = axis === 0 ? bb.mnX : axis === 1 ? bb.mnY : bb.mnZ;
    const hi = axis === 0 ? bb.mxX : axis === 1 ? bb.mxY : bb.mxZ;
    const modelExt = [
        modelBb.mxX - modelBb.mnX + 1,
        modelBb.mxY - modelBb.mnY + 1,
        modelBb.mxZ - modelBb.mnZ + 1
    ];
    const start = growDir > 0 ? lo : hi;
    const comps0 = levelCompsAxis(rem, axis, start);
    let best = null;
    for (const comp of comps0) if (!best || comp.length > best.length) best = comp;
    if (!best || !best.length) return { cells: new Set(), stopped: false };
    const region = new Set(best);
    let stoppedFlag = false;
    for (let lvl = start + growDir; lvl >= lo && lvl <= hi; lvl += growDir) {
        const comps = levelCompsAxis(rem, axis, lvl);
        let stopped = false;
        for (const comp of comps) {
            // connected to the region at the previous level?
            let connected = false;
            for (const k of comp) {
                const p = parseKey(k);
                if (region.has(cellKey(
                    axis === 0 ? lvl - growDir : p[0],
                    axis === 1 ? lvl - growDir : p[1],
                    axis === 2 ? lvl - growDir : p[2]
                ))) { connected = true; break; }
            }
            if (!connected) continue;
            const cb = bboxOf(comp);
            const wOther = axis === 1
                ? [cb.mxX - cb.mnX + 1, cb.mxZ - cb.mnZ + 1]
                : [cb.mxX - cb.mnX + 1, cb.mxY - cb.mnY + 1];
            const stop = wOther[0] >= 0.6 * modelExt[0] || wOther[1] >= 0.6 * modelExt[axis === 1 ? 2 : 1];
            // selaimessa (drag & drop -vokselointi) process on määrittelemätön
            if (typeof process !== 'undefined' && process.env.VOX_DEBUG) console.error('  [probe axis' + axis + (growDir > 0 ? ' back' : ' front') + ' lvl' + lvl + '] n' + comp.length, 'x' + cb.mnX + '-' + cb.mxX, 'y' + cb.mnY + '-' + cb.mxY, 'z' + cb.mnZ + '-' + cb.mxZ, stop ? 'STOP' : 'add');
            if (stop) { stopped = true; stoppedFlag = true; break; }
            for (const ck of comp) region.add(ck);
        }
        if (stopped) break;
        let addedHere = false;
        for (const k of region) if (coord(k) === lvl) { addedHere = true; break; }
        if (!addedHere) break;
    }
    return { cells: region, stopped: stoppedFlag };
}

/**
 * Head detection for NON-bird models. Walks down from the topmost cells and
 * stops where the protrusion meets the body, with two rules:
 *   A. neck-dip — the cross-section area dips (neck) and then jumps back up
 *      sharply (area >= 1.6x the dip level) => stop right above the body
 *   B. long-axis — the comp's extent along the model's longest horizontal
 *      axis reaches >= 0.55x the model's extent (bodies are long, heads/necks
 *      are not). This is why the old "0.6x of WIDTH" rule failed: a
 *      quadruped's neck is ~as wide as its body, so the head stopped after
 *      1-2 layers (flat pancake head).
 *   C. hard cap — extent >= 0.9x (blob models without a neck)
 */
function findHead(cells, exclude, modelBb) {
    const rem = new Set([...cells].filter((k) => !exclude.has(k)));
    if (!rem.size) return { cells: new Set(), stopped: false };
    const bb = bboxOf(rem);
    const extX = modelBb.mxX - modelBb.mnX + 1;
    const extZ = modelBb.mxZ - modelBb.mnZ + 1;
    const longAxis = extZ >= extX ? 'z' : 'x';
    const longExt = longAxis === 'z' ? extZ : extX;
    const region = new Set();
    const areas = [];
    let stopped = false;
    for (let y = bb.mxY; y >= bb.mnY; y--) {
        const comps = levelCompsAxis(rem, 1, y);
        let sel = null;
        if (region.size) {
            outer:
            for (const c of comps) {
                for (const k of c) {
                    const p = parseKey(k);
                    if (region.has(cellKey(p[0], y + 1, p[2]))) { sel = c; break outer; }
                }
            }
        } else {
            for (const c of comps) if (!sel || c.length > sel.length) sel = c;
        }
        if (!sel) break;
        const cb = bboxOf(sel);
        const len = longAxis === 'z' ? cb.mxZ - cb.mnZ + 1 : cb.mxX - cb.mnX + 1;
        const area = sel.length;
        const dip = areas.length >= 3 && area >= 1.6 * areas[areas.length - 1] && areas[areas.length - 1] <= 1.3 * areas[areas.length - 2];
        if (region.size >= 8 && (len >= 0.55 * longExt || dip)) { stopped = true; break; }
        if (len >= 0.9 * longExt) { stopped = true; break; }
        for (const k of sel) region.add(k);
        areas.push(area);
    }
    return { cells: region, stopped };
}

/** Sparse x-column cells OUTSIDE the dense body core (spread wings / sides). */
function findXWings(cells, exclude) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return new Set();
    const bb = bboxOf(rem);
    const xcnt = new Map();
    for (const k of rem) { const [x] = parseKey(k); xcnt.set(x, (xcnt.get(x) || 0) + 1); }
    const maxC = Math.max(...xcnt.values());
    const dense = new Set();
    for (const [x, c] of xcnt) if (c >= 0.5 * maxC) dense.add(x);
    let coreMin = Infinity, coreMax = -Infinity;
    for (const x of dense) { coreMin = Math.min(coreMin, x); coreMax = Math.max(coreMax, x); }
    const upper = bb.mnY + 0.35 * (bb.mxY - bb.mnY);
    const wing = new Set();
    for (const k of rem) {
        const [x, y] = parseKey(k);
        if (x < coreMin - 1 || x > coreMax + 1) {
            const c = xcnt.get(x);
            if (c < 0.4 * maxC && y >= upper) wing.add(k);
        }
    }
    return wing;
}

/**
 * Z-suuntaiset (taaksepäin laskostetut / vartaloa vasten taitetut) siivet:
 * ohuet sivulaatat rungon tiheän x-ytimen ULKOPUOLELLA, molemmilla puolilla.
 * Esim. lohikäärme: 2 solua paksut laatat x-ytimen ulkopuolella, 20 solua
 * pitkät z-suunnassa. x-pylväsetsintä (findXWings) ei löydä niitä, koska ne
 * eivät ole yläalueella eivätkä ylitä ±1 marginaalia — ne imeytyivät
 * vartaloon eikä lohikäärmeellä ollut siipiä lainkaan.
 * Palauttaa: { left: {cells, pivot} | null, right: {...} | null }
 */
function findZSweptWings(cells, exclude, modelCx, modelBb) {
    const rem = new Set([...cells].filter(k => !exclude.has(k)));
    if (!rem.size) return { left: null, right: null };
    const xcnt = new Map();
    for (const k of rem) { const [x] = parseKey(k); xcnt.set(x, (xcnt.get(x) || 0) + 1); }
    const maxC = Math.max(...xcnt.values());
    const dense = new Set();
    for (const [x, c] of xcnt) if (c >= 0.5 * maxC) dense.add(x);
    let coreMin = Infinity, coreMax = -Infinity;
    for (const x of dense) { coreMin = Math.min(coreMin, x); coreMax = Math.max(coreMax, x); }
    const outer = new Set();
    for (const k of rem) {
        const [x] = parseKey(k);
        if (x < coreMin || x > coreMax) outer.add(k);
    }
    const modelZ = modelBb.mxZ - modelBb.mnZ + 1;
    const modelY = modelBb.mxY - modelBb.mnY + 1;
    const bySide = { left: null, right: null };
    for (const cl of clusterCells(outer)) {
        if (cl.size < 30) continue;
        const cb = bboxOf(cl);
        const xLen = cb.mxX - cb.mnX + 1, yLen = cb.mxY - cb.mnY + 1, zLen = cb.mxZ - cb.mnZ + 1;
        // ohut pitkä sivulaatta: pituus ≥ 30 % mallin pituudesta, korkeus
        // ≥ 20 % korkeudesta, paksuus 2–5 solua JA korkeintaan 15 % mallin
        // leveydestä (1-solun rivit ovat rungon kylkisoluja — wolf/lion/horse
        // saivat tästä väärät siivet; dino's T-rex-kyynärvarret ovat 2 solua
        // vain 8 leveässä mallissa = 25 % — ei siipiä), eikä se kosketa maata
        // (nelijalkaisten reisimassa on maassa — vain siivet ovat koholla;
        // lohikäärmeen laskostetut siivet alkavat jalkojen yläpuolelta)
        const clearance = cb.mnY - modelBb.mnY;
        const modelW = modelBb.mxX - modelBb.mnX + 1;
        if (zLen < 0.3 * modelZ || yLen < 0.2 * modelY || xLen < 2 || xLen > 5 || xLen > 0.15 * modelW || clearance < 0.1 * modelY) continue;
        const side = (cb.mnX + cb.mxX) / 2 < modelCx ? 'left' : 'right';
        if (!bySide[side]) bySide[side] = cl;
    }
    return bySide;
}

/** Cluster cells into connected groups (6-connectivity via column boxes). */
export function clusterCells(cells) {
    const cols = new Map(); // "x,z" -> array of y
    for (const k of cells) {
        const [x, y, z] = parseKey(k);
        const key = x + ',' + z;
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(y);
    }
    const runs = [];
    const runCells = [];
    for (const [key, ys] of cols) {
        const [x, z] = key.split(',').map(Number);
        ys.sort((a, b) => a - b);
        let start = ys[0], prev = ys[0];
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

/** Split merged leg clusters into left/right parts around the model center-x. */
function splitLegSides(clusters, modelCx) {
    const out = [];
    for (const cl of clusters) {
        const left = new Set(), right = new Set();
        for (const k of cl) {
            const [x] = parseKey(k);
            if (x < modelCx) left.add(k); else right.add(k);
        }
        if (left.size && right.size) out.push(left, right);
        else out.push(cl);
    }
    return out;
}

/**
 * Main classification. Returns:
 *   { flip, parts: { body, head, legs: [{name, cells}], wings: [{name, side, axis, cells}], tail }, bodyCx, bodyCz, modelCx, report }
 */
export function classifyVoxelParts(boxes) {
    const clean = dropPedestal(boxes);
    let boxesSpace = clean; // sama avaruus kuin parts-soluilla (flipin jälkeen)
    let { cells } = boxesToCells(clean);
    let bb = bboxOf(cells);
    const report = {};

    // ---- orientation: head side -> +Z (flip x & z around the model center)
    const headPre = findProtrusion(cells, new Set(), 1, -1, bb).cells;
    let flip = false;
    if (headPre.size) {
        const hb = bboxOf(headPre);
        const mid = (bb.mnZ + bb.mxZ) / 2;
        if ((hb.mnZ + hb.mxZ) / 2 < mid) flip = true;
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
        boxesSpace = clean.map((b) => ({ ...b, x: flipX - b.x, z: flipZ - b.z }));
    }
    report.flip = flip;
    const modelCx = (bb.mnX + bb.mxX) / 2;
    const modelW = bb.mxX - bb.mnX + 1;
    const modelH = bb.mxY - bb.mnY + 1;
    // Lentävä lintu (leveys > 1.6 × korkeus, siivet levällään) — jalat eivät
    // kosketa maata; siivetkin ulottuvat maatasoon ja näyttäisivät jaloilta.
    const birdLike = modelW > 1.6 * modelH;
    report.birdLike = birdLike;

    // ---- legs
    const legA = birdLike ? [] : clusterCells(legsFromGround(cells, bb.mnY, bb.mxY)).filter(c => c.size >= 5);
    const legB = clusterCells(legsFromSparse(cells)).filter(c => c.size >= 5);
    let legs;
    if (legA.length >= 2) legs = legA;
    else if (legB.length >= 2) legs = legB;
    else if (legA.length === 1 && (!legB.length || legA[0].size >= legB[0].size)) legs = legA;
    else if (legB.length === 1) legs = legB;
    else legs = legA;
    const legCells = new Set();
    for (const cl of legs) for (const k of cl) legCells.add(k);
    report.legs = legs.map(c => ({ cells: c.size, bb: bboxOf(c) }));

    // ---- head
    // Lintumaisilla (levitetyt siivet) vanha löytää pään luotettavammin
    // (siiven kärki voi olla mallin ylin piste); nelijalkaisilla uusi
    // findHead käyttää kaula-dippiä + pitkää akselia (ei leveyttä).
    const head = birdLike
        ? findProtrusion(cells, legCells, 1, -1, bb).cells
        : findHead(cells, legCells, bb).cells;
    report.head = { cells: head.size, bb: bboxOf(head) };

    // ---- wings (sparse x-columns outside the dense core, upper region)
    const xWings = findXWings(cells, new Set([...legCells, ...head]));
    report.xWings = xWings.size;

    // body center (for side assignment)
    const bodyPre = new Set([...cells].filter(k => !legCells.has(k) && !head.has(k)));
    const bodyBb = bboxOf(bodyPre);
    const bodyCx = (bodyBb.mnX + bodyBb.mxX) / 2;
    const bodyCz = (bodyBb.mnZ + bodyBb.mxZ) / 2;

    // ---- z-suuntaiset (laskostetut) sivusiivet — esim. lohikäärme
    const zSwept = findZSweptWings(cells, new Set([...legCells, ...head, ...xWings]), modelCx, bb);
    report.zSwept = { left: zSwept.left ? zSwept.left.size : 0, right: zSwept.right ? zSwept.right.size : 0 };

    // assemble wing groups: merge all clusters per side into ONE wing bone.
    const wingClusters = clusterCells(xWings);
    if (zSwept.left) wingClusters.push(zSwept.left);
    if (zSwept.right) wingClusters.push(zSwept.right);
    const xWingSides = { left: 0, right: 0 };
    for (const cl of clusterCells(xWings)) {
        const cb = bboxOf(cl);
        const side = (cb.mnX + cb.mxX) / 2 < bodyCx ? 'left' : 'right';
        xWingSides[side] += cl.size;
    }
    const substantialXWings = xWingSides.left >= 30 && xWingSides.right >= 30;

    // ---- tail / swept wings: BFS probes from the back (min z) and front
    // (max z). Kun sivusiivet ovat jo olemassa (esim. storkki, jonka siivet
    // löytyvät x-pylväinä), z-probeja EI ajeta — muuten ohut runko imeytyy
    // probeihin ja vartalosta jää vain murusia.
    let backProbe = new Set(), frontProbe = new Set();
    let backStopped = false, frontStopped = false;
    const zSweptCells = new Set();
    if (zSwept.left) for (const k of zSwept.left) zSweptCells.add(k);
    if (zSwept.right) for (const k of zSwept.right) zSweptCells.add(k);
    if (!substantialXWings && zSweptCells.size === 0) {
        const probeExclude = new Set([...legCells, ...head, ...xWings]);
        const bp = findProtrusion(cells, probeExclude, 2, +1, bb);
        const fp = findProtrusion(cells, probeExclude, 2, -1, bb);
        backProbe = bp.cells; backStopped = bp.stopped;
        frontProbe = fp.cells; frontStopped = fp.stopped;
    }
    report.backProbe = backProbe.size;
    report.frontProbe = frontProbe.size;

    const tail = new Set();
    // kelvollinen probe on pysähtynyt (ei kävellyt läpi koko rungon) ja on
    // korkeintaan 40 % mallin soluista — isompi on vartaloa, ei uloke
    const probeOk = (s, stopped) => stopped && s.size >= 20 && s.size < 0.4 * cells.size;
    // Sivusiivet löytyneet -> z-ulokkeet ovat häntää. Vain jos mallilla ei ole
    // yhtään x-siipeä (esim. storkki, jonka siivet ovat z-suuntaiset), molemmat
    // päiden ulokkeet ovat siivet. Lisäksi malli on lintumainen (leveys > 1.6 ×
    // korkeus) — muuten nelijalkaisen kuono+takamus näyttäisivät lennetyiltä
    // siiviltä (bear/lion/tiger/susi saivat tästä väärät siivet).
    const sweptWings = birdLike && xWings.size === 0 && probeOk(backProbe, backStopped) && probeOk(frontProbe, frontStopped);
    if (sweptWings) {
        wingClusters.push(backProbe, frontProbe);
    } else if (probeOk(backProbe, backStopped)) {
        for (const k of backProbe) tail.add(k);
    }
    // merge per side
    const wingBySide = { left: new Set(), right: new Set() };
    for (const cl of wingClusters) {
        const cb = bboxOf(cl);
        // swept wings (z-probes): side by z-end; x-wings: side by x
        const fromZ = cl === backProbe || cl === frontProbe;
        const side = fromZ
            ? (cl === backProbe ? 'left' : 'right')
            : ((cb.mnX + cb.mxX) / 2 < bodyCx ? 'left' : 'right');
        for (const k of cl) wingBySide[side].add(k);
    }
    const wings = [];
    const zSweptSide = { left: null, right: null };
    if (zSwept.left) zSweptSide.left = zSwept.left;
    if (zSwept.right) zSweptSide.right = zSwept.right;
    for (const side of ['left', 'right']) {
        const cl = wingBySide[side];
        if (cl.size < 8) continue;
        const cb = bboxOf(cl);
        // z-laskostetut siivet: litteä sivulaatta → isku x-akselin ympäri (pitch).
        // HUOM: cl on aina uusi yhdistetty Set — vertailu on sisältöpohjainen:
        // zSwept-klusteri on hallitseva osa koko sivun siivestä.
        const zs = zSweptSide[side];
        const folded = !!(zs && zs.size >= 30 && zs.size >= 0.7 * cl.size);
        const axis = folded ? 'z' : ((cb.mxX - cb.mnX) >= (cb.mxZ - cb.mnZ) ? 'z' : 'x');
        wings.push({ side, axis, cells: cl, folded: !!folded });
    }
    report.wings = wings.map(w => ({ side: w.side, axis: w.axis, cells: w.cells.size, bb: bboxOf(w.cells) }));
    report.tail = tail.size;

    // ---- body: everything remaining
    const wingCells = new Set();
    for (const w of wings) for (const k of w.cells) wingCells.add(k);
    const body = new Set();
    for (const k of cells) {
        if (!legCells.has(k) && !head.has(k) && !wingCells.has(k) && !tail.has(k)) body.add(k);
    }
    report.body = { cells: body.size, bb: bboxOf(body) };

    // ---- finalize leg names (side + front/back), splitting merged clusters
    // Leveät ja pitkät blobit (esim. lohikäärmeen kylki, jossa etu+ takajalka
    // sulautuvat) jaetaan etu/taka -osiin rungon z-keskipisteestä.
    const legList = [];
    const legParts = [];
    for (const cl of splitLegSides(legs, modelCx)) {
        const cb = bboxOf(cl);
        if (cb.mxX - cb.mnX >= 4 && cb.mxZ - cb.mnZ > 5) {
            const front = new Set(), back = new Set();
            for (const k of cl) {
                const [, , z] = parseKey(k);
                if (z >= bodyCz) front.add(k); else back.add(k);
            }
            if (front.size >= 5 && back.size >= 5) { legParts.push(front, back); continue; }
        }
        legParts.push(cl);
    }
    const nameCount = new Map();
    for (const cl of legParts) {
        const cb = bboxOf(cl);
        const side = (cb.mnX + cb.mxX) / 2 < modelCx ? 'left' : 'right';
        const front = (cb.mnZ + cb.mxZ) / 2 > bodyCz;
        let name = side + (front ? '_front' : '_back');
        const n = nameCount.get(name) || 0;
        nameCount.set(name, n + 1);
        if (n > 0) name += '_' + n;
        legList.push({ name, side, front, cells: cl });
    }

    return {
        flip,
        boxes: boxesSpace,
        parts: { body, head, legs: legList, wings, tail },
        bodyCx,
        bodyCz,
        modelCx,
        report
    };
}
