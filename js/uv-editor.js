/**
 * 2D UV editor — shows the texture with every cube face outlined, lets you
 * select faces (which selects the cube in 3D), drag faces to reposition their
 * UVs, and paint directly on the texture.
 */
import { computeFaceRects } from './utils/boxuv.js';

export function initUVEditor(canvas, state, callbacks) {
    const ctx = canvas.getContext('2d');
    let tool = 'select';          // 'select' | 'paint' | 'fill' | 'resize'
    let paintColor = '#000000';
    let brushSize = 3;
    let scale = 4;
    let drag = null;
    let resizeDrag = null;        // { cubeIndex, face, edge, dim, anchorHigh, startSize, startUvSize, startOffset, startTex }
    let handles = [];             // resize-kahvat (piirretty valitun kuution kasvoille)
    let painting = false;
    let lastPoint = null;
    let hovered = null;           // { cube, face }

    // ---- sizing -------------------------------------------------------
    function resize() {
        const tw = state.model.textureWidth;
        const th = state.model.textureHeight;
        // Fit into the available panel width
        const avail = canvas.parentElement ? canvas.parentElement.clientWidth - 24 : 320;
        scale = Math.max(1, Math.floor(avail / tw));
        canvas.style.width = (tw * scale) + 'px';
        canvas.style.height = (th * scale) + 'px';
        canvas.width = tw * scale;
        canvas.height = th * scale;
        draw();
    }

    // ---- hit testing --------------------------------------------------
    function faceRectsForCube(cube) {
        return computeFaceRects(cube).map(r => ({
            ...r,
            x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale
        }));
    }

    function allFaceRects() {
        const result = [];
        let cubeIndex = 0;
        for (const bone of state.model.bones) {
            for (const cube of bone.cubes) {
                for (const r of faceRectsForCube(cube)) {
                    result.push({ ...r, cubeIndex });
                }
                cubeIndex++;
            }
        }
        return result;
    }

    function hitTest(px, py) {
        const rects = allFaceRects();
        for (let i = rects.length - 1; i >= 0; i--) {
            const r = rects[i];
            if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
                return r;
            }
        }
        return null;
    }

    /** Resize-kahvan osumatesti: lähin kahva säteen sisällä. Jaetussa
     *  reunassa (kaksi kahvaa samassa pisteessä) suositaan oikea-/alareunaa,
     *  jotta ulospäin vetäminen aina kasvattaa kokoa. */
    function hitHandle(px, py) {
        let best = null;
        let bestDist = 7;
        for (let i = 0; i < handles.length; i++) {
            const h = handles[i];
            const d = Math.hypot(px - h.x, py - h.y);
            if (d < bestDist - 1e-6) {
                bestDist = d;
                best = h;
            } else if (best && Math.abs(d - bestDist) <= 1e-6) {
                const prio = (h.edge === 'right' || h.edge === 'bottom') ? 0 : 1;
                const bestPrio = (best.edge === 'right' || best.edge === 'bottom') ? 0 : 1;
                if (prio < bestPrio) best = h;
            }
        }
        return best;
    }

    /** Mikä kuution mitta (0=leveys, 1=korkeus, 2=syvyys) ja kumpi reuna ankkuroi. */
    function resizeInfoFor(face, edge) {
        switch (face) {
            case 'north':
            case 'south': // w x h
                if (edge === 'left' || edge === 'right') return { dim: 0, anchorHigh: edge === 'left' };
                return { dim: 1, anchorHigh: edge === 'top' };
            case 'east':
            case 'west': // d x h
                if (edge === 'left' || edge === 'right') return { dim: 2, anchorHigh: edge === 'left' };
                return { dim: 1, anchorHigh: edge === 'top' };
            case 'up':
            case 'down': // w x d
                if (edge === 'left' || edge === 'right') return { dim: 0, anchorHigh: edge === 'left' };
                return { dim: 2, anchorHigh: edge === 'top' };
        }
        return { dim: 0, anchorHigh: false };
    }

    // ---- drawing ------------------------------------------------------
    // Each face of the SELECTED cube gets its own color so you can instantly
    // see which texture area maps to which face.
    const FACE_COLORS = {
        north: '#ff5252',   // red
        south: '#448aff',   // blue
        east:  '#69f0ae',   // green
        west:  '#ffd740',   // amber
        up:    '#40c4ff',   // cyan
        down:  '#e040fb'    // magenta
    };

    function hexToRgba(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    function drawFaceLabel(r, color) {
        if (r.w < 3 * scale || r.h < 3 * scale) return; // liian pieni lappua varten
        ctx.font = '10px ui-monospace, monospace';
        const label = r.face;
        const tw = ctx.measureText(label).width;
        const lx = r.x + 2, ly = r.y + 2;
        ctx.fillStyle = 'rgba(10,14,20,0.75)';
        ctx.fillRect(lx - 1, ly - 1, tw + 4, 13);
        ctx.fillStyle = color;
        ctx.fillText(label, lx + 1, ly + 10);
    }

    // HTML-selite canvaksen alla (ei peitä tekstuuria)
    const legendEl = typeof document !== 'undefined' ? document.getElementById('uv-legend') : null;
    function drawLegend(show) {
        if (legendEl) legendEl.hidden = !show;
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // texture
        if (state.textureCanvas) {
            ctx.drawImage(state.textureCanvas, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#1b2230';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // pixel grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= canvas.width; x += scale) {
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, canvas.height);
        }
        for (let y = 0; y <= canvas.height; y += scale) {
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(canvas.width, y + 0.5);
        }
        ctx.stroke();

        // face outlines — selected cube's faces each get their own color + label
        const rects = allFaceRects();
        const cubeSelected = state.selectedCube !== null;
        for (const r of rects) {
            const isCube = (state.selectedCube === r.cubeIndex);
            const isFace = isCube && (state.selectedFace === r.face);
            if (isCube) {
                const color = FACE_COLORS[r.face] || '#58a6ff';
                ctx.strokeStyle = color;
                ctx.lineWidth = isFace ? 3 : 2;
                ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
                ctx.fillStyle = hexToRgba(color, isFace ? 0.28 : 0.14);
                ctx.fillRect(r.x, r.y, r.w, r.h);
                if (isFace) {
                    // valittu kasvo saa katkoviivan sisään
                    ctx.setLineDash([4, 3]);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 2, r.h - 2);
                    ctx.setLineDash([]);
                }
                drawFaceLabel(r, color);
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                ctx.lineWidth = 1;
                ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
            }
        }

        // resize-kahvat: valitun kuution jokaisen kasvon reunan keskellä
        handles = [];
        if (tool === 'resize' && cubeSelected) {
            for (const r of rects) {
                if (r.cubeIndex !== state.selectedCube) continue;
                const cube = cubeForIndex(r.cubeIndex);
                if (!cube || (cube.uv && cube.uv.perFace)) continue; // per-face-UV:t eivät seuraa kokoa
                const pts = [
                    { edge: 'left',   x: r.x,           y: r.y + r.h / 2 },
                    { edge: 'right',  x: r.x + r.w,     y: r.y + r.h / 2 },
                    { edge: 'top',    x: r.x + r.w / 2, y: r.y },
                    { edge: 'bottom', x: r.x + r.w / 2, y: r.y + r.h }
                ];
                for (const p of pts) {
                    ctx.fillStyle = '#f0883e';
                    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
                    ctx.strokeStyle = '#0d1117';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
                    handles.push({ ...p, cubeIndex: r.cubeIndex, face: r.face });
                }
            }
        }

        // hover highlight
        if (hovered) {
            ctx.strokeStyle = '#f0883e';
            ctx.lineWidth = 2;
            ctx.strokeRect(hovered.x + 0.5, hovered.y + 0.5, hovered.w, hovered.h);
        }

        drawLegend(cubeSelected);
    }

    // ---- texture painting --------------------------------------------
    function paintAt(px, py) {
        if (!state.textureCanvas) return;
        const tctx = state.textureCanvas.getContext('2d');
        const tx = px / scale;
        const ty = py / scale;
        tctx.fillStyle = paintColor;
        tctx.beginPath();
        tctx.arc(tx, ty, brushSize, 0, Math.PI * 2);
        tctx.fill();
        state.texture.needsUpdate = true;
        draw();
        if (callbacks.onPaint) callbacks.onPaint();
    }

    function paintLine(x1, y1, x2, y2) {
        if (!state.textureCanvas) return;
        const tctx = state.textureCanvas.getContext('2d');
        tctx.strokeStyle = paintColor;
        tctx.lineWidth = brushSize * 2;
        tctx.lineCap = 'round';
        tctx.lineJoin = 'round';
        tctx.beginPath();
        tctx.moveTo(x1 / scale, y1 / scale);
        tctx.lineTo(x2 / scale, y2 / scale);
        tctx.stroke();
        state.texture.needsUpdate = true;
        draw();
        if (callbacks.onPaint) callbacks.onPaint();
    }

    // ---- mouse --------------------------------------------------------
    function toLocal(e) {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
    }

    canvas.addEventListener('mousedown', (e) => {
        const [px, py] = toLocal(e);
        if (tool === 'paint') {
            if (callbacks.onPaintStart) callbacks.onPaintStart();
            painting = true;
            lastPoint = [px, py];
            paintAt(px, py);
            e.preventDefault();
            return;
        }
        if (tool === 'fill') {
            // Fill the clicked face's UV region with the current color
            if (callbacks.onPaintStart) callbacks.onPaintStart();
            const hit = hitTest(px, py);
            if (hit && state.textureCanvas) {
                const tctx = state.textureCanvas.getContext('2d');
                tctx.fillStyle = paintColor;
                tctx.fillRect(
                    Math.round(hit.x / scale),
                    Math.round(hit.y / scale),
                    Math.round(hit.w / scale),
                    Math.round(hit.h / scale)
                );
                state.texture.needsUpdate = true;
                draw();
                if (callbacks.onPaint) callbacks.onPaint();
                if (callbacks.onSelectFace) callbacks.onSelectFace(hit.cubeIndex, hit.face);
            }
            e.preventDefault();
            return;
        }
        // resize-työkalu: kahvasta kiinni → koon muokkaus
        if (tool === 'resize') {
            const h = hitHandle(px, py);
            if (h) {
                const cube = cubeForIndex(h.cubeIndex);
                if (cube) {
                    cube.uv = cube.uv || {};
                    if (!Array.isArray(cube.uv.offset)) {
                        const rs = computeFaceRects(cube);
                        cube.uv.offset = [Math.min(...rs.map(r => r.x)), Math.min(...rs.map(r => r.y))];
                    }
                    const info = resizeInfoFor(h.face, h.edge);
                    resizeDrag = {
                        cubeIndex: h.cubeIndex,
                        face: h.face,
                        edge: h.edge,
                        dim: info.dim,
                        anchorHigh: info.anchorHigh,
                        startSize: cube.size.slice(),
                        startUvSize: cube.uvSize ? cube.uvSize.slice() : null,
                        startOffset: cube.uv.offset.slice(),
                        startTex: [px / scale, py / scale]
                    };
                }
                e.preventDefault();
                return;
            }
        }
        // select / drag
        const hit = hitTest(px, py);
        if (hit) {
            drag = {
                rect: hit,
                startX: px,
                startY: py,
                origOffset: getFaceOffset(hit.cubeIndex, hit.face)
            };
            if (callbacks.onSelectFace) callbacks.onSelectFace(hit.cubeIndex, hit.face);
        } else if (callbacks.onSelectFace) {
            callbacks.onSelectFace(null, null);
        }
        e.preventDefault();
    });

    canvas.addEventListener('mousemove', (e) => {
        const [px, py] = toLocal(e);
        if (painting && tool === 'paint') {
            if (lastPoint) paintLine(lastPoint[0], lastPoint[1], px, py);
            lastPoint = [px, py];
            return;
        }
        if (resizeDrag) {
            const tx = px / scale;
            const ty = py / scale;
            const axis = (resizeDrag.edge === 'left' || resizeDrag.edge === 'right') ? 0 : 1;
            const delta = axis === 0 ? tx - resizeDrag.startTex[0] : ty - resizeDrag.startTex[1];
            // oikea/alareuna: kasvu = +delta; vasen/yläreuna: kasvu = -delta
            let growth = (resizeDrag.edge === 'right' || resizeDrag.edge === 'bottom') ? delta : -delta;
            growth = Math.round(growth * 100) / 100;
            const cube = cubeForIndex(resizeDrag.cubeIndex);
            if (cube) {
                const dim = resizeDrag.dim;
                const newVal = Math.max(0.25, resizeDrag.startSize[dim] + growth);
                const applied = newVal - resizeDrag.startSize[dim];
                cube.size[dim] = Math.round(newVal * 100) / 100;
                if (cube.uvSize) cube.uvSize[dim] = Math.round((resizeDrag.startUvSize[dim] + growth) * 100) / 100;
                cube.uv = cube.uv || {};
                if (!Array.isArray(cube.uv.offset)) cube.uv.offset = [0, 0];
                // ankkuroi vastakkainen reuna: siirrä UV-origoa kasvun verran
                if (resizeDrag.anchorHigh) {
                    if (dim === 1) cube.uv.offset[1] = resizeDrag.startOffset[1] - applied;
                    else cube.uv.offset[0] = resizeDrag.startOffset[0] - applied;
                }
                draw();
                if (callbacks.onResize) callbacks.onResize(resizeDrag.cubeIndex);
            }
            return;
        }
        if (drag) {
            const dx = Math.round((px - drag.startX) / scale);
            const dy = Math.round((py - drag.startY) / scale);
            setFaceOffset(drag.rect.cubeIndex, drag.rect.face, [
                drag.origOffset[0] + dx,
                drag.origOffset[1] + dy
            ]);
            if (callbacks.onUVChange) callbacks.onUVChange();
            return;
        }
        if (tool === 'resize') {
            // kursorin palaute kahvojen päällä
            const h = hitHandle(px, py);
            if (h) {
                canvas.style.cursor = (h.edge === 'left' || h.edge === 'right') ? 'ew-resize' : 'ns-resize';
            } else {
                canvas.style.cursor = 'default';
            }
        }
        if (tool === 'select') {
            const hit = hitTest(px, py);
            hovered = hit;
            draw();
        }
    });

    canvas.addEventListener('mouseup', () => {
        painting = false;
        lastPoint = null;
        drag = null;
        resizeDrag = null;
    });

    canvas.addEventListener('mouseleave', () => {
        painting = false;
        lastPoint = null;
        drag = null;
        resizeDrag = null;
        hovered = null;
        draw();
    });

    function getFaceOffset(cubeIndex, face) {
        const cube = cubeForIndex(cubeIndex);
        if (!cube) return [0, 0];
        cube.uv = cube.uv || {};
        cube.uv.faces = cube.uv.faces || {};
        return cube.uv.faces[face] || [0, 0];
    }

    function setFaceOffset(cubeIndex, face, off) {
        const cube = cubeForIndex(cubeIndex);
        if (!cube) return;
        cube.uv = cube.uv || {};
        cube.uv.faces = cube.uv.faces || {};
        cube.uv.faces[face] = off;
        draw();
    }

    function cubeForIndex(index) {
        let i = 0;
        for (const bone of state.model.bones) {
            for (const cube of bone.cubes) {
                if (i === index) return cube;
                i++;
            }
        }
        return null;
    }

    // ---- public API ---------------------------------------------------
    return {
        resize,
        draw,
        setTool(t) {
            tool = t;
            canvas.style.cursor = (t === 'paint') ? 'crosshair' : (t === 'resize') ? 'pointer' : 'default';
            draw();
        },
        setPaintColor(c) { paintColor = c; },
        setBrushSize(s) { brushSize = s; },
        getPaintColor: () => paintColor,
        getBrushSize: () => brushSize,
        getTool: () => tool
    };
}
