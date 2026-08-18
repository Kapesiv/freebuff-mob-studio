import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { parseBedrockGeometry, exportBedrockGeometry, createEmptyModel } from './formats/bedrock.js';
import { exportJavaModel } from './formats/java.js';
import { exportBedrockAnimations, exportJavaAnimations } from './formats/animation.js';
import { createExampleMob } from './formats/example.js';
import { History } from './utils/history.js';
import { applyBoxTextureUVs, computeFaceRects } from './utils/boxuv.js';
import { initUVEditor } from './uv-editor.js';
import { initAnimation } from './animation.js';
import { LIBRARY_MOBS } from './mobs/library.js';
import { MOB_TEMPLATES } from './mobs/templates.js';
import { parseBBModel } from './formats/bbmodel.js';

// v5: hylkää vanhat autosavet (v4:stä puuttuu emissiivinen glow-tekstuuri,
// joten modimobien hehku ei säilyisi) — oletuksena ladataan oikea
// Deep Void -mobi (Stalker) kirjastosta.
const AUTOSAVE_KEY = 'freebuff_mobstudio_project_v5';

// ==================== STATE ====================
const state = {
    model: createEmptyModel(),
    projectName: 'My Mob',
    selectedBone: null,
    selectedCube: null,
    selectedFace: null,
    tool: 'select',
    bones: [],       // THREE.Group per bone
    cubes: [],       // THREE.Mesh per cube
    texture: null,       // THREE.Texture (nullable)
    textureCanvas: null, // 2D canvas — source of truth for painting
    textureDataURL: null,
    emissiveDataURL: null,    // mobin emissiivinen glow-tekstuuri (dataURL)
    emissiveTexture: null,    // THREE.Texture emissiveMap-kerrokselle
    history: new History(),
    animation: null,
    uvEditor: null,
    selectedFace: null,
    projectAnimations: {},     // name -> { length, tracks, posTracks } (editoitavat)
    currentAnimName: null,
    mirrorPaint: false,        // maalaa myös peilikuva vastakkaiselle puolelle
    modelVersion: 0
};

// Load autosaved project or fall back to the example mob
const saved = (() => {
    try {
        return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    } catch { return null; }
})();
if (saved && saved.model) {
    state.model = saved.model;
    state.projectName = saved.projectName || state.model.modelId.replace('geometry.', '') || 'My Mob';
    state.textureDataURL = saved.textureDataURL || null;
    state.savedEmissiveDataURL = saved.emissiveDataURL || null;
    state.savedAnimation = saved.animation || null;
    state.savedProjectAnimations = saved.projectAnimations || null;
    state.savedCurrentAnimName = saved.currentAnimName || null;
} else {
    // Oletus: Deep Voidin ikoninen Stalker (sama hahmo kuin modin
    // kuvituksessa: pitkä tumma luurankohumanoidi, valkoiset hehkuvat
    // silmät, levitetyt raajat). Oikea malli + tekstuuri modin JARista.
    const defaultMob = LIBRARY_MOBS.find(m => m.id === 'stalker');
    if (defaultMob) {
        state.model = JSON.parse(JSON.stringify(defaultMob.model));
        state.projectName = defaultMob.name;
        state.textureDataURL = defaultMob.textureDataURL || null;
        state.emissiveDataURL = defaultMob.emissiveDataURL || null;
    } else {
        state.model = createExampleMob();
        state.projectName = 'Example Mob';
    }
}

// ==================== THREE.JS SETUP ====================
// WebGL is optional: if unavailable, the app runs without the 3D viewport
// (hierarchy, UV editor, animation and export all still work).
const canvas = document.getElementById('three-canvas');
let renderer = null;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Clamp pixel ratio: some environments report absurd values (e.g. 128),
    // which creates a huge drawing buffer and breaks the viewport.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    // Medium slate: dark enough to feel like an editor, light enough that
    // black-textured mobs (Weaver of Souls is ~86% black) stay visible.
    renderer.setClearColor(0x343a46);
    renderer.shadowMap.enabled = true;
} catch (e) {
    console.warn('WebGL unavailable — running without the 3D viewport:', e.message);
}
state.webgl = !!renderer;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(20, 15, 20);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);
// Front fill light: vanilla mob faces point toward -Z, and the main
// light comes from +X/+Z — without this the face is always in shadow.
const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
fillLight.position.set(-6, 8, -14);
scene.add(fillLight);
// Rim light from behind so dark models separate from the background.
const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
rimLight.position.set(16, 12, -20);
scene.add(rimLight);
const ambientBoost = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientBoost);

// Grid
const gridHelper = new THREE.GridHelper(32, 32, 0x30363d, 0x21262d);
scene.add(gridHelper);

// Axes
const axesHelper = new THREE.AxesHelper(8);
scene.add(axesHelper);

// Controls (work on the canvas element; do not require WebGL)
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.1;
orbitControls.target.set(0, 4, 0);

const transformControls = new TransformControls(camera, canvas);
scene.add(transformControls);

// Dev/debug handles
state.camera = camera;
state.orbitControls = orbitControls;
state.scene = scene;

transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
    state._dragActive = event.value;
    // Raahauksen lopussa varmistetaan, että render ja data ovat yhtä —
    // kesken raahauksen ei tarkisteta (data päivittyy joka tapahtumassa,
    // ja toistuva tarkistus hidastaisi suuria malleja).
    if (!event.value) checkRenderConsistency();
});

transformControls.addEventListener('objectChange', () => {
    if (!transformControls.object) return;
    const obj = transformControls.object;
    if (state.bones.includes(obj)) {
        updateBoneFromObject(obj);
        // Asentotila: luun raahaaminen tallentaa asennon keyframeksi automaattisesti
        if (state.animation && state.animation.poseMode && state.animation.addKeyframe) {
            state.animation.addKeyframe(true);
        }
    } else {
        updatePropertiesFromObject(obj);
    }
    if (!state._dragActive) checkRenderConsistency();
});

// ==================== RESIZE ====================
function onResize() {
    const viewport = document.getElementById('viewport');
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (renderer) renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
setTimeout(onResize, 0);

// ==================== RAYCASTING ====================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseClick(event) {
    if (event.target !== canvas) return;
    if (state.tool === 'paint' || state.tool === 'pipette') return; // ei valitse osia

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(state.cubes, false);

    if (intersects.length > 0) {
        const mesh = intersects[0].object;
        if (state.animation && state.animation.poseMode) {
            // Asentotila: osan klikkaus valitsee sen luun (rotate-gizmo),
            // jotta luuta voi kääntää kädellä suoraan 3D:ssä.
            const idx = state.cubes.indexOf(mesh);
            const boneData = findBoneForCube(idx);
            if (boneData) {
                const bi = state.model.bones.indexOf(boneData);
                deselectAll();
                selectBone(bi);
                return;
            }
        }
        selectCube(mesh);
    } else {
        deselectAll();
    }
}

canvas.addEventListener('click', onMouseClick);

// ==================== 3D PAINTING ====================
// Maalaa suoraan mallin pintaan: raycast osuu kuution kasvoon ja osuman
// interpoloidusta UV:stä johdetaan tekstuuripiste, johon sivellin piirtyy.
//
// Syvyysestot: raycast palauttaa lähimmän ETEENPÄIN osoittavan pinnan
// (FrontSide-culling), joten läpi seinän ei maalata. Sivellin leikataan
// osumakasvon UV-rectiin, joten väri ei vuoda naapurikasvoille — ja
// vedon viiva katkeaa kasvon reunalla (ei maalaa mallin sisäosan läpi).
const FACE_BY_NORMAL = (n) => {
    if (Math.abs(n.x) > 0.5) return n.x > 0 ? 'east' : 'west';
    if (Math.abs(n.y) > 0.5) return n.y > 0 ? 'up' : 'down';
    return n.z > 0 ? 'south' : 'north';
};

// ---- peilattu maalaus -------------------------------------------------
// Etsii jokaiselle kuutiolle peilikuutio nimen perusteella (sama logiikka
// kuin Mirror Pose: right_X ↔ left_X, leg0 ↔ leg1, numeroparit jne.) ja
// peilaa maalauspisteen vastakkaisen puolen kasvolle (u käännetään). Näin
// symmetriset kasvot (silmät, kuviot) syntyvät yhdellä vedolla.
function mirrorCubeName(name) {
    const swaps = [
        [/^right_(.+)$/, 'left_$1'],
        [/^left_(.+)$/, 'right_$1'],
        [/^(.+)_right$/, '$1_left'],
        [/^(.+)_left$/, '$1_right'],
        [/^(.+)_r$/, '$1_l'],
        [/^(.+)_l$/, '$1_r'],
        [/^(.+)R$/, '$1L'],
        [/^(.+)L$/, '$1R']
    ];
    for (const [re, rep] of swaps) {
        if (re.test(name)) return name.replace(re, rep);
    }
    const num = name.match(/^(.*?)(\d+)$/);
    if (num) {
        const n = parseInt(num[2], 10);
        return num[1] + (n % 2 === 0 ? n + 1 : n - 1);
    }
    return null;
}

const MIRROR_FACE = { east: 'west', west: 'east', north: 'north', south: 'south', up: 'up', down: 'down' };

function getCubeMirrorMap() {
    if (state.cubeMirrorMapVersion === state.modelVersion) return state.cubeMirrorMap;
    const byName = {};
    let idx = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) { byName[cube.name] = idx; idx++; }
    }
    const map = {};
    idx = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            const m = mirrorCubeName(cube.name);
            map[idx] = (m && byName[m] !== undefined && byName[m] !== idx) ? byName[m] : null;
            idx++;
        }
    }
    state.cubeMirrorMap = map;
    state.cubeMirrorMapVersion = state.modelVersion;
    return map;
}

/** Laske maalauspisteen peilikuva vastakkaisen kuution vastaavalla kasvolla. */
function mirrorPaintTarget(p) {
    if (!p || !p.faceRect || !p.face) return null;
    const mIdx = getCubeMirrorMap()[p.cubeIndex];
    if (mIdx === null || mIdx === undefined) return null;
    const mCube = findCubeData(mIdx);
    const mFace = MIRROR_FACE[p.face];
    const mRect = mCube ? computeFaceRects(mCube).find(r => r.face === mFace) : null;
    if (!mRect) return null;
    const src = p.faceRect;
    // Peilikuva vaatii samankokoisen kasvon (oikea/vasen ovat peilikuvia)
    if (Math.abs(src.w - mRect.w) > 0.01 || Math.abs(src.h - mRect.h) > 0.01) return null;
    const u = p.tx - src.x;
    const v = p.ty - src.y;
    return {
        tx: mRect.x + (src.w - u), // u käännetään vaakasuunnassa
        ty: mRect.y + v,
        faceRect: mRect,
        cubeIndex: mIdx,
        face: mFace,
        tctx: p.tctx
    };
}

function paint3DAt(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(state.cubes, false);
    if (hits.length === 0 || !hits[0].uv) return null;
    const hit = hits[0];
    if (!state.textureCanvas) ensureTexture();
    const cubeData = findCubeData(hit.object.userData.cubeIndex);
    const face = hit.face ? FACE_BY_NORMAL(hit.face.normal) : null;
    const faceRect = (cubeData && face)
        ? computeFaceRects(cubeData).find(r => r.face === face)
        : null;
    return {
        tx: hit.uv.x * state.model.textureWidth,
        ty: (1 - hit.uv.y) * state.model.textureHeight,
        tctx: state.textureCanvas.getContext('2d'),
        cubeIndex: hit.object.userData.cubeIndex,
        face,
        faceRect: faceRect || null
    };
}

function paintSpotOn(p) {
    if (!p || !p.faceRect) return;
    const brush = state.uvEditor ? state.uvEditor.getBrushSize() : 3;
    const color = state.uvEditor ? state.uvEditor.getPaintColor() : '#000000';
    const ctx = p.tctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.faceRect.x, p.faceRect.y, p.faceRect.w, p.faceRect.h);
    ctx.clip(); // sivellin pysyy osumakasvon alueella
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.tx, p.ty, brush, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function paintLineOn(from, to) {
    const brush = state.uvEditor ? state.uvEditor.getBrushSize() : 3;
    const color = state.uvEditor ? state.uvEditor.getPaintColor() : '#000000';
    const ctx = from.tctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(from.faceRect.x, from.faceRect.y, from.faceRect.w, from.faceRect.h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = brush * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.tx, from.ty);
    ctx.lineTo(to.tx, to.ty);
    ctx.stroke();
    ctx.restore();
}

function paint3DSpot(p) {
    if (!p || !p.faceRect) return;
    paintSpotOn(p);
    if (state.mirrorPaint) {
        const m = mirrorPaintTarget(p);
        if (m) paintSpotOn(m);
    }
    state.texture.needsUpdate = true;
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
}

function paint3DLine(from, to) {
    // Viiva vain samalla kasvolla — reunan yli vedetty viiva ei maalaa
    // mallin sisäosan läpi (eri kasvo = eri UV-rect).
    if (!from || !to || from.cubeIndex !== to.cubeIndex || from.face !== to.face) {
        if (to) paint3DSpot(to);
        return;
    }
    paintLineOn(from, to);
    if (state.mirrorPaint) {
        const mf = mirrorPaintTarget(from);
        const mt = mirrorPaintTarget(to);
        if (mf && mt && mf.cubeIndex === mt.cubeIndex && mf.face === mt.face) {
            paintLineOn(mf, mt);
        } else if (mt) {
            paint3DSpot(mt);
        }
    }
    state.texture.needsUpdate = true;
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
}

// ---- maalauksen undo/redo -------------------------------------------
// Jokainen veto (mousedown → mouseup) tallentaa tekstuurin tilan ennen
// vetoa; Ctrl+Z / Ctrl+Y palauttaa/tekee uudelleen maalausvedon (ja
// vasta kun maalaushistoria on tyhjä, undo koskee mallia).
const paintHistory = { undo: [], redo: [] };
function snapshotTexture() {
    if (!state.textureCanvas) return null;
    return state.textureCanvas.getContext('2d')
        .getImageData(0, 0, state.textureCanvas.width, state.textureCanvas.height);
}
function pushPaintHistory() {
    const snap = snapshotTexture();
    if (!snap) return;
    paintHistory.undo.push(snap);
    if (paintHistory.undo.length > 40) paintHistory.undo.shift();
    paintHistory.redo = [];
}
function restoreTexture(snap) {
    if (!snap || !state.textureCanvas) return;
    state.textureCanvas.getContext('2d').putImageData(snap, 0, 0);
    if (state.texture) state.texture.needsUpdate = true;
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
}
function undoPaint() {
    const snap = paintHistory.undo.pop();
    if (!snap) return false;
    paintHistory.redo.push(snapshotTexture());
    restoreTexture(snap);
    return true;
}
function redoPaint() {
    const snap = paintHistory.redo.pop();
    if (!snap) return false;
    paintHistory.undo.push(snapshotTexture());
    restoreTexture(snap);
    return true;
}

// ---- väripipetti ------------------------------------------------------
// Valitsee värin suoraan mallin pinnasta: klikkaus lukee tekstuurin
// pikselin osumakohdasta ja asettaa sen maalausväriksi. Palaa sitten
// automaattisesti maalaukseen, jotta voi jatkaa samalla värillä.
function readTextureColor(tx, ty) {
    if (!state.textureCanvas) ensureTexture();
    const w = state.textureCanvas.width;
    const h = state.textureCanvas.height;
    const x = Math.max(0, Math.min(w - 1, Math.floor(tx)));
    const y = Math.max(0, Math.min(h - 1, Math.floor(ty)));
    const img = state.textureCanvas.getContext('2d').getImageData(x, y, 1, 1).data;
    if (img[3] === 0) return null; // läpinäkyvä pikseli
    return '#' + [img[0], img[1], img[2]]
        .map(v => v.toString(16).padStart(2, '0')).join('');
}

let paint3D = false;
let paintLast = null;
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Väripipetti: yksi klikkaus poimii värin ja palaa maalaukseen
    if (state.tool === 'pipette') {
        e.preventDefault();
        e.stopPropagation();
        const p = paint3DAt(e);
        if (p) {
            const color = readTextureColor(p.tx, p.ty);
            if (color) {
                const input = document.getElementById('uv-paint-color');
                if (input) {
                    input.value = color;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                setStatus(`💉 Väri valittu: ${color} — jatka maalausta`);
            } else {
                setStatus('💉 Osuma oli läpinäkyvä — kokeile toista kohtaa');
            }
        } else {
            setStatus('💉 Ei osumaa malliin');
        }
        setTool('paint'); // palaa maalaukseen valitulla värillä
        return;
    }
    if (state.tool !== 'paint') return;
    e.preventDefault();
    e.stopPropagation();
    pushPaintHistory(); // vedon alku: tallenna tila ennen maalausta
    paint3D = true;
    paintLast = paint3DAt(e);
    paint3DSpot(paintLast);
});
canvas.addEventListener('mousemove', (e) => {
    if (!paint3D || state.tool !== 'paint') return;
    const p = paint3DAt(e);
    paint3DLine(paintLast, p);
    paintLast = p;
});
window.addEventListener('mouseup', () => { paint3D = false; paintLast = null; });

// ==================== SELECTION ====================
function selectCube(mesh) {
    deselectAll();

    const idx = state.cubes.indexOf(mesh);
    if (idx === -1) return;

    state.selectedCube = idx;
    mesh.material.emissive.set(0x2266aa);
    mesh.material.emissiveIntensity = 0.3;

    const cubeData = findCubeData(idx);
    const boneData = findBoneForCube(idx);

    // Select corresponding bone too
    if (boneData) {
        state.selectedBone = state.model.bones.indexOf(boneData);
        highlightBoneTree();
    }

    // Attach transform controls
    transformControls.attach(mesh);
    showProperties(cubeData, boneData);
    setStatus(`Selected: ${cubeData.name}`);
    if (state.uvEditor) state.uvEditor.draw(); // päivitä UV-editorin kasvovärit
}

function selectBone(index) {
    state.selectedBone = index;
    state.selectedCube = null;

    if (index !== null && state.bones[index]) {
        transformControls.attach(state.bones[index]);
        if (state.tool === 'select' || (state.animation && state.animation.poseMode)) {
            setTool('rotate');  // posing bones is the most common action
        }
    }

    highlightBoneTree();
    const bone = state.model.bones[index];
    if (bone) {
        setStatus(`Selected bone: ${bone.name} — press R to rotate, G to move`);
    }
}

function updateBoneFromObject(group) {
    const bi = state.bones.indexOf(group);
    if (bi === -1) return;
    const boneData = state.model.bones[bi];
    // Bedrock-luilla ei ole skaalaa — hylkää skaalaus-gizmo, jotta
    // renderöity malli ja export-data pysyvät yhteneväisinä.
    if (transformControls.getMode() === 'scale' &&
        (group.scale.x !== 1 || group.scale.y !== 1 || group.scale.z !== 1)) {
        group.scale.set(1, 1, 1);
        return;
    }
    // Luut ovat nyt sisäkkäin (hierarkia) — group.position on vanhemman
    // avaruudessa, joten maailmapivot luetaan world-matriisista.
    const worldPos = group.getWorldPosition(new THREE.Vector3());
    const dx = worldPos.x - boneData.pivot[0];
    const dy = worldPos.y - boneData.pivot[1];
    const dz = worldPos.z - boneData.pivot[2];
    // Keep cube world positions stable when the pivot moves
    for (const cube of boneData.cubes) {
        cube.origin[0] += dx;
        cube.origin[1] += dy;
        cube.origin[2] += dz;
    }
    boneData.pivot[0] = Math.round(worldPos.x * 2) / 2;
    boneData.pivot[1] = Math.round(worldPos.y * 2) / 2;
    boneData.pivot[2] = Math.round(worldPos.z * 2) / 2;
    boneData.rotation[0] = Math.round(THREE.MathUtils.radToDeg(group.rotation.x));
    boneData.rotation[1] = Math.round(THREE.MathUtils.radToDeg(group.rotation.y));
    boneData.rotation[2] = Math.round(THREE.MathUtils.radToDeg(group.rotation.z));
    // Päivitä myös parent-relatiivinen lepopositio, jotta animaatio
    // asettaa luun oikein jatkossa.
    const parent = boneData.parent ? state.model.bones.find(b => b.name === boneData.parent) : null;
    const pp = parent ? parent.pivot : [0, 0, 0];
    group.userData.basePosition = [
        boneData.pivot[0] - pp[0],
        boneData.pivot[1] - pp[1],
        boneData.pivot[2] - pp[2]
    ];
}

function deselectAll() {
    state.selectedCube = null;
    state.selectedBone = null;
    state.selectedFace = null;
    transformControls.detach();

    for (const mesh of state.cubes) {
        // Emissiivinen kartta pitää emissiven valkoisena (kartta näkyy);
        // ilman karttaa emissive nollataan valintakorostuksen poistamiseksi.
        if (state.emissiveTexture) {
            mesh.material.emissive.set(0xffffff);
            mesh.material.emissiveIntensity = 1.0;
        } else {
            mesh.material.emissive.set(0x000000);
            mesh.material.emissiveIntensity = 0;
        }
    }

    highlightBoneTree();
    setStatus('Ready');
    if (state.uvEditor) state.uvEditor.draw(); // piilota kasvovärit kun ei valintaa
}

// ==================== MODEL BUILDING ====================
function rebuildModel() {
    state.modelVersion++; // peilikartta ym. välimuistit vanhenevat
    // Clear old meshes
    for (const group of state.bones) {
        scene.remove(group);
    }
    state.bones = [];
    state.cubes = [];

    let cubeIdx = 0;

    // 1) Luo kaikki luuryhmät kuutioineen (ei vielä vanhemmuutta).
    for (let bi = 0; bi < state.model.bones.length; bi++) {
        const boneData = state.model.bones[bi];
        const group = new THREE.Group();
        group.name = boneData.name;
        // Bedrock/GeckoLib/Blockbench käyttävät Euler-järjestystä 'ZYX'
        // (X-akselin rotaatio sovelletaan ensin vektoriin). THREE:n oletus
        // 'XYZ' tuottaa väärät asennot moniakselisilla rotaatioilla.
        group.rotation.order = 'ZYX';
        group.rotation.set(
            THREE.MathUtils.degToRad(boneData.rotation[0]),
            THREE.MathUtils.degToRad(boneData.rotation[1]),
            THREE.MathUtils.degToRad(boneData.rotation[2])
        );

        for (const cubeData of boneData.cubes) {
            const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
            // The texture is the single source of color; it is auto-generated
            // from cube colors when no image has been loaded.
            ensureTexture();
            // Emissiivinen glow: mobin emissiveMap (pelin oma glow-kerros)
            // hehkuttaa valaistuksesta riippumatta — kuten pelin
            // glowRenderType-kerros. Ilman karttaa emissive on musta.
            const hasEmissive = !!state.emissiveTexture;
            const mat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: state.texture,
                roughness: 0.7,
                metalness: 0.1,
                transparent: true,
                // Teksturoidut mobit täysin läpinäkymättömiä (oikea ulkonäkö),
                // väripohjaiset saavat hieman läpikuultavuutta editorissa.
                opacity: state.textureDataURL ? 1.0 : 0.85,
                emissive: hasEmissive ? 0xffffff : 0x000000,
                emissiveMap: hasEmissive ? state.emissiveTexture : null,
                emissiveIntensity: hasEmissive ? 1.0 : 0
            });
            applyBoxTextureUVs(geo, cubeData, state.model.textureWidth, state.model.textureHeight);

            const mesh = new THREE.Mesh(geo, mat);
            // THREE:n BoxGeometry on keskitetty origoon, mutta Bedrock/Blockbench
            // origin on alakulma — mesh pitää siirtää puoli-kokoa, jotta laatikko
            // renderöityy välille origin .. origin+size (kuten pelissä).
            mesh.position.set(
                cubeData.origin[0] + cubeData.size[0] / 2 - boneData.pivot[0],
                cubeData.origin[1] + cubeData.size[1] / 2 - boneData.pivot[1],
                cubeData.origin[2] + cubeData.size[2] / 2 - boneData.pivot[2]
            );
            mesh.rotation.order = 'ZYX';
            mesh.rotation.set(
                THREE.MathUtils.degToRad(cubeData.rotation[0]),
                THREE.MathUtils.degToRad(cubeData.rotation[1]),
                THREE.MathUtils.degToRad(cubeData.rotation[2])
            );
            mesh.userData.cubeIndex = cubeIdx;
            mesh.userData.boneIndex = bi;

            group.add(mesh);
            state.cubes.push(mesh);
            cubeIdx++;
        }

        state.bones.push(group);
    }

    // 2) Rakenna HIERARKIA: lapsiluut vanhempiensa sisään. Bedrock-geometriassa
    // pivotit ja kuutioiden originit ovat mallikoordinaateissa, joten lapsen
    // positio vanhemman avaruudessa = pivot − parentPivot (lepopose). Kun
    // vanhempi pyörii, lapsi seuraa — kuten pelissä (GeckoLib/Blockbench).
    for (let bi = 0; bi < state.model.bones.length; bi++) {
        const boneData = state.model.bones[bi];
        const group = state.bones[bi];
        const parentIdx = boneData.parent
            ? state.model.bones.findIndex(b => b.name === boneData.parent)
            : -1;
        const base = boneData.pivot.slice();
        if (parentIdx >= 0 && state.bones[parentIdx]) {
            const pp = state.model.bones[parentIdx].pivot;
            base[0] -= pp[0];
            base[1] -= pp[1];
            base[2] -= pp[2];
            state.bones[parentIdx].add(group);
        } else {
            scene.add(group);
        }
        group.userData.basePosition = base;
        group.position.set(base[0], base[1], base[2]);
    }

    updateBoneTree();
    // resize() skaalaa canvaksen mallin tekstuurikoon mukaan ja piirtää
    // (aiemmin canvas pysyi vanhassa koossa mallin vaihtuessa)
    if (state.uvEditor) state.uvEditor.resize();
    if (state.animation) state.animation.applyPose();
    checkRenderConsistency();
}

function getBoneColor(index) {
    const colors = [
        0x58a6ff, 0x3fb950, 0xd29922, 0xf85149,
        0xbc8cff, 0xff7b72, 0x79c0ff, 0x56d364,
        0xe3b341, 0xffa657
    ];
    return colors[index % colors.length];
}



// ==================== MODEL OPERATIONS ====================
function addCube() {
    state.history.push(state.model);

    const boneName = state.selectedBone !== null ?
        state.model.bones[state.selectedBone].name : 'root';

    const bone = state.model.bones[state.selectedBone] || state.model.bones[0];
    if (!bone) return;

    const cubeName = `cube_${bone.cubes.length}`;
    const totalCubes = state.model.bones.reduce((n, b) => n + b.cubes.length, 0);
    // Auto-layout the new cube into the texture so its faces don't overlap
    const autoUV = [
        (totalCubes % 4) * 16,
        Math.floor(totalCubes / 4) * 16
    ];
    bone.cubes.push({
        name: cubeName,
        origin: [bone.pivot[0], bone.pivot[1] + 8, bone.pivot[2]],
        size: [4, 4, 4],
        rotation: [0, 0, 0],
        uv: { offset: autoUV },
        mirror: false
    });

    rebuildModel();
    scheduleAutosave();
    setStatus(`Added ${cubeName} to ${bone.name}`);
}

function addBone() {
    state.history.push(state.model);

    const name = `bone_${state.model.bones.length}`;
    state.model.bones.push({
        name,
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: []
    });

    rebuildModel();
    scheduleAutosave();
    setStatus(`Added bone: ${name}`);
}

function deleteSelected() {
    if (state.selectedCube !== null) {
        state.history.push(state.model);
        const cubeData = findCubeData(state.selectedCube);
        const boneData = findBoneForCube(state.selectedBone);
        if (boneData && cubeData) {
            const cubeLocalIdx = boneData.cubes.indexOf(cubeData);
            if (cubeLocalIdx !== -1) boneData.cubes.splice(cubeLocalIdx, 1);
        }
        deselectAll();
        rebuildModel();
        scheduleAutosave();
        setStatus('Cube deleted');
    } else if (state.selectedBone !== null) {
        state.history.push(state.model);
        if (state.model.bones.length > 1) {
            state.model.bones.splice(state.selectedBone, 1);
            deselectAll();
            rebuildModel();
            scheduleAutosave();
            setStatus('Bone deleted');
        }
    }
}

// ==================== HELPERS ====================
function findCubeData(globalIdx) {
    let idx = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            if (idx === globalIdx) return cube;
            idx++;
        }
    }
    return null;
}

function findBoneForCube(globalIdx) {
    let idx = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            if (idx === globalIdx) return bone;
            idx++;
        }
    }
    return null;
}

// ==================== UI UPDATES ====================
function updateBoneTree() {
    const container = document.getElementById('bone-tree');
    container.innerHTML = '';

    state.model.bones.forEach((bone, i) => {
        const item = document.createElement('div');
        item.className = 'bone-item' + (state.selectedBone === i ? ' selected' : '');
        item.innerHTML = `
            <span class="bone-icon">🦴</span>
            <span class="bone-name">${bone.name} (${bone.cubes.length})</span>
            <span class="bone-delete" data-bone="${i}">✕</span>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('bone-delete')) {
                const bi = parseInt(e.target.dataset.bone);
                if (state.model.bones.length > 1) {
                    state.history.push(state.model);
                    state.model.bones.splice(bi, 1);
                    deselectAll();
                    rebuildModel();
                }
                return;
            }
            selectBone(i);
        });

        // Show cubes under this bone
        bone.cubes.forEach((cube, ci) => {
            const cubeItem = document.createElement('div');
            cubeItem.className = 'bone-item';
            cubeItem.style.paddingLeft = '24px';
            cubeItem.innerHTML = `
                <span class="bone-icon">📦</span>
                <span class="bone-name">${cube.name}</span>
            `;
            cubeItem.addEventListener('click', () => {
                // Find global cube index
                let globalIdx = 0;
                for (let bi = 0; bi <= i; bi++) {
                    for (let c = 0; c < state.model.bones[bi].cubes.length; c++) {
                        if (bi === i && c === ci) {
                            selectCube(state.cubes[globalIdx]);
                            return;
                        }
                        globalIdx++;
                    }
                }
            });
            container.appendChild(cubeItem);
        });

        container.appendChild(item);
    });
}

function highlightBoneTree() {
    updateBoneTree();
}

function showProperties(cubeData, boneData) {
    if (!cubeData) return;

    document.getElementById('prop-pos-x').value = cubeData.origin[0];
    document.getElementById('prop-pos-y').value = cubeData.origin[1];
    document.getElementById('prop-pos-z').value = cubeData.origin[2];
    document.getElementById('prop-rot-x').value = cubeData.rotation[0];
    document.getElementById('prop-rot-y').value = cubeData.rotation[1];
    document.getElementById('prop-rot-z').value = cubeData.rotation[2];
    document.getElementById('prop-size-x').value = cubeData.size[0];
    document.getElementById('prop-size-y').value = cubeData.size[1];
    document.getElementById('prop-size-z').value = cubeData.size[2];
    document.getElementById('prop-origin-x').value = boneData ? boneData.pivot[0] : 0;
    document.getElementById('prop-origin-y').value = boneData ? boneData.pivot[1] : 0;
    document.getElementById('prop-origin-z').value = boneData ? boneData.pivot[2] : 0;
    document.getElementById('prop-name').value = cubeData.name;
    document.getElementById('prop-color').value = cubeData.color || '#ffffff';
}

function updatePropertiesFromObject(mesh) {
    if (state.selectedCube === null) return;

    const cubeData = findCubeData(state.selectedCube);
    const boneData = findBoneForCube(state.selectedCube);
    if (!cubeData || !boneData) return;

    // Skaalaus-gizmo: mesh.scale pitää kirjoittaa dataan (size) ja polttaa
    // geometriaan, muuten renderöity koko ja data eroavat (ja export veisi
    // vanhan koon). Skaalaus tapahtuu keskipisteen ympäri, joten positio
    // säilyy — vain koko ja UV:t päivittyvät.
    if (transformControls.getMode() === 'scale' &&
        (mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1)) {
        cubeData.size[0] = Math.max(0.25, Math.round(Math.abs(cubeData.size[0] * mesh.scale.x) * 100) / 100);
        cubeData.size[1] = Math.max(0.25, Math.round(Math.abs(cubeData.size[1] * mesh.scale.y) * 100) / 100);
        cubeData.size[2] = Math.max(0.25, Math.round(Math.abs(cubeData.size[2] * mesh.scale.z) * 100) / 100);
        const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
        applyBoxTextureUVs(geo, cubeData, state.model.textureWidth, state.model.textureHeight);
        mesh.geometry.dispose();
        mesh.geometry = geo;
        mesh.scale.set(1, 1, 1);
    }

    // Update cube data from mesh world position — mesh on keskipisteessä,
    // origin on alakulma: origin = keskipiste − koko/2. Pyöristys 3 desimaaliin
    // (ei 0.5-ruudukkoon): murto-osainen koko (esim. 4.5/2 = 2.25) pitää
    // originin tarkkana, muuten kuutio siirtyy rebuildissa 0.25 pois.
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    cubeData.origin[0] = Math.round((worldPos.x - cubeData.size[0] / 2) * 1000) / 1000;
    cubeData.origin[1] = Math.round((worldPos.y - cubeData.size[1] / 2) * 1000) / 1000;
    cubeData.origin[2] = Math.round((worldPos.z - cubeData.size[2] / 2) * 1000) / 1000;

    cubeData.rotation[0] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.x));
    cubeData.rotation[1] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.y));
    cubeData.rotation[2] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.z));

    showProperties(cubeData, boneData);
    if (state.uvEditor) state.uvEditor.draw(); // koon muutos päivittää kasvojen rectit
}

function setStatus(text) {
    document.getElementById('status-text').textContent = text;
}

// ==================== RENDER CONSISTENCY CHECK ====================
/**
 * Runtime-versio tools/verify-render.js:stä — tarkistaa jokaisen kuution
 * renderöidyn keskipisteen (mesh.getWorldPosition) data-keskipistettä vastaan
 * (origin + size/2). Jos ero ylittää 0.01, 3D-näkymä ja data eroavat ja
 * export veisi väärän geometrian — näytetään varoitusbanneri.
 *
 * Kierretty luuketju siirtää keskipisteen oikeutetusti (kuten verify-renderin
 * pehmeät huomiot), joten niitä ei lasketa virheiksi.
 *
 * Vertailu tehdään rest-asennossa: luut asetetaan väliaikaisesti data-restiin
 * (rotaatio + peruspositio), verrataan ja palautetaan. Näin animaation
 * avainframet (esim. kävely kääntää jalat jo framessa 0) eivät peitä
 * geometriavirheitä eivätkä tuota vääriä hälytyksiä.
 */
function boneChainRotated(boneIdx) {
    let idx = boneIdx;
    while (idx >= 0) {
        const b = state.model.bones[idx];
        if (b && b.rotation && b.rotation.some(v => Math.abs(v) > 0.001)) return true;
        idx = b && b.parent ? state.model.bones.findIndex(x => x.name === b.parent) : -1;
    }
    return false;
}

function checkRenderConsistency() {
    const banner = document.getElementById('render-warning');
    if (!banner || !state.cubes.length) return;

    // O(1)-kartta kuutio → (cubeData, bone) — rakennetaan vain kun malli muuttuu
    if (checkRenderConsistency._version !== state.modelVersion) {
        const map = [];
        for (const bone of state.model.bones) {
            for (const cube of bone.cubes) map.push({ cube, bone });
        }
        checkRenderConsistency._map = map;
        checkRenderConsistency._version = state.modelVersion;
    }

    // Siirrä luut rest-asentoon (tallennetaan nykyinen animaatio/pose-asetus)
    const saved = state.bones.map(g => ({ pos: g.position.clone(), rot: g.rotation.clone() }));
    for (let bi = 0; bi < state.model.bones.length; bi++) {
        const b = state.model.bones[bi];
        const g = state.bones[bi];
        if (!g) continue;
        const base = g.userData.basePosition || b.pivot;
        g.position.set(base[0], base[1], base[2]);
        g.rotation.order = 'ZYX';
        g.rotation.set(
            THREE.MathUtils.degToRad(b.rotation[0]),
            THREE.MathUtils.degToRad(b.rotation[1]),
            THREE.MathUtils.degToRad(b.rotation[2])
        );
    }
    scene.updateMatrixWorld(true);

    const offenders = [];
    const world = new THREE.Vector3();
    try {
        const map = checkRenderConsistency._map;
        for (let ci = 0; ci < state.cubes.length && ci < map.length; ci++) {
            const mesh = state.cubes[ci];
            const { cube: cubeData, bone } = map[ci];
            if (!mesh || !cubeData || !bone) continue;
            if (boneChainRotated(state.model.bones.indexOf(bone))) continue;
            mesh.getWorldPosition(world);
            const dev = Math.hypot(
                world.x - (cubeData.origin[0] + cubeData.size[0] / 2),
                world.y - (cubeData.origin[1] + cubeData.size[1] / 2),
                world.z - (cubeData.origin[2] + cubeData.size[2] / 2)
            );
            if (dev > 0.01) offenders.push({ idx: ci, cube: cubeData.name, bone: bone.name, dev });
        }
    } finally {
        // Palauta tallennettu asento, jotta näkymä ei jää rest-poseen
        for (let bi = 0; bi < state.bones.length; bi++) {
            state.bones[bi].position.copy(saved[bi].pos);
            state.bones[bi].rotation.copy(saved[bi].rot);
        }
        scene.updateMatrixWorld(true);
    }

    if (offenders.length > 0) {
        offenders.sort((a, b) => b.dev - a.dev);
        const first = offenders.slice(0, 3).map(o => `${o.cube} (${o.dev.toFixed(2)})`).join(', ');
        document.getElementById('render-warning-text').textContent =
            `${offenders.length} kuutiota renderöityy väärin — 3D-näkymä ja data eroavat yli 0.01: ${first}${offenders.length > 3 ? '…' : ''}`;
        banner.dataset.firstIdx = offenders[0].idx;
        banner.hidden = false;
    } else {
        banner.hidden = true;
        document.getElementById('render-warning-text').textContent = '';
        delete banner.dataset.firstIdx;
    }
}

document.getElementById('render-warning').addEventListener('click', () => {
    const banner = document.getElementById('render-warning');
    const idx = parseInt(banner.dataset.firstIdx);
    if (!Number.isNaN(idx) && state.cubes[idx]) {
        selectCube(state.cubes[idx]);
        const cubeData = findCubeData(idx);
        setStatus(`⚠️ ${cubeData ? cubeData.name : 'kuutio'} valittu — tarkista sen sijainti/koko`);
    }
});

// ==================== PROPERTY INPUT HANDLERS ====================
function setupPropertyInputs() {
    const props = {
        'prop-pos-x': (v, cd) => cd.origin[0] = parseFloat(v),
        'prop-pos-y': (v, cd) => cd.origin[1] = parseFloat(v),
        'prop-pos-z': (v, cd) => cd.origin[2] = parseFloat(v),
        'prop-rot-x': (v, cd) => cd.rotation[0] = parseFloat(v),
        'prop-rot-y': (v, cd) => cd.rotation[1] = parseFloat(v),
        'prop-rot-z': (v, cd) => cd.rotation[2] = parseFloat(v),
        'prop-size-x': (v, cd) => cd.size[0] = Math.max(0.25, parseFloat(v)),
        'prop-size-y': (v, cd) => cd.size[1] = Math.max(0.25, parseFloat(v)),
        'prop-size-z': (v, cd) => cd.size[2] = Math.max(0.25, parseFloat(v)),
        'prop-name': (v, cd) => cd.name = v,
    };

    for (const [id, setter] of Object.entries(props)) {
        document.getElementById(id).addEventListener('change', (e) => {
            if (state.selectedCube === null) return;
            state.history.push(state.model);
            const cubeData = findCubeData(state.selectedCube);
            if (cubeData) {
                setter(e.target.value, cubeData);
                rebuildModel();
                // Kiinnitä gizmo uudelleen uuteen mesh-objektiin samalla indeksillä
                if (state.selectedCube !== null && state.cubes[state.selectedCube]) {
                    transformControls.attach(state.cubes[state.selectedCube]);
                } else if (state.selectedBone !== null && state.bones[state.selectedBone]) {
                    transformControls.attach(state.bones[state.selectedBone]);
                }
                scheduleAutosave();
            }
        });
    }

    // Cube color — refills the cube's face regions on the texture so the
    // color change is immediately visible in both UV editor and 3D view.
    document.getElementById('prop-color').addEventListener('input', (e) => {
        if (state.selectedCube === null) return;
        const cubeData = findCubeData(state.selectedCube);
        if (cubeData) {
            cubeData.color = e.target.value;
            ensureTexture();
            fillCubeFaces(state.textureCanvas.getContext('2d'), cubeData, cubeData.color);
            state.texture.needsUpdate = true;
            if (state.uvEditor) state.uvEditor.draw();
            scheduleAutosave();
        }
    });
}

// ==================== TOOLBAR ====================
function setTool(tool) {
    state.tool = tool;
    // Vain varsinaiset työkalut (data-tool) — uv-toolit ja 🪞-kytkin
    // eivät saa nollata 3D-työkalua.
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });

    if (tool === 'move') {
        transformControls.setMode('translate');
    } else if (tool === 'rotate') {
        transformControls.setMode('rotate');
    } else if (tool === 'scale') {
        transformControls.setMode('scale');
    } else if (tool === 'paint' || tool === 'pipette') {
        transformControls.detach();
        canvas.style.cursor = 'crosshair';
        // Näkymän pysäytys: maalaus-/pipetti-tilassa kamera ei
        // kierrä/zoomaa/panoroi — malli pysyy täysin paikallaan.
        if (orbitControls) {
            orbitControls.enabled = false;
            orbitControls.mouseButtons.LEFT = null;
        }
    } else {
        transformControls.detach();
        canvas.style.cursor = '';
        if (orbitControls) {
            orbitControls.enabled = true;
            orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        }
    }

    // Re-attach to the current selection with the new mode
    if (tool !== 'select' && state.selectedCube !== null && state.cubes[state.selectedCube]) {
        transformControls.attach(state.cubes[state.selectedCube]);
    } else if (tool !== 'select' && state.selectedBone !== null && state.bones[state.selectedBone]) {
        transformControls.attach(state.bones[state.selectedBone]);
    }
}

function setupToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    document.getElementById('btn-add-cube').addEventListener('click', addCube);
    document.getElementById('btn-add-group').addEventListener('click', addBone);
    const mirrorBtn = document.getElementById('btn-mirror-copy');
    if (mirrorBtn) mirrorBtn.addEventListener('click', mirrorCopy);

    // Peilattu maalaus -kytkin (🪞 UV-työkalupalkissa)
    const mirrorPaintBtn = document.getElementById('btn-mirror-paint');
    if (mirrorPaintBtn) {
        mirrorPaintBtn.addEventListener('click', () => {
            state.mirrorPaint = !state.mirrorPaint;
            mirrorPaintBtn.classList.toggle('active', state.mirrorPaint);
            mirrorPaintBtn.title = state.mirrorPaint
                ? 'Peilattu maalaus PÄÄLLÄ — maalaa myös peilikuva (klikkaa pois)'
                : 'Mirror paint — maalaa myös peilikuva vastakkaiselle puolelle';
            setStatus(state.mirrorPaint ? '🪞 Peilattu maalaus päällä' : 'Peilattu maalaus pois');
        });
    }

    // Display settings
    document.getElementById('chk-wireframe').addEventListener('change', (e) => {
        state.cubes.forEach(m => m.material.wireframe = e.target.checked);
    });

    document.getElementById('chk-grid').addEventListener('change', (e) => {
        gridHelper.visible = e.target.checked;
    });

    document.getElementById('bg-color').addEventListener('input', (e) => {
        if (renderer) renderer.setClearColor(e.target.value);
    });
}

// ==================== MOB LIBRARY ====================
/** Hakutoiminto + lajittelu: suodattaa mob-kirjaston nimen/kuvauksen/id:n
 *  perusteella, lajittelee oletuksella / isoimmat ensin / pienimmät ensin /
 *  aakkosilla, ja voi rajata vain Deep Void -otoksiin. */
const libraryFilter = { search: '', sort: 'default', deepvoidOnly: false, voxelOnly: false, sizeClass: 'all' };

function setupLibrary() {
    const container = document.getElementById('mob-library');
    const countEl = document.getElementById('mob-count');
    const searchEl = document.getElementById('mob-search');
    const sortEl = document.getElementById('mob-sort');
    const deepvoidEl = document.getElementById('mob-filter-deepvoid');
    const voxelEl = document.getElementById('mob-filter-voxel');
    const sizeEl = document.getElementById('mob-size');

    function createMobButton(mob) {
        const btn = document.createElement('button');
        btn.className = 'mob-btn';
        const sizeLabels = { jatti: '🐘 Jättiläinen', iso: '🦍 Iso', keski: '🧍 Keskikoko', pieni: '🐜 Pieni' };
        btn.title = (mob.description || '') +
            (mob.size ? ` — ${mob.size} lohkoa korkea` : '') +
            ` — ${mob.tier === 'boss' ? '👑 BOSSI' : '⚔️ minioni'} (pisteet ${mob.score})` +
            ` — ${sizeLabels[mob.sizeClass] || ''}`;
        btn.innerHTML = `<span class="mob-emoji">${mob.emoji}</span><span>${mob.name}</span>` +
            `<span class="mob-size-badge">${sizeLabels[mob.sizeClass] || ''}</span>`;
        btn.addEventListener('click', () => loadLibraryMob(mob));
        return btn;
    }

    function renderLibrary() {
        const q = libraryFilter.search.trim().toLowerCase();
        let list = LIBRARY_MOBS.slice();
        if (libraryFilter.deepvoidOnly) {
            list = list.filter(m => m.category === 'deepvoid');
        }
        if (libraryFilter.voxelOnly) {
            list = list.filter(m => m.category === 'voxel');
        }
        if (libraryFilter.sizeClass !== 'all') {
            list = list.filter(m => m.sizeClass === libraryFilter.sizeClass);
        }
        if (q) {
            list = list.filter(m =>
                (m.name || '').toLowerCase().includes(q) ||
                (m.description || '').toLowerCase().includes(q) ||
                (m.id || '').toLowerCase().includes(q)
            );
        }
        if (libraryFilter.sort === 'biggest') {
            list.sort((a, b) => (b.size || 0) - (a.size || 0));
        } else if (libraryFilter.sort === 'smallest') {
            list.sort((a, b) => (a.size || 0) - (b.size || 0));
        } else if (libraryFilter.sort === 'name') {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fi'));
        }
        container.innerHTML = '';
        // Ryhmittely: Bossit (score ≥ 16) omaksi osiokseen, sitten Minionit
        function appendGroup(label, mobs) {
            if (!mobs.length) return;
            const hdr = document.createElement('div');
            hdr.className = 'mob-group-header';
            hdr.textContent = `${label} (${mobs.length})`;
            container.appendChild(hdr);
            for (const mob of mobs) container.appendChild(createMobButton(mob));
        }
        const bosses = list.filter(m => m.tier === 'boss');
        const minions = list.filter(m => m.tier !== 'boss');
        appendGroup('👑 Bossit', bosses);
        appendGroup('⚔️ Minionit', minions);
        if (countEl) {
            countEl.textContent = list.length < LIBRARY_MOBS.length
                ? `— ${list.length} / ${LIBRARY_MOBS.length} mobia`
                : `— valmiit, klikkaa!`;
        }
    }

    searchEl.addEventListener('input', () => {
        libraryFilter.search = searchEl.value;
        renderLibrary();
    });
    sortEl.addEventListener('change', () => {
        libraryFilter.sort = sortEl.value;
        renderLibrary();
    });
    deepvoidEl.addEventListener('change', () => {
        libraryFilter.deepvoidOnly = deepvoidEl.checked;
        renderLibrary();
    });
    voxelEl.addEventListener('change', () => {
        libraryFilter.voxelOnly = voxelEl.checked;
        renderLibrary();
    });
    sizeEl.addEventListener('change', () => {
        libraryFilter.sizeClass = sizeEl.value;
        renderLibrary();
    });
    renderLibrary();
    // Uuden mobin pohjat — valmiit luurangot aloittamiseen
    const tplContainer = document.getElementById('template-grid');
    if (tplContainer) {
        for (const tpl of MOB_TEMPLATES) {
            const btn = document.createElement('button');
            btn.className = 'mob-btn';
            btn.title = tpl.description;
            btn.innerHTML = `<span class="mob-emoji">${tpl.emoji}</span><span>${tpl.name}</span>`;
            btn.addEventListener('click', () => openNewMobDialog(tpl.id));
            tplContainer.appendChild(btn);
        }
    }
    // Vaihda animaatiota (tallennetaan ensin nykyinen, ladataan valittu)
    const animSelect = document.getElementById('anim-select');
    if (animSelect) {
        animSelect.addEventListener('change', () => {
            if (!state.projectAnimations || !state.projectAnimations[animSelect.value]) return;
            saveCurrentAnimation();
            loadAnimationData(state.projectAnimations[animSelect.value]);
            state.currentAnimName = animSelect.value;
            setStatus(`Animaatio: ${animSelect.value} — paina ▶`);
        });
    }

    // Animaatiomanageri: luo / kopioi / nimeä / poista
    document.getElementById('anim-new').addEventListener('click', () => {
        saveCurrentAnimation();
        const base = 'animation';
        let name = base;
        let n = 1;
        while (state.projectAnimations[name]) name = `${base}_${n++}`;
        state.projectAnimations[name] = { length: 40, tracks: {} };
        state.currentAnimName = name;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[name]);
        setStatus(`Uusi animaatio: ${name}`);
    });

    document.getElementById('anim-dup').addEventListener('click', () => {
        saveCurrentAnimation();
        const src = state.currentAnimName;
        if (!src || !state.projectAnimations[src]) { setStatus('Ei animaatiota kopioitavaksi'); return; }
        let name = src + '_copy';
        let n = 1;
        while (state.projectAnimations[name]) name = `${src}_copy_${n++}`;
        state.projectAnimations[name] = JSON.parse(JSON.stringify(state.projectAnimations[src]));
        state.currentAnimName = name;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[name]);
        setStatus(`Kopioitu: ${src} → ${name}`);
    });

    document.getElementById('anim-rename').addEventListener('click', () => {
        if (!state.currentAnimName) { setStatus('Ei animaatiota nimettäväksi'); return; }
        saveCurrentAnimation();
        const old = state.currentAnimName;
        const name = (prompt('Animaation uusi nimi:', old) || '').trim();
        if (!name || name === old) return;
        if (state.projectAnimations[name]) { setStatus(`Nimi varattu: ${name}`); return; }
        state.projectAnimations[name] = state.projectAnimations[old];
        delete state.projectAnimations[old];
        state.currentAnimName = name;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[name]);
        setStatus(`Nimetty: ${old} → ${name}`);
    });

    document.getElementById('anim-del').addEventListener('click', () => {
        const names = Object.keys(state.projectAnimations);
        if (names.length <= 1) { setStatus('Vähintään yksi animaatio pitää olla'); return; }
        if (!confirm(`Poistetaanko animaatio "${state.currentAnimName}"?`)) return;
        saveCurrentAnimation();
        delete state.projectAnimations[state.currentAnimName];
        const next = Object.keys(state.projectAnimations)[0];
        state.currentAnimName = next;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[next]);
        setStatus(`Poistettu — nyt: ${next}`);
    });
}

/** Tallenna nykyisen timeline-editorin sisältö projektin animaatioon. */
function saveCurrentAnimation() {
    if (!state.animation || !state.currentAnimName) return;
    state.projectAnimations[state.currentAnimName] = {
        length: state.animation.length,
        tracks: JSON.parse(JSON.stringify(state.animation.tracks || {})),
        posTracks: state.animation.posTracks ? JSON.parse(JSON.stringify(state.animation.posTracks)) : undefined
    };
}

/** Päivitä animaatiovalitsin projektin animaatioista. */
function refreshAnimationSelect() {
    const animSelect = document.getElementById('anim-select');
    if (!animSelect) return;
    animSelect.innerHTML = '';
    const names = Object.keys(state.projectAnimations);
    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        animSelect.appendChild(opt);
    }
    animSelect.style.display = names.length > 0 ? '' : 'none';
    if (state.currentAnimName) animSelect.value = state.currentAnimName;
}

function loadAnimationData(anim) {
    if (!state.animation || !anim) return;
    state.animation.playing = false;
    state.animation.time = 0;
    state.animation.length = anim.length;
    state.animation.tracks = JSON.parse(JSON.stringify(anim.tracks));
    state.animation.posTracks = anim.posTracks ? JSON.parse(JSON.stringify(anim.posTracks)) : null;
    const playBtn = document.getElementById('anim-play');
    if (playBtn) playBtn.textContent = '▶';
    const lenInput = document.getElementById('anim-length');
    if (lenInput) lenInput.value = anim.length;
    state.animation.syncSlider();
    state.animation.applyPose();
    if (state.animation.redrawKeys) state.animation.redrawKeys();
}

/** Täytä animaatiovalitsin mobin omilla animaatioilla (idle/walk/attack). */
function loadLibraryMobAnimations(mob) {
    // Kopioidaan mobin animaatiot projektin muokattaviksi animaatioiksi
    state.projectAnimations = {};
    const src = mob.animations || (mob.animation ? { animation: mob.animation } : null);
    for (const [name, anim] of Object.entries(src || {})) {
        state.projectAnimations[name] = JSON.parse(JSON.stringify(anim));
    }
    const names = Object.keys(state.projectAnimations);
    state.currentAnimName = names.length ? names[0] : null;
    refreshAnimationSelect();
    if (state.animation && names.length) {
        loadAnimationData(state.projectAnimations[names[0]]);
    } else if (state.animation) {
        state.animation.length = 40;
        state.animation.tracks = {};
        state.animation.posTracks = null;
        state.animation.syncSlider && state.animation.syncSlider();
        state.animation.redrawKeys && state.animation.redrawKeys();
        state.animation.applyPose();
    }
}

function fitCameraToMob(mob) {
    if (!mob.fit || !state.orbitControls || !state.camera) return;
    const { center, radius } = mob.fit;
    state.orbitControls.target.set(center[0], center[1], center[2]);
    const dist = Math.max(2, radius * 2.6);
    // Mobi katsoo −Z:aan (pelin konventio: kasvot north-kasvolla), joten
    // oletuskamera asetetaan −Z-puolelle — muuten näkyy vain selkä.
    state.camera.position.set(
        center[0] - dist * 0.75,
        center[1] + dist * 0.55,
        center[2] - dist * 0.75
    );
    state.camera.near = Math.max(0.01, dist / 100);
    state.camera.far = Math.max(1000, dist * 10);
    state.camera.updateProjectionMatrix();
    state.orbitControls.update();
}

function loadLibraryMob(mob) {
    state.history.push(state.model);
    state.model = JSON.parse(JSON.stringify(mob.model));
    state.projectName = mob.name;
    updateProjectNameLabel();
    state.texture = null;
    state.textureCanvas = null;
    state.textureDataURL = mob.textureDataURL || null;
    state.emissiveTexture = null;
    state.emissiveDataURL = mob.emissiveDataURL || null;

    // Mobit voivat tarjota useita animaatioita (idle / walk / attack) —
    // yksittäinen "animation" on taaksepäin yhteensopiva oletus.
    loadLibraryMobAnimations(mob);

    deselectAll();
    applyTextureDataURL();
    rebuildModel();
    fitCameraToMob(mob);
    scheduleAutosave();
    const tierTxt = mob.tier === 'boss' ? '👑 BOSSI' : '⚔️ minioni';
    setStatus(`✅ ${mob.name} (${tierTxt}, ${mob.size} lohkoa, pisteet ${mob.score}) ladattu — malli, tekstuuri ja animaatiot valmiina. Paina ▶ katsoaksesi!`);
}

/** Uuden mobin aloittaminen pohjasta: malli + väripohjatekstuuri. */
function loadTemplate(tpl) {
    state.history.push(state.model);
    state.model = JSON.parse(JSON.stringify(tpl.model));
    state.projectName = tpl.name;
    state.texture = null;
    state.textureCanvas = null;
    state.textureDataURL = null;
    state.emissiveTexture = null;
    state.emissiveDataURL = null;
    state.projectAnimations = {};
    state.currentAnimName = null;
    const sel = document.getElementById('anim-select');
    if (sel) { sel.innerHTML = ''; sel.style.display = 'none'; }
    deselectAll();
    rebuildModel();
    // Autosäilö pohjasta alkava malli
    fitCameraToMob({
        fit: { center: [0, 8, 0], radius: 12 }
    });
    updateProjectNameLabel();
    scheduleAutosave();
    setStatus(`🧱 ${tpl.name}-pohja luotu — muokkaa kuutioita, väritä UV-editorissa tai maalaa 3D:ssä`);
}

/**
 * Mirror Copy — kopioi valitun kuution (tai valitun luun kaikki kuutiot)
 * peilikuvana vastakkaiselle puolelle (x-akselin yli), UV:t peilattuna
 * (mirror: true) ja uudella nimellä.
 */
function mirrorCopy() {
    const target = [];
    let mirrorName;
    if (state.selectedCube !== null) {
        const cd = findCubeData(state.selectedCube);
        if (!cd) return;
        target.push(cd);
        mirrorName = cd.name;
    } else if (state.selectedBone !== null && state.model.bones[state.selectedBone]) {
        const bd = state.model.bones[state.selectedBone];
        target.push(...bd.cubes);
        mirrorName = bd.name;
    } else {
        setStatus('Valitse ensin kuutio tai luu, jonka haluat peilata');
        return;
    }
    if (target.length === 0) return;

    state.history.push(state.model);
    const boneData = state.selectedCube !== null
        ? findBoneForCube(state.selectedCube)
        : state.model.bones[state.selectedBone];
    if (!boneData) return;

    const created = [];
    for (const cd of target) {
        const copy = JSON.parse(JSON.stringify(cd));
        copy.name = cd.name + '_mirror';
        // Peilaus x-akselin yli: originin x kääntyy ja leveys kääntyy toiselle puolelle
        copy.origin[0] = -(cd.origin[0] + cd.size[0]);
        copy.rotation[1] = -cd.rotation[1];
        copy.rotation[2] = -cd.rotation[2];
        copy.mirror = !cd.mirror;
        boneData.cubes.push(copy);
        created.push(copy);
    }
    rebuildModel();
    // Valitse luotu peilikuva
    const newIdx = state.cubes.length - created.length;
    if (created.length === 1 && state.cubes[newIdx]) {
        selectCube(state.cubes[newIdx]);
    } else if (state.selectedBone !== null) {
        selectBone(state.selectedBone);
    }
    scheduleAutosave();
    setStatus(`🪞 Peilattu ${created.length} kuutiota: ${mirrorName} → ${mirrorName}_mirror`);
}

// ==================== AUTOSAVE ====================
let autosaveTimer = null;
function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        try {
            saveCurrentAnimation();
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
                model: state.model,
                textureDataURL: state.textureCanvas ? state.textureCanvas.toDataURL() : null,
                emissiveDataURL: state.emissiveDataURL,
                animation: state.animation ? {
                    length: state.animation.length,
                    tracks: state.animation.tracks
                } : null,
                projectAnimations: state.projectAnimations,
                currentAnimName: state.currentAnimName
            }));
        } catch (e) {
            console.warn('Autosave failed:', e);
        }
    }, 300);
}

// ==================== NEW MOB DIALOG ====================
/** Näytä projektin nimi otsikossa. */
function updateProjectNameLabel() {
    const el = document.getElementById('project-name-label');
    if (el) el.textContent = state.projectName ? `— ${state.projectName}` : '';
}

/** Generoi kelvollinen modelId nimestä (geometry.etuliitteellä). */
function slugifyModelId(name) {
    // Poista mahdollinen geometry.-etuliite ensin, jotta sitä ei tuplata
    const base = String(name || '').replace(/^geometry\./i, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_') || 'my_mob';
    return `geometry.${base}`;
}

/** Mikä export-tiedosto modelId:stä tulee. */
function exportFileName(modelId, suffix) {
    return `${String(modelId || '').replace('geometry.', '')}_${suffix}.json`;
}

let newMobDialog = null;
let newMobDirtyId = false;

/** Avaa uuden mobin dialogi; templateId: 'empty' tai pohjan id (esim. 'humanoid'). */
function openNewMobDialog(templateId) {
    if (!newMobDialog) setupNewMobDialog();
    newMobDialog.templateId = templateId;
    const nameInput = document.getElementById('new-mob-name');
    const idInput = document.getElementById('new-mob-id');
    // Edellinen nimi säilyy (ei nollaa joka avauksella), mutta modelId synkataan
    newMobDirtyId = false;
    idInput.value = slugifyModelId(nameInput.value);
    newMobDialog.syncId();
    newMobDialog.selectTemplate(templateId);
    document.getElementById('new-mob-dialog').style.display = 'flex';
    nameInput.focus();
    nameInput.select();
}

function closeNewMobDialog() {
    document.getElementById('new-mob-dialog').style.display = 'none';
}

function setupNewMobDialog() {
    const overlay = document.getElementById('new-mob-dialog');
    const nameInput = document.getElementById('new-mob-name');
    const idInput = document.getElementById('new-mob-id');
    const tplContainer = document.getElementById('new-mob-templates');
    const filePreview = document.getElementById('new-mob-file-preview');

    newMobDialog = {
        templateId: 'empty',
        selectTemplate(id) {
            newMobDialog.templateId = id;
            tplContainer.querySelectorAll('.modal-tpl-btn').forEach(b => {
                b.classList.toggle('selected', b.dataset.tpl === id);
            });
        },
        syncId() {
            filePreview.textContent = exportFileName(idInput.value, 'bedrock');
        }
    };

    // Pohjavaihtoehdot: Tyhjä + kaikki pohjat
    const options = [{ id: 'empty', emoji: '⬜', name: 'Tyhjä' }, ...MOB_TEMPLATES];
    for (const tpl of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-tpl-btn';
        btn.dataset.tpl = tpl.id;
        btn.title = tpl.description || '';
        btn.innerHTML = `<span class="mob-emoji">${tpl.emoji}</span><span>${tpl.name}</span>`;
        btn.addEventListener('click', () => newMobDialog.selectTemplate(tpl.id));
        tplContainer.appendChild(btn);
    }

    // Nimi → modelId automaattisesti (kunnes käyttäjä muokkaa modelId:tä itse)
    nameInput.addEventListener('input', () => {
        if (!newMobDirtyId) {
            idInput.value = slugifyModelId(nameInput.value);
            newMobDialog.syncId();
        }
    });
    idInput.addEventListener('input', () => {
        newMobDirtyId = true;
        newMobDialog.syncId();
    });
    document.getElementById('new-mob-id-sync').addEventListener('click', () => {
        newMobDirtyId = false;
        idInput.value = slugifyModelId(nameInput.value);
        newMobDialog.syncId();
    });

    const create = () => {
        const name = nameInput.value.trim() || 'My Mob';
        const modelId = slugifyModelId(idInput.value.trim() || name);
        const tpl = MOB_TEMPLATES.find(t => t.id === newMobDialog.templateId);
        state.history.push(state.model);
        state.model = tpl ? JSON.parse(JSON.stringify(tpl.model)) : createEmptyModel();
        state.model.modelId = modelId;
        state.projectName = name;
        state.texture = null;
        state.textureCanvas = null;
        state.textureDataURL = null;
        state.emissiveTexture = null;
        state.emissiveDataURL = null;
        state.projectAnimations = {};
        state.currentAnimName = null;
        const sel = document.getElementById('anim-select');
        if (sel) { sel.innerHTML = ''; sel.style.display = 'none'; }
        deselectAll();
        rebuildModel();
        fitCameraToMob({
            fit: { center: [0, 8, 0], radius: 12 }
        });
        updateProjectNameLabel();
        closeNewMobDialog();
        scheduleAutosave();
        setStatus(`🚀 ${name} luotu (${modelId}) — export: ${exportFileName(modelId, 'bedrock')}`);
    };

    document.getElementById('new-mob-create').addEventListener('click', create);
    document.getElementById('new-mob-cancel').addEventListener('click', closeNewMobDialog);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeNewMobDialog();
    });
    [nameInput, idInput].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); create(); }
            if (e.key === 'Escape') closeNewMobDialog();
        });
    });
}

// ==================== FILE I/O ====================
function setupFileIO() {
    document.getElementById('btn-new').addEventListener('click', () => {
        openNewMobDialog('empty');
    });

    document.getElementById('btn-save').addEventListener('click', () => {
        saveCurrentAnimation();
        const data = {
            version: 1,
            app: 'freebuff-mob-studio',
            model: state.model,
            projectName: state.projectName,
            textureDataURL: state.textureCanvas ? state.textureCanvas.toDataURL() : null,
            emissiveDataURL: state.emissiveDataURL,
            animation: state.animation ? {
                length: state.animation.length,
                tracks: state.animation.tracks
            } : null,
            projectAnimations: state.projectAnimations
        };
        downloadJson(data, `${state.model.modelId.replace('geometry.', '')}.mobstudio.json`);
        setStatus('Project saved');
    });

    document.getElementById('btn-open').addEventListener('click', () => {
        document.getElementById('file-input-save').click();
    });

    document.getElementById('file-input-save').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data && data.model) {
                    state.model = data.model;
                    state.projectName = data.projectName || state.model.modelId.replace('geometry.', '') || 'My Mob';
                    updateProjectNameLabel();
                    state.textureDataURL = data.textureDataURL || null;
                    state.emissiveTexture = null;
                    state.emissiveDataURL = data.emissiveDataURL || null;
                    if (state.animation && data.animation) {
                        state.animation.length = data.animation.length || 40;
                        state.animation.tracks = data.animation.tracks || {};
                        document.getElementById('anim-length').value = state.animation.length;
                        if (state.animation.redrawKeys) state.animation.redrawKeys();
                        if (state.uvEditor) state.uvEditor.draw();
                    }
                    applyTextureDataURL();
                    deselectAll();
                    rebuildModel();
                    scheduleAutosave();
                    setStatus(`Opened: ${file.name}`);
                } else {
                    alert('Not a valid Freebuff Mob Studio project file.');
                }
            } catch (err) {
                alert('Failed to open project: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Texture loading
    document.getElementById('btn-load-texture').addEventListener('click', () => {
        document.getElementById('file-input-texture').click();
    });

    document.getElementById('btn-remove-texture').addEventListener('click', () => {
        // Drop any loaded/painted texture; rebuild regenerates from cube colors
        state.texture = null;
        state.textureCanvas = null;
        state.textureDataURL = null;
        state.emissiveTexture = null;
        state.emissiveDataURL = null;
        rebuildModel();
        if (state.uvEditor) state.uvEditor.draw();
        scheduleAutosave();
        setStatus('Texture reset to cube colors');
    });

    document.getElementById('file-input-texture').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                state.textureDataURL = ev.target.result;
                applyTextureDataURL();
                scheduleAutosave();
                setStatus(`Texture loaded: ${file.name} (${img.width}x${img.height})`);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    // Blockbench (.bbmodel) import
    document.getElementById('btn-import-bbmodel').addEventListener('click', () => {
        document.getElementById('file-input-bbmodel').click();
    });

    document.getElementById('file-input-bbmodel').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target.result);
                const parsed = parseBBModel(json);
                if (!parsed.model.bones.length) throw new Error('No bones/elements found');
                state.history.push(state.model);
                state.model = parsed.model;
                state.texture = null;
                state.textureCanvas = null;
                state.textureDataURL = parsed.textureDataURL || null;
                if (state.animation && parsed.animation) {
                    state.animation.playing = false;
                    state.animation.time = 0;
                    state.animation.length = parsed.animation.length;
                    state.animation.tracks = parsed.animation.tracks;
                    const lenInput = document.getElementById('anim-length');
                    if (lenInput) lenInput.value = parsed.animation.length;
                    state.animation.syncSlider();
                    if (state.animation.redrawKeys) state.animation.redrawKeys();
                }
                deselectAll();
                applyTextureDataURL();
                rebuildModel();
                scheduleAutosave();
                setStatus(`Imported Blockbench model: ${file.name} (${parsed.model.bones.reduce((n, b) => n + b.cubes.length, 0)} cubes${parsed.animation ? ', animation included' : ''})`);
            } catch (err) {
                alert('Failed to import .bbmodel: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('btn-import-bedrock').addEventListener('click', () => {
        document.getElementById('file-input-bedrock').click();
    });

    document.getElementById('file-input-bedrock').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target.result);
                state.model = parseBedrockGeometry(json);
                deselectAll();
                rebuildModel();
                setStatus(`Imported: ${file.name}`);
            } catch (err) {
                alert('Failed to parse Bedrock geometry: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('btn-export-bedrock').addEventListener('click', () => {
        const json = exportBedrockGeometry(state.model);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_bedrock.json`);
        setStatus('Exported Bedrock geometry');
    });

    document.getElementById('btn-export-java').addEventListener('click', () => {
        const json = exportJavaModel(state.model);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_java.json`);
        setStatus('Exported Java Edition model');
    });

    document.getElementById('btn-export-anim-bedrock').addEventListener('click', () => {
        const animations = currentAnimations();
        if (!animations) { setStatus('No animations to export — add keyframes first'); return; }
        const json = exportBedrockAnimations(state.model, animations);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_animations.json`);
        setStatus('Exported animations (Bedrock .animation.json)');
    });

    document.getElementById('btn-export-anim-java').addEventListener('click', () => {
        const animations = currentAnimations();
        if (!animations) { setStatus('No animations to export — add keyframes first'); return; }
        const json = exportJavaAnimations(state.model, animations);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_geckolib.json`);
        setStatus('Exported animations (Java/GeckoLib .animation.json)');
    });
}

/**
 * Current animation set for export: library mob's multiple animations
 * (with the live editor track merged into the selected one), or the
 * single editor animation.
 */
function currentAnimations() {
    if (!state.projectAnimations || Object.keys(state.projectAnimations).length === 0) return null;
    // Merge live edits from the timeline into the selected animation
    saveCurrentAnimation();
    const out = JSON.parse(JSON.stringify(state.projectAnimations));
    // Poista tyhjät animaatiot exportista? Ei — viedään kaikki sellaisenaan.
    return out;
}

function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function makeTextureFromCanvas(c) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Per-face brightness so flat-filled cubes read as lit 3D shapes instead of
 * solid color blobs — top bright, bottom dark, sides in between (vanilla-
 * style fake lighting, like real mob textures have).
 */
const FACE_SHADE = { up: 1.22, down: 0.68, north: 0.94, south: 0.94, east: 1.0, west: 1.0 };

/** Normalize a color to '#rrggbb' (handles numbers from getBoneColor too). */
function toHex(color) {
    if (typeof color === 'number') return '#' + color.toString(16).padStart(6, '0');
    if (typeof color === 'string' && color.startsWith('#')) return color;
    return '#ffffff';
}

function shadeHex(hex, factor) {
    const n = parseInt(toHex(hex).slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
    const b = Math.min(255, Math.round((n & 255) * factor));
    return `rgb(${r},${g},${b})`;
}

/** Deterministic pseudo-random so the noise is stable across repaints. */
function seededRand(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Fill one cube's six face regions on a 2D texture context (shaded + dithered). */
function fillCubeFaces(tctx, cube, color) {
    const base = color || '#ffffff';
    const seed = (cube.name || 'cube').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) * 131
        + ((cube.uv && cube.uv.offset) ? cube.uv.offset[0] * 13 + cube.uv.offset[1] * 7 : 1);
    const rand = seededRand(seed);

    for (const r of computeFaceRects(cube)) {
        const shade = FACE_SHADE[r.face] || 1;
        tctx.fillStyle = shadeHex(base, shade);
        tctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
        // Kevyt rakeisuus: muutama sävytetty pikseli kasvoa kohti, jotta pinta
        // näyttää teksturoidulta eikä täysin tasaiselta värialueelta.
        if (r.w >= 3 && r.h >= 3) {
            const steps = Math.max(2, Math.round((r.w * r.h) / 8));
            for (let i = 0; i < steps; i++) {
                const px = Math.round(r.x + rand() * r.w);
                const py = Math.round(r.y + rand() * r.h);
                const k = (rand() - 0.45) * 0.22; // ±11 %
                tctx.fillStyle = shadeHex(base, Math.max(0.55, Math.min(1.45, shade + k)));
                tctx.fillRect(px, py, 1, 1);
            }
        }
    }
}

/**
 * Guarantees a texture exists. If none is present, generates one by
 * filling every cube's face regions with its color — so the model is
 * always colored and paintable, even without an uploaded image.
 */
function ensureTexture() {
    if (state.textureCanvas) return;
    const c = document.createElement('canvas');
    c.width = state.model.textureWidth;
    c.height = state.model.textureHeight;
    const tctx = c.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, c.width, c.height);
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            fillCubeFaces(tctx, cube, cube.color || getBoneColor(state.model.bones.indexOf(bone)));
        }
    }
    state.textureCanvas = c;
    state.texture = makeTextureFromCanvas(c);
}

function applyTextureDataURL() {
    if (!state.textureDataURL) {
        state.texture = null;
        state.textureCanvas = null;
        applyEmissiveTexture();
        if (state.uvEditor) state.uvEditor.draw();
        return;
    }
    const img = new Image();
    img.onload = () => {
        const c = document.createElement('canvas');
        c.width = state.model.textureWidth;
        c.height = state.model.textureHeight;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.textureCanvas = c;
        state.texture = makeTextureFromCanvas(c);
        rebuildModel();
        applyEmissiveTexture();
    };
    img.src = state.textureDataURL;
}

/**
 * Lataa mobin emissiivinen glow-tekstuuri (pelin oma glow-kerros) ja
 * asettaa sen emissiveMapiksi kaikkiin materiaaleihin. Pohjatekstuuri
 * pysyy puhtaana — hehku tulee tästä kerroksesta, kuten pelissä.
 */
function applyEmissiveTexture() {
    state.emissiveTexture = null;
    if (!state.emissiveDataURL) { rebuildModel(); return; }
    const img = new Image();
    img.onload = () => {
        const c = document.createElement('canvas');
        c.width = state.model.textureWidth;
        c.height = state.model.textureHeight;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.emissiveTexture = makeTextureFromCanvas(c);
        rebuildModel();
    };
    img.src = state.emissiveDataURL;
}

/** Re-apply box UVs to every existing mesh (used while dragging faces). */
function applyAllBoxUVs() {
    for (const mesh of state.cubes) {
        const cubeData = findCubeData(mesh.userData.cubeIndex);
        if (!cubeData) continue;
        applyBoxTextureUVs(mesh.geometry, cubeData, state.model.textureWidth, state.model.textureHeight);
    }
}

/**
 * Rakentaa yhden kuution meshin uudelleen koon muutoksen jälkeen
 * (UV-editorin 📏 resize) — geometria + positio päivittyvät, valinta ja
 * gizmo säilyvät. Mesh on keskipisteessä: positio = origin + koko/2 − pivot.
 */
function rebuildCubeMesh(cubeIndex) {
    const mesh = state.cubes[cubeIndex];
    const cubeData = findCubeData(cubeIndex);
    const bone = findBoneForCube(cubeIndex);
    if (!mesh || !cubeData || !bone) return;
    const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
    applyBoxTextureUVs(geo, cubeData, state.model.textureWidth, state.model.textureHeight);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.position.set(
        cubeData.origin[0] + cubeData.size[0] / 2 - bone.pivot[0],
        cubeData.origin[1] + cubeData.size[1] / 2 - bone.pivot[1],
        cubeData.origin[2] + cubeData.size[2] / 2 - bone.pivot[2]
    );
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
    // Delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName === 'INPUT') return;
        deleteSelected();
    }

    // Tool shortcuts
    if (document.activeElement.tagName === 'INPUT') return;

    if (e.key === 'g') {
        setTool('move');
    } else if (e.key === 'r') {
        setTool('rotate');
    } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        setTool('select');
    }

    // Ctrl+Z / Ctrl+Y — ensin maalausvedot (jos niitä on), sitten malli
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (undoPaint()) { setStatus('Undo maalaus'); return; }
        const prev = state.model;
        const restored = state.history.undo(prev);
        if (restored) {
            state.model = restored;
            deselectAll();
            rebuildModel();
            scheduleAutosave();
            setStatus('Undo');
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (redoPaint()) { setStatus('Redo maalaus'); return; }
        const prev = state.model;
        const restored = state.history.redo(prev);
        if (restored) {
            state.model = restored;
            deselectAll();
            rebuildModel();
            scheduleAutosave();
            setStatus('Redo');
        }
    }

    // Ctrl+D duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (state.selectedCube !== null) {
            state.history.push(state.model);
            const cubeData = findCubeData(state.selectedCube);
            const boneData = findBoneForCube(state.selectedCube);
            if (cubeData && boneData) {
                const newCube = JSON.parse(JSON.stringify(cubeData));
                newCube.name = cubeData.name + '_copy';
                newCube.origin[1] += 1;
                boneData.cubes.push(newCube);
                rebuildModel();
                scheduleAutosave();
                setStatus('Duplicated cube');
            }
        }
    }
});

// ==================== MOUSE TRACKING ====================
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    document.getElementById('mouse-coords').textContent = `X: ${Math.round(x)} Y: ${Math.round(y)}`;
});

// ==================== ANIMATION LOOP ====================
function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();
    if (renderer) renderer.render(scene, camera);
}

// ==================== UV EDITOR & ANIMATION ====================
function setupUVEditor() {
    state.uvEditor = initUVEditor(document.getElementById('uv-canvas'), state, {
        onSelectFace: (cubeIndex, face) => {
            if (cubeIndex === null) {
                deselectAll();
                return;
            }
            selectCube(state.cubes[cubeIndex]);
            state.selectedFace = face;
            setStatus(`Face: ${face}`);
        },
        onUVChange: () => {
            applyAllBoxUVs();
            scheduleAutosave();
        },
        onResize: (cubeIndex) => {
            rebuildCubeMesh(cubeIndex);
            const cubeData = findCubeData(cubeIndex);
            if (cubeData && state.selectedCube === cubeIndex) {
                showProperties(cubeData, findBoneForCube(cubeIndex));
                setStatus(`📏 ${cubeData.name}: ${cubeData.size[0]} × ${cubeData.size[1]} × ${cubeData.size[2]}`);
            }
            checkRenderConsistency();
            scheduleAutosave();
        },
        onPaint: () => {
            scheduleAutosave();
        },
        onPaintStart: () => {
            // 2D-maalauskin on undo-kelpoinen — tallenna tila ennen vetoa
            pushPaintHistory();
        }
    });

    document.querySelectorAll('.uv-tool').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.uv-tool').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.uvEditor.setTool(btn.dataset.uvtool);
        });
    });

    document.getElementById('uv-paint-color').addEventListener('input', (e) => {
        state.uvEditor.setPaintColor(e.target.value);
    });

    document.getElementById('uv-brush-size').addEventListener('input', (e) => {
        state.uvEditor.setBrushSize(parseInt(e.target.value));
    });

    window.addEventListener('resize', () => state.uvEditor.resize());
    setTimeout(() => state.uvEditor.resize(), 50);
}

// ==================== INIT ====================
updateProjectNameLabel();
setupToolbar();
setupPropertyInputs();
setupFileIO();
setupLibrary();
setupUVEditor();
const anim = initAnimation(state, {
    onMessage: setStatus,
    onAnimationChange: () => scheduleAutosave()
});
if (state.savedAnimation) {
    anim.length = state.savedAnimation.length || 40;
    anim.tracks = state.savedAnimation.tracks || {};
    document.getElementById('anim-length').value = anim.length;
    anim.syncSlider();
    if (anim.redrawKeys) anim.redrawKeys();
}
// Autosave-palautus: ensin projektin omat animaatiot (jos tallennettu),
// muuten kirjaston mobin animaatiot (modelId täsmää).
const restoredMob = LIBRARY_MOBS.find(m => m.model && m.model.modelId === state.model.modelId);
if (state.savedProjectAnimations && Object.keys(state.savedProjectAnimations).length > 0) {
    state.projectAnimations = JSON.parse(JSON.stringify(state.savedProjectAnimations));
    const names = Object.keys(state.projectAnimations);
    state.currentAnimName = state.savedCurrentAnimName && state.projectAnimations[state.savedCurrentAnimName]
        ? state.savedCurrentAnimName : names[0];
    refreshAnimationSelect();
    if (state.animation) loadAnimationData(state.projectAnimations[state.currentAnimName]);
    if (restoredMob) fitCameraToMob(restoredMob);
} else if (restoredMob) {
    loadLibraryMobAnimations(restoredMob);
    fitCameraToMob(restoredMob);
}
// Palauta emissiivinen glow autosavesta (ennen tekstuurin latausta,
// jotta applyTextureDataURL → applyEmissiveTexture saa sen käyttöönsä).
// HUOM: vain jos autosave todella ladattiin — muuten oletusmobin
// emissiivi (yllä) säilyy.
if (saved && saved.model && state.savedEmissiveDataURL) {
    state.emissiveDataURL = state.savedEmissiveDataURL;
}
if (state.textureDataURL) applyTextureDataURL();
rebuildModel();
animate();

if (!state.webgl) {
    // No WebGL: 3D viewport stays dark but everything else works.
    canvas.style.background = '#161b22';
    setStatus('Editori toimii ilman 3D-näkymää (WebGL pois) — avaa se Chromessa, jossa WebGL on päällä');
} else {
    setStatus('Freebuff Mob Studio ready — Add cubes and bones to start building');
}
window.__MOB_STUDIO = state;  // dev/debug handle
window.__MOB_STUDIO.renderer = renderer;
window.__MOB_STUDIO.checkRenderConsistency = checkRenderConsistency;
console.log('🧊 Freebuff Mob Studio initialized' + (state.webgl ? '' : ' (no WebGL — 3D viewport disabled)'));
