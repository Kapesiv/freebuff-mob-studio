/**
 * pack_icon.png -generaattori — piirtää mobista isometrisen kuvakkeen
 * 2D-canvakselle (ei vaadi WebGL:ää). Jokainen kuutio piirtyy kolmena
 * kasvona (ylä + kaksi sivua) ja kasvojen värit luetaan mobin tekstuurista
 * (UV-kartoitusten mukaisesti) — varjostus kuten Minecraftissa.
 */
import { computeFaceRects } from './boxuv.js';

const A = Math.cos(Math.PI / 6);  // 0.866 — isometrinen projektio
const B = Math.sin(Math.PI / 6);  // 0.5

function project(x, y, z) {
    return { x: (x - z) * A, y: (x + z) * B - y };
}

/** Kasvon keskimääräinen väri tekstuurin UV-alueelta (1×1 alasample). */
function faceColor(textureCanvas, faceRect, fallback) {
    if (!textureCanvas || !faceRect) return fallback;
    try {
        const tmp = document.createElement('canvas');
        tmp.width = 1;
        tmp.height = 1;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(
            textureCanvas,
            Math.floor(faceRect.x), Math.floor(faceRect.y),
            Math.max(1, Math.floor(faceRect.w)), Math.max(1, Math.floor(faceRect.h)),
            0, 0, 1, 1
        );
        const d = tctx.getImageData(0, 0, 1, 1).data;
        if (d[3] === 0) return fallback; // läpinäkyvä alue → kuution väri
        return `rgb(${d[0]},${d[1]},${d[2]})`;
    } catch {
        return fallback;
    }
}

/**
 * Piirtää mobin isometrisen kuvakkeen.
 * @returns 2D-canvas (kokoa `size`×`size`)
 */
export function renderPackIcon(model, textureCanvas, size = 256) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    // Tausta: tumma radiaali (näkyy sekä vaaleassa että tummassa listassa)
    const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
    g.addColorStop(0, '#2b313a');
    g.addColorStop(1, '#14171c');
    ctx.fillStyle = g;
    roundRect(ctx, size * 0.04, size * 0.04, size * 0.92, size * 0.92, size * 0.06);
    ctx.fill();

    // Kerää kaikki kuutiot + niiden projisoidut pisteet (syvyysjärjestys)
    const items = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let cubeIndex = 0;
    for (const bone of model.bones || []) {
        for (const cube of bone.cubes || []) {
            const o = cube.origin, s = cube.size;
            if (!o || !s) continue;
            const pts = [];
            for (let ix = 0; ix <= 1; ix++) {
                for (let iy = 0; iy <= 1; iy++) {
                    for (let iz = 0; iz <= 1; iz++) {
                        pts.push(project(o[0] + ix * s[0], o[1] + iy * s[1], o[2] + iz * s[2]));
                    }
                }
            }
            for (const p of pts) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            items.push({ cube, o, s, pts });
            cubeIndex++;
        }
    }
    if (!items.length) {
        // Tyhjä malli — pelkkä tausta
        return c;
    }

    // Skaalaa sopimaan (padding 12 %)
    const pad = size * 0.12;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);
    const cx = size / 2, cy = size * 0.52;
    const ox = cx - ((minX + maxX) / 2) * scale;
    const oy = cy - ((minY + maxY) / 2) * scale;

    // Painter-algoritmi: kaukaa lähelle (pienin x+y+z ensin)
    items.sort((a, b) => (a.o[0] + a.o[1] + a.o[2]) - (b.o[0] + b.o[1] + b.o[2]));

    const rects = new Map(); // cubeIndex -> computeFaceRects
    const toPx = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

    for (const item of items) {
        const { cube, o, s } = item;
        const fallback = cube.color || '#888888';
        // Kasvojen UV-suorakaiteet (vain kun tekstuuri on olemassa)
        let faces = null;
        if (textureCanvas) {
            faces = computeFaceRects(cube);
            if (!Array.isArray(faces)) faces = null;
        }
        const uvFor = (face) => {
            if (!faces) return null;
            const r = faces.find((f) => f.face === face);
            return r || null;
        };

        // Näkyvät kasvot isometriassa: ylä + +x + +z (kulmat maailmankoordinaateissa)
        const corners = [];
        for (let ix = 0; ix <= 1; ix++) {
            for (let iy = 0; iy <= 1; iy++) {
                for (let iz = 0; iz <= 1; iz++) {
                    corners.push({ x: o[0] + ix * s[0], y: o[1] + iy * s[1], z: o[2] + iz * s[2] });
                }
            }
        }
        const yMax = o[1] + s[1];
        const xMax = o[0] + s[0];
        const zMax = o[2] + s[2];
        const topCorners = corners.filter((q) => q.y === yMax);
        const xCorners = corners.filter((q) => q.x === xMax);
        const zCorners = corners.filter((q) => q.z === zMax);

        const drawFace = (pts3, color, shade) => {
            if (!pts3 || pts3.length < 3) return;
            const p2 = pts3.map((q) => toPx(project(q.x, q.y, q.z)));
            ctx.beginPath();
            ctx.moveTo(p2[0].x, p2[0].y);
            for (let i = 1; i < p2.length; i++) ctx.lineTo(p2[i].x, p2[i].y);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (shade < 1) {
                ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
                ctx.fill();
            }
        };

        drawFace(topCorners, faceColor(textureCanvas, uvFor('up'), fallback), 1);
        drawFace(xCorners, faceColor(textureCanvas, uvFor('east'), fallback), 0.82);
        drawFace(zCorners, faceColor(textureCanvas, uvFor('south'), fallback), 0.62);
    }

    return c;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
