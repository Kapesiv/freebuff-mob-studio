/**
 * Automaattinen animaatiogeneraattori — Spore-tyylinen "rakenna kroppa,
 * niin se elää". Analysoi minkä tahansa luurangon (jalat, kädet, siivet,
 * häntä, pää, vartalo) ja generoi idle/walk/attack (ja fly/swim jos
 * rakenne sen sallii) — sama askellogiikka kuin vokseligeneraattorissa:
 * jalka maassa 60 % kierrosta, jalkaterän nosto kompensoi kallistusta.
 */

// ---- luurankoanalyysi -------------------------------------------------

function boneInfo(bone) {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const c of bone.cubes || []) {
        for (let i = 0; i < 3; i++) {
            mn[i] = Math.min(mn[i], c.origin[i]);
            mx[i] = Math.max(mx[i], c.origin[i] + c.size[i]);
        }
    }
    if (!isFinite(mn[0])) return null;
    return {
        mn, mx,
        center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
        dims: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
        volume: (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]),
    };
}

/** Luuketjun jälkeläiset (lapset, lastenlapset…) vanhempaviittauksista. */
function chainChildren(model, bone) {
    const out = [];
    const byParent = new Map();
    for (const b of model.bones || []) {
        if (!b.parent) continue;
        if (!byParent.has(b.parent)) byParent.set(b.parent, []);
        byParent.get(b.parent).push(b);
    }
    let frontier = byParent.get(bone.name) || [];
    while (frontier.length) {
        out.push(...frontier);
        const next = [];
        for (const f of frontier) next.push(...(byParent.get(f.name) || []));
        frontier = next;
    }
    return out;
}

/** Onko bone jonkin toisen luun jälkeläinen (vanhempiketjussa)? */
function isDescendant(model, bone, ancestor) {
    let p = bone.parent;
    let guard = 0;
    while (p && guard++ < 64) {
        if (p === ancestor.name) return true;
        const pb = (model.bones || []).find((x) => x.name === p);
        p = pb ? pb.parent : null;
    }
    return false;
}

export function analyzeSkeleton(model) {
    const bones = (model.bones || []).filter((b) => b.cubes && b.cubes.length);
    const info = {};
    const all = [];
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of bones) {
        const i = boneInfo(b);
        if (!i) continue;
        info[b.name] = i;
        all.push(b);
        for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], i.mn[k]);
            mx[k] = Math.max(mx[k], i.mx[k]);
        }
    }
    const H = Math.max(1, mx[1] - mn[1]);
    const W = Math.max(1, mx[0] - mn[0]);
    const D = Math.max(1, mx[2] - mn[2]);

    const res = { body: null, head: null, legs: [], arms: [], wings: [], tail: null };
    const has = (b, ...kws) => kws.some((k) => b.name.toLowerCase().includes(k));
    const used = new Set(); // nimellä luokiteltu luu — ei pudota muihin luokkiin

    // 1) Nimipohjainen luokittelu (vanilja/templaatti-luunimet)
    for (const b of all) {
        if (has(b, 'tail', 'tentacle', 'fin', 'stinger')) {
            used.add(b);
            if (!res.tail) res.tail = b;
        } else if (has(b, 'wing')) {
            used.add(b);
            res.wings.push(b);
        } else if (has(b, 'leg', 'foot', 'thigh', 'hoof')) {
            used.add(b);
            res.legs.push(b);
        } else if (has(b, 'arm', 'hand', 'claw', 'shoulder', 'forelimb')) {
            used.add(b);
            res.arms.push(b);
        } else if (has(b, 'head', 'skull', 'jaw', 'beak', 'antenna')) {
            used.add(b);
            if (!res.head) res.head = b;
        } else if (has(b, 'body', 'chest', 'torso', 'abdomen', 'belly', 'hips', 'waist', 'main', 'neck', 'torso')) {
            used.add(b);
            if (!res.body) res.body = b;
        }
    }

    // 2) Geometriapohjainen täydennys luokittelemattomille luille.
    // Ketjulapset (luu jolla on vanhempi mallissa) jätetään pois — ne taipuvat
    // vanhempansa mukana eivätkä saa itsenäistä roolia (muuten jalan kärki
    // laskettaisiin omaksi jalakseen ja sarvet luokiteltaisiin siiviksi).
    const allNames = new Set(all.map((b) => b.name));
    for (const b of all) {
        if (used.has(b)) continue;
        if (b.parent && allNames.has(b.parent)) continue;
        const i = info[b.name];
        const nearGround = i.mn[1] <= mn[1] + H * 0.22;
        const tallNarrow = i.dims[1] >= i.dims[0] * 1.15 && i.dims[1] >= i.dims[2] * 1.15 && i.dims[1] >= H * 0.2;
        const wide = Math.max(i.dims[0], i.dims[2]) >= W * 0.3;
        const side = Math.abs(i.center[0]) >= W * 0.18;
        const top = i.center[1] >= mn[1] + H * 0.72;
        const bottom = i.center[1] <= mn[1] + H * 0.4;
        if (nearGround && tallNarrow && bottom) {
            res.legs.push(b);
        } else if (wide && side && !nearGround) {
            res.wings.push(b);
        } else if (top && !side && !res.head) {
            res.head = b;
        } else if (!res.body) {
            // Älä varasta nimettyä vartaloa — vain jos ei vielä löytynyt
            res.body = b;
        }
    }

    // Varmista vartalo (suurin luu) jos ei löytynyt
    if (!res.body && all.length) {
        res.body = all.reduce((a, b) => (info[b.name].volume > info[a.name].volume ? b : a));
    }

    // Ketjulapset pois itsenäisistä luokista: jalan kärki (foot) taipuu jalan
    // mukana, ei ole oma jalka. Pidetään vain ketjun ylin luu per luokka.
    const keepTops = (arr) => arr.filter((b) => !arr.some((o) => o !== b && isDescendant(model, b, o)));
    res.legs = keepTops(res.legs);
    res.arms = keepTops(res.arms);
    res.wings = keepTops(res.wings);

    // Jalkaparit: A/B-vaiheet (diagonaalinen askellus 4+ jalalla)
    const legA = [], legB = [];
    const xsorted = [...res.legs].sort((a, b) => info[a.name].center[0] - info[b.name].center[0]);
    if (xsorted.length === 2) {
        legA.push(xsorted[0].name);
        legB.push(xsorted[1].name);
    } else if (xsorted.length >= 3) {
        // pari vasen[i] ↔ oikea[i]; vuorotellen A/B → diagonaalikäynti
        const left = xsorted.filter((l) => info[l.name].center[0] <= 0);
        const right = xsorted.filter((l) => info[l.name].center[0] > 0);
        const pairs = [];
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
            pairs.push([left[i], right[i]].filter(Boolean));
        }
        pairs.forEach((p, i) => {
            if (i % 2 === 0) legA.push(...p.map((b) => b.name));
            else legB.push(...p.map((b) => b.name));
        });
        if (!legA.length && !legB.length) legA.push(...xsorted.map((b) => b.name));
    }

    return { info, modelBounds: { mn, mx, H, W, D }, body: res.body, head: res.head, legs: res.legs, arms: res.arms, wings: res.wings, tail: res.tail, legA, legB };
}

// ---- animaatiogenerointi ----------------------------------------------

/** Jalan geometria kompensaatiota varten: L = lonkasta jalkaterään, zExt = syvyys. */
function legGeo(bone, info) {
    const pivot = bone.pivot || [0, 0, 0];
    let footMin = Infinity, zMax = 0;
    for (const c of bone.cubes || []) {
        footMin = Math.min(footMin, c.origin[1]);
        zMax = Math.max(zMax, Math.abs(c.origin[2] + c.size[2] / 2 - pivot[2]) + c.size[2] / 2);
    }
    if (!isFinite(footMin)) footMin = pivot[1] - 4;
    return { L: Math.max(1, pivot[1] - footMin), zExt: Math.max(0.5, zMax) };
}

const SWING = 18; // asteet — isompi uppottaa jalkaterät lattiaan
const WALK_FRAMES = [0, 12, 24, 27, 32, 36]; // 40 ≡ 0 (silmukka)
const angAt = (f) => (f === 0 ? SWING : f === 12 ? 0 : f === 24 ? -SWING : f === 27 ? -SWING * 0.55 : f === 32 ? -SWING * 0.1 : SWING * 0.7);
const liftAt = (f) => (f === 24 ? 0 : f === 27 ? 0.55 : f === 32 ? 1 : f === 36 ? 0.55 : 0);

function buildWalkTrack(legNames, phases, geo, scaleF) {
    const tracks = {}, posTracks = {};
    for (const n of legNames) {
        const phase = phases[n] || 0;
        tracks[n] = {};
        posTracks[n] = {};
        for (const f of WALK_FRAMES) {
            const kf = (f + phase) % 40;
            const ang = angAt(f);
            const g = geo[n];
            const r = (ang * Math.PI) / 180;
            const dip = g ? Math.max(0, g.zExt * Math.abs(Math.sin(r)) - g.L * (1 - Math.cos(r))) : 0;
            const peak = g ? Math.min(2.2, Math.max(0.5, g.L * 0.2)) : 1;
            tracks[n][kf] = [ang, 0, 0];
            posTracks[n][kf] = [0, dip + liftAt(f) * peak, 0];
        }
    }
    return { tracks, posTracks };
}

/**
 * Häntäketjun taivutusaalto: jokainen segmentti heiluu vanhempaansa nähden
 * viiveellä ja kasvavalla amplitudilla — aalto kulkee pitkin häntää.
 * Perusmuoto on sama -cos-aalto kuin juuren trackilla, joten liike on
 * yhtenäinen eikä luut irtoa toisistaan (lapset perivät vanhempansa).
 */
function addChainSway(anim, chain, amp, length, frames) {
    if (!chain || chain.length < 2) return;
    chain.slice(1).forEach((seg, i) => {
        const d = i + 1;
        const a = amp * (1 + d * 0.85);
        const lag = Math.round((length / 8) * d);
        const tr = {};
        for (const f of frames) {
            const t = ((f - lag) % length + length) % length;
            tr[f] = [0, -Math.cos((t / length) * Math.PI * 2) * a, 0];
        }
        anim.tracks[seg.name] = tr;
    });
}

export function generateAutoAnimations(model) {
    const a = analyzeSkeleton(model);
    const { info } = a;
    const scaleF = Math.max(0.4, Math.min(1.4, a.modelBounds.H / 24));
    const animations = {};

    const geo = {};
    for (const leg of a.legs) geo[leg.name] = legGeo(leg, info);

    // Häntäketju (tyvi + segmentit) — aalto taivuttaa segmentit peräkkäin
    const tailChain = a.tail ? [a.tail, ...chainChildren(model, a.tail)] : null;

    // ---- idle: hengitys + pään katselu + hännän heilunta (60 fr = 3 s)
    const idle = { length: 60, tracks: {}, posTracks: {} };
    if (a.body) idle.tracks[a.body.name] = { 0: [1.0, 0, 0], 30: [-1.0, 0, 0], 60: [1.0, 0, 0] };
    if (a.head) idle.tracks[a.head.name] = { 0: [0, 0, 0], 15: [3, 6, 0], 30: [0, 0, 0], 45: [-3, -6, 0], 60: [0, 0, 0] };
    if (a.tail) idle.tracks[a.tail.name] = { 0: [0, -4, 0], 30: [0, 4, 0], 60: [0, -4, 0] };
    addChainSway(idle, tailChain, 4, 60, [0, 15, 30, 45, 60]);
    animations.idle = idle;

    // ---- walk: aito askellus (40 fr = 2 s). Hämähäkkimäisillä (6+ jalkaa)
    // käytetään sen sijaan crawl-hiipimistä — tavallinen kävely näyttää
    // väärältä monijalkaisella.
    if (a.legs.length && a.legs.length < 6) {
        const walk = { length: 40, tracks: {}, posTracks: {} };
        const phases = {};
        for (const n of a.legA) phases[n] = 0;
        for (const n of a.legB) phases[n] = 20;
        const { tracks, posTracks } = buildWalkTrack(a.legs.map((l) => l.name), phases, geo, scaleF);
        Object.assign(walk.tracks, tracks);
        Object.assign(walk.posTracks, posTracks);
        // vartalo kohoaa tuessa, pää vastanyökkää; häntä heiluu
        const bob = 0.9 * scaleF;
        if (a.body) {
            walk.tracks[a.body.name] = { 0: [0, 0, 0], 12: [-1.4, 0, 0], 20: [0, 0, 0], 32: [-1.4, 0, 0], 40: [0, 0, 0] };
            walk.posTracks[a.body.name] = { 0: [0, 0, 0], 12: [0, bob, 0], 20: [0, 0, 0], 32: [0, bob, 0], 40: [0, 0, 0] };
        }
        if (a.head) walk.tracks[a.head.name] = { 0: [0, 0, 0], 12: [1.6, 0, 0], 20: [0, 0, 0], 32: [1.6, 0, 0], 40: [0, 0, 0] };
        if (a.tail) walk.tracks[a.tail.name] = { 0: [0, -6, 0], 20: [0, 6, 0], 40: [0, -6, 0] };
        addChainSway(walk, tailChain, 5, 40, [0, 10, 20, 30, 40]);
        // Nivelöidyt jalat: kärki/jalkaterä koukistuu kävelyssä (polvi taipuu
        // kun jalka heilahtaa) — vastakkainen suunta juuren kulmaan nähden.
        for (const leg of a.legs) {
            const kids = chainChildren(model, leg);
            if (!kids.length) continue;
            const phase = phases[leg.name] || 0;
            for (const kid of kids) {
                walk.tracks[kid.name] = {};
                for (const f of WALK_FRAMES) {
                    walk.tracks[kid.name][(f + phase) % 40] = [angAt(f) * -0.5, 0, 0];
                }
            }
        }
        // kaksijalkaisilla kädet heiluvat vastakkaiseen tahtiin kuin jalat
        if (a.arms.length && a.legs.length <= 2) {
            a.arms.forEach((arm, i) => {
                const legPhase = a.legA.includes(a.legs[0].name) ? 0 : 20;
                const phase = (legPhase + (i % 2 === 0 ? 20 : 0)) % 40;
                walk.tracks[arm.name] = {};
                for (const f of WALK_FRAMES) {
                    walk.tracks[arm.name][(f + phase) % 40] = [-angAt(f) * 0.8, 0, 0];
                }
            });
        }
        animations.walk = walk;
    }

    // ---- attack: aseistettu isku (kädet) tai puskeminen (pää)
    {
        const attack = { length: 24, tracks: {}, posTracks: {} };
        const body = a.body;
        const head = a.head;
        if (a.arms.length) {
            const main = a.arms[0], other = a.arms[1] || null;
            attack.tracks[main.name] = { 0: [0, 0, 0], 6: [-55, 0, 0], 10: [55, 0, 0], 14: [0, 0, 0] };
            if (other) attack.tracks[other.name] = { 0: [0, 0, 0], 6: [30, 0, 0], 10: [-20, 0, 0], 14: [0, 0, 0] };
            if (body) {
                attack.tracks[body.name] = { 0: [0, 0, 0], 10: [14, 0, 0], 14: [0, 0, 0] };
                attack.posTracks[body.name] = { 0: [0, 0, 0], 10: [0, 0, -1], 14: [0, 0, 0] };
            }
            if (head) attack.tracks[head.name] = { 0: [0, 0, 0], 10: [8, 0, 0], 14: [0, 0, 0] };
        } else if (head) {
            // puskeminen/purenta
            attack.tracks[head.name] = { 0: [0, 0, 0], 8: [-28, 0, 0], 12: [14, 0, 0], 16: [0, 0, 0] };
            if (body) {
                attack.tracks[body.name] = { 0: [0, 0, 0], 10: [12, 0, 0], 14: [0, 0, 0] };
                attack.posTracks[body.name] = { 0: [0, 0, 0], 10: [0, 0, -1], 14: [0, 0, 0] };
            }
        } else if (body) {
            attack.tracks[body.name] = { 0: [0, 0, 0], 10: [20, 0, 0], 14: [0, 0, 0] };
        }
        animations.attack = attack;
    }

    // ---- fly: siipien räpyttely (40 fr = 2 s)
    if (a.wings.length >= 2) {
        const fly = { length: 40, tracks: {}, posTracks: {} };
        const xsortedW = [...a.wings].sort((x, y) => info[x.name].center[0] - info[y.name].center[0]);
        xsortedW.forEach((w, i) => {
            const s = i % 2 === 0 ? -1 : 1; // vastakkaiset suunnat
            const di = info[w.name].dims;
            const axisX = di[0] >= di[2];
            if (axisX) {
                fly.tracks[w.name] = { 0: [0, 0, s * 24], 10: [0, 0, 0], 20: [0, 0, -s * 24], 30: [0, 0, 0], 40: [0, 0, s * 24] };
            } else {
                fly.tracks[w.name] = { 0: [-22, 0, 0], 10: [0, 0, 0], 20: [22, 0, 0], 30: [0, 0, 0], 40: [-22, 0, 0] };
            }
        });
        if (a.body) {
            fly.tracks[a.body.name] = { 0: [3, 0, 0], 20: [-3, 0, 0], 40: [3, 0, 0] };
            fly.posTracks[a.body.name] = { 0: [0, 0.6, 0], 10: [0, 0, 0], 20: [0, 0.6, 0], 30: [0, 0, 0], 40: [0, 0.6, 0] };
        }
        if (a.head) fly.tracks[a.head.name] = { 0: [0, 0, 0], 20: [6, 0, 0], 40: [0, 0, 0] };
        if (a.tail) fly.tracks[a.tail.name] = { 0: [0, 0, 0], 20: [0, 8, 0], 40: [0, 0, 0] };
        addChainSway(fly, tailChain, 6, 40, [0, 10, 20, 30, 40]);
        animations.fly = fly;
    }

    // ---- swim: kalan S-kiemura (jos ei jalkoja eikä siipiä)
    if (!a.legs.length && !a.wings.length && (a.body || a.tail)) {
        const swim = { length: 40, tracks: {}, posTracks: {} };
        if (a.body) swim.tracks[a.body.name] = { 0: [0, -8, 0], 20: [0, 8, 0], 40: [0, -8, 0] };
        if (a.tail) swim.tracks[a.tail.name] = { 0: [0, -25, 0], 20: [0, 25, 0], 40: [0, -25, 0] };
        addChainSway(swim, tailChain, 14, 40, [0, 10, 20, 30, 40]);
        if (a.head) swim.tracks[a.head.name] = { 0: [0, 0, 0], 20: [0, 6, 0], 40: [0, 0, 0] };
        animations.swim = swim;
    }

    // ---- crawl: hämähäkkimäinen hiipiminen (monta jalkaa, matala aaltoilu).
    // Jalat liikkuvat peräkkäin vasemmalta oikealle aaltomaisesti ja keho
    // keinuu hitaasti — näyttää hiipivältä hämähäkiltä, ei tavalliselta kävelyltä.
    if (a.legs.length >= 6) {
        const crawl = { length: 80, tracks: {}, posTracks: {} };
        const xsorted = [...a.legs].sort((x, y) => info[x.name].center[0] - info[y.name].center[0]);
        xsorted.forEach((leg, i) => {
            const phase = Math.round((i / Math.max(1, xsorted.length)) * 80);
            crawl.tracks[leg.name] = {};
            crawl.posTracks[leg.name] = {};
            for (let f = 0; f <= 80; f += 10) {
                const kf = (f + phase) % 80;
                const k = Math.sin((f / 80) * Math.PI * 2);
                crawl.tracks[leg.name][kf] = [k * 8, 0, 0];
                crawl.posTracks[leg.name][kf] = [0, Math.max(0, -k) * 0.8, 0];
            }
            // Nivelöity jalka: sääri ojentuu hiipimisessä (kevyt vastaliike)
            const kids = chainChildren(model, leg);
            for (const kid of kids) {
                crawl.tracks[kid.name] = {};
                for (let f = 0; f <= 80; f += 10) {
                    const kf = (f + phase) % 80;
                    const k = Math.sin((f / 80) * Math.PI * 2);
                    crawl.tracks[kid.name][kf] = [k * 5, 0, 0];
                }
            }
        });
        if (a.body) {
            crawl.tracks[a.body.name] = { 0: [0, 0, 0], 40: [2.5, 0, 0], 80: [0, 0, 0] };
            crawl.posTracks[a.body.name] = { 0: [0, 0, 0], 40: [0, 0.4, 0], 80: [0, 0, 0] };
        }
        if (a.head) crawl.tracks[a.head.name] = { 0: [0, 0, 0], 40: [-4, 0, 0], 80: [0, 0, 0] };
        if (a.tail) crawl.tracks[a.tail.name] = { 0: [0, -6, 0], 40: [0, 6, 0], 80: [0, -6, 0] };
        addChainSway(crawl, tailChain, 6, 80, [0, 10, 20, 30, 40, 50, 60, 70, 80]);
        animations.crawl = crawl;
    }

    return { animations, analysis: a };
}
