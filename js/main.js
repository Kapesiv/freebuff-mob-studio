import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { parseBedrockGeometry, exportBedrockGeometry, createEmptyModel } from './formats/bedrock.js';
import { exportJavaModel } from './formats/java.js';
import { exportBedrockAnimations, exportJavaAnimations } from './formats/animation.js';
import { createExampleMob } from './formats/example.js';
import { History } from './utils/history.js';
import { applyBoxTextureUVs, computeFaceRects } from './utils/boxuv.js';
import { PALETTE_CATEGORIES, loadCustomColors, saveCustomColors, normalizeHex, defaultColorName } from './utils/palette.js';
import { zipFiles } from './utils/zip.js';
import { buildResourcePack, previewPackFiles } from './utils/pack-export.js';
import { renderPackIcon } from './utils/pack-icon.js';
import { generateAutoAnimations as generateAutoAnimationsForModel } from './utils/auto-anim.js';
import { initUVEditor } from './uv-editor.js';
import { initAnimation } from './animation.js';
import { LIBRARY_MOBS, prepareMob, mobHeightBlocks } from './mobs/library.js';
import { MOB_STATS } from './mobs/stats.js';
import { voxelizeModel } from './voxelizer.js';
import { MOB_TEMPLATES } from './mobs/templates.js';
import { MOB_PARTS, PART_CATEGORIES } from './mobs/parts.js';
import { parseBBModel, exportBBModel } from './formats/bbmodel.js';

// v5: hylkää vanhat autosavet (v4:stä puuttuu emissiivinen glow-tekstuuri,
// joten modimobien hehku ei säilyisi) — oletuksena ladataan oikea
// Deep Void -mobi (Stalker) kirjastosta.
const AUTOSAVE_KEY = 'freebuff_mobstudio_project_v5';
// ?mob= deeplink (galleriasta): jokainen mobi saa OMAN autosave-avaimensa,
// jotta kaksi mobia voi avata vierekkäin kahdessa välilehdessä vertailua
// varten — tabit eivät sotke toistensa tallennuksia eivätkä tavallista
// projektia (joka käyttää AUTOSAVE_KEY:ta).
const URL_MOB_ID = new URLSearchParams(location.search).get('mob');
const AUTOSAVE_KEY_ACTIVE = URL_MOB_ID ? `${AUTOSAVE_KEY}_deeplink_${URL_MOB_ID}` : AUTOSAVE_KEY;
const DEFAULT_PACK_OPTIONS = { behavior: 'neutral', health: 20, damage: 4, speed: 0.25, jump: 1, flying: false };

// ==================== STATE ====================
const state = {
    model: createEmptyModel(),
    projectName: 'My Mob',
    selectedBone: null,
    selectedCube: null,
    selectedCubes: [],         // monivalinta: globaalit kuutioindeksit (shift+klikkaa)
    selectedFace: null,
    selectedPart: null,        // Spore-osa (luuryhmä) valittuna — koko osan muokkaus
    partRootGroup: null,       // osan juuriluun THREE.Group (gizmo kohde)
    partFineTune: false,       // kuutiotila: klikkaukset valitsevat yksittäisiä kuutioita
    boneMode: false,           // B-näppäin: klikkaus valitsee luun kuution sijaan (poseerausta varten)
    tool: 'select',
    bones: [],       // THREE.Group per bone
    cubes: [],       // THREE.Mesh per cube
    locatorMeshes: [], // THREE.Mesh per locator (kiinnityspisteen merkit)
    texture: null,       // THREE.Texture (nullable)
    textureCanvas: null, // 2D canvas — source of truth for painting
    textureDataURL: null,
    emissiveDataURL: null,    // mobin emissiivinen glow-tekstuuri (dataURL)
    emissiveTexture: null,    // THREE.Texture emissiveMap-kerrokselle
    history: new History(),
    animation: null,
    uvEditor: null,
    projectAnimations: {},     // name -> { length, tracks, posTracks } (editoitavat)
    currentAnimName: null,
    mirrorPaint: false,        // maalaa myös peilikuva vastakkaiselle puolelle
    symmetryEdit: false,       // symmetria-editointi: muokkaa toista puolta, toinen peilautuu livenä
    gamePreview: false,        // pelin näköinen esikatselu (Minecraft-valaistus + varjot)
    gamePreviewDefault: true,  // kytke Game Preview automaattisesti mobin latauksen jälkeen
    gamePreviewNight: false,   // yötila: tumma taivas, kuunvalo, glow-boost
    savedPreviewOptions: null, // projektin/autosaven preview-asetukset palautettavaksi
    _editorClearColor: 0x343a46, // editorin taustaväri talteen Game Preview -tilaa varten
    packOptions: { ...DEFAULT_PACK_OPTIONS }, // 📦 Pack -dialogin valinnat
    modelVersion: 0,
    sourceCategory: 'voxel' // mistä nykyinen malli on peräisin (size-laskentaan 'Omat olennot' -tallennuksessa)
};

// Load autosaved project or fall back to the example mob
const saved = (() => {
    try {
        return JSON.parse(localStorage.getItem(AUTOSAVE_KEY_ACTIVE) || 'null');
    } catch { return null; }
})();
if (saved && saved.model && saved.model.bones) {
    state.model = saved.model;
    // Korruptoitunut autosave (esim. ilman modelId:tä) ei saa kaataa bootia
    state.projectName = saved.projectName || (state.model.modelId ? state.model.modelId.replace('geometry.', '') : 'My Mob');
    state.textureDataURL = saved.textureDataURL || null;
    state.savedEmissiveDataURL = saved.emissiveDataURL || null;
    state.savedAnimation = saved.animation || null;
    state.savedProjectAnimations = saved.projectAnimations || null;
    state.savedCurrentAnimName = saved.currentAnimName || null;
    state.packOptions = saved.packOptions || { ...DEFAULT_PACK_OPTIONS };
    state.savedPreviewOptions = saved.previewOptions || null;
    state.sourceCategory = saved.sourceCategory || 'voxel';
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
        state.sourceCategory = defaultMob.category;
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // pehmeät, Minecraft-tyyliset varjot
} catch (e) {
    console.warn('WebGL unavailable — running without the 3D viewport:', e.message);
}
state.webgl = !!renderer;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(20, 15, 20);

// ---- Valaistus (editori + pelin näköinen esikatselu) -----------------
// Editorin valot: tasainen, jotta mustat mobit näkyvät.
const ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
// Shadow-kamera säädetään mallin koon mukaan (updateShadowBounds) —
// oletukset riittävät keskikokoisille mobeille.
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 200;
dirLight.shadow.camera.left = -40;
dirLight.shadow.camera.right = 40;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);
scene.add(dirLight.target);
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

// ---- Pelin näköinen esikatselu (Game Preview) --------------------------
// Minecraftin valaistus: sininen taivas + lämmin aurinko (hemisphere) ja
// pehmeä varjo maatasolla. Editorivalot himmenevät, jotta pelin tunnelma
// välittyy; glow-kerros hehkuu valaistuksesta riippumatta (emissive).
const skyColor = 0x9dc9ff;   // Minecraft-taivas
const groundColor = 0x6b7f4e; // ruoho/maa
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, 0.0);
scene.add(hemisphereLight);

// Maataso johon varjot osuvat — Minecraftin ruohovärinen.
const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({
        color: 0x6b7f4e,
        roughness: 1.0,
        metalness: 0.0
    })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = 0;
groundPlane.receiveShadow = true;
groundPlane.visible = false; // näytetään vain Game Preview -tilassa
scene.add(groundPlane);

const EDITOR_LIGHTS = {
    ambient: 0.68, dir: 0.95, fill: 1.0, rim: 0.35, boost: 0.2, hemi: 0.0
};
const GAME_LIGHTS = {
    ambient: 0.18, dir: 1.35, fill: 0.15, rim: 0.05, boost: 0.0, hemi: 0.85
};
// Yö: kuunvalo kylmän sinertävä, glow loistaa — tumma taivas.
const NIGHT_SKY = 0x0b1220;
const NIGHT_GROUND = 0x16202e;
const NIGHT_LIGHTS = {
    ambient: 0.05, dir: 0.4, fill: 0.05, rim: 0.04, boost: 0.0, hemi: 0.25
};
const NIGHT_GLOW_BOOST = 2.2;   // emissiivinen kerroin yöllä
const DAY_GLOW_INTENSITY = 1.0; // emissiivinen päivällä/editorissa

/** Palauta emissiiviset intensiteetit päivän/editorin arvoihin. */
function resetGlowIntensities() {
    for (const mesh of state.cubes) {
        if (mesh.material && mesh.material.emissiveMap) {
            mesh.material.emissiveIntensity = DAY_GLOW_INTENSITY;
        }
    }
}

/** Nosta emissiiviset intensiteetit yön glow-boostiin. */
function boostGlowIntensities() {
    for (const mesh of state.cubes) {
        if (mesh.material && mesh.material.emissiveMap) {
            mesh.material.emissiveIntensity = NIGHT_GLOW_BOOST;
        }
    }
}

/** Päivitä shadow-kameran ja maatason koko mallin bounding-boxin mukaan. */
function updateShadowBounds() {
    if (!dirLight) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const bone of state.model.bones) {
        for (const c of bone.cubes) {
            const o = c.origin, s = c.size;
            minX = Math.min(minX, o[0]); maxX = Math.max(maxX, o[0] + s[0]);
            minY = Math.min(minY, o[1]); maxY = Math.max(maxY, o[1] + s[1]);
            minZ = Math.min(minZ, o[2]); maxZ = Math.max(maxZ, o[2] + s[2]);
        }
    }
    if (!isFinite(minX)) return;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 8) / 2 + 6; // marginaali
    dirLight.target.position.set(cx, 0, cz);
    dirLight.position.set(cx + 20, 40, cz + 20);
    const cam = dirLight.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.updateProjectionMatrix();
    groundPlane.position.x = cx;
    groundPlane.position.z = cz;
    groundPlane.geometry.dispose();
    groundPlane.geometry = new THREE.PlaneGeometry(span * 6, span * 6);
    groundPlane.geometry.rotateX(-Math.PI / 2);
    groundPlane.rotation.x = 0;
}

/** Aseta päivä/yö-valaistus (Game Preview -tilassa). */
function applyGamePreviewLights() {
    const night = state.gamePreview && state.gamePreviewNight;
    const L = !state.gamePreview ? EDITOR_LIGHTS : night ? NIGHT_LIGHTS : GAME_LIGHTS;
    ambientLight.intensity = L.ambient;
    dirLight.intensity = L.dir;
    dirLight.color.setHex(night ? 0xaac4ff : 0xffffff); // kuu vs. aurinko
    fillLight.intensity = L.fill;
    rimLight.intensity = L.rim;
    ambientBoost.intensity = L.boost;
    hemisphereLight.intensity = L.hemi;
    hemisphereLight.color.setHex(night ? NIGHT_SKY : skyColor);
    hemisphereLight.groundColor.setHex(night ? NIGHT_GROUND : groundColor);
    if (renderer) {
        if (state.gamePreview) {
            renderer.setClearColor(night ? NIGHT_SKY : skyColor);
        } else {
            renderer.setClearColor(state._editorClearColor);
        }
    }
    // Glow: yöllä loistaa voimakkaammin, muuten normaali
    if (night) boostGlowIntensities();
    else resetGlowIntensities();
}

/** Aseta pelin näköinen esikatselu päälle/pois. */
function setGamePreview(on) {
    state.gamePreview = on;
    if (on) {
        // Pelin näköinen taivas — säilytetään käyttäjän bg-väri talteen
        // (ilman WebGL:ää rendereriä ei ole — editorin oletus jää voimaan)
        if (renderer) state._editorClearColor = renderer.getClearColor(new THREE.Color()).getHex();
        // Varjot päälle pelinäkymässä
        for (const mesh of state.cubes) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        }
    } else {
        for (const mesh of state.cubes) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
        }
    }
    groundPlane.visible = on;
    gridHelper.visible = on ? false : document.getElementById('chk-grid').checked;
    axesHelper.visible = !on;
    applyGamePreviewLights();
}

/** Aseta yötila päälle/pois (vaatii Game Previewin). */
function setGamePreviewNight(on) {
    state.gamePreviewNight = on;
    applyGamePreviewLights();
}

/** Kerää nykyiset preview-asetukset projektitiedostoon/autosaveen. */
function getPreviewOptions() {
    const bgInput = document.getElementById('bg-color');
    return {
        gamePreviewDefault: !!state.gamePreviewDefault,
        gamePreviewNight: !!state.gamePreviewNight,
        bgColor: bgInput ? bgInput.value : null
    };
}

/**
 * Palauta preview-asetukset projektista/autosavesta: päivä/yö, taustaväri
 * ja Game Preview -oletus. Kutsutaan mobin latauksen jälkeen.
 */
function applyPreviewOptions(opts) {
    if (!opts) return;
    const bgInput = document.getElementById('bg-color');
    if (bgInput && opts.bgColor) {
        bgInput.value = opts.bgColor;
        state._editorClearColor = parseInt(opts.bgColor.replace('#', ''), 16);
        if (renderer && !state.gamePreview) renderer.setClearColor(bgInput.value);
    }
    state.gamePreviewDefault = opts.gamePreviewDefault !== false;
    state.gamePreviewNight = !!opts.gamePreviewNight;
    const nightChk = document.getElementById('chk-game-night');
    if (nightChk) nightChk.checked = state.gamePreviewNight;
    if (state.gamePreviewDefault) {
        applyGamePreviewDefault();
        if (state.gamePreviewNight) {
            setGamePreviewNight(true);
            setStatus('Night-tila päällä — kuunvalo, hehku loistaa kirkkaammin');
        }
    } else {
        const chk = document.getElementById('chk-game-preview');
        if (chk) chk.checked = false;
        setGamePreview(false);
    }
}

/**
 * Kytke Game Preview automaattisesti päälle mobin latauksen jälkeen
 * (oletus päällä, kunnes käyttäjä sammuttaa sen). Synkronoi checkboxin
 * ja shadow-kameran mallin koon mukaan.
 */
function applyGamePreviewDefault() {
    if (!state.gamePreviewDefault) return;
    const chk = document.getElementById('chk-game-preview');
    if (chk && !chk.checked) chk.checked = true;
    setGamePreview(true);
    updateShadowBounds();
}

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
state.buildResourcePack = buildResourcePack;
state.zipFiles = zipFiles;

// Monivalinta-gizmo: raahauksen alussa otetaan tilannekuva kaikista valituista
// kuutioista, jotta siirto/kierto/skaalaus kohdistuu kaikkiin, ei vain
// ensimmäiseen (johon gizmo on kiinnitetty).
let multiDrag = null;

transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
    state._dragActive = event.value;
    if (event.value) {
        // Raahaus alkaa: tilannekuva monivalinnasta
        multiDrag = null;
        const obj = transformControls.object;
        if (obj && state.cubes.includes(obj) && state.selectedCubes && state.selectedCubes.length > 1) {
            const focusIdx = state.cubes.indexOf(obj);
            const others = [];
            for (const ci of state.selectedCubes) {
                if (ci === focusIdx) continue;
                const m = state.cubes[ci];
                if (!m) continue;
                others.push({
                    idx: ci,
                    mesh: m,
                    group: m.parent,
                    startWorld: m.getWorldPosition(new THREE.Vector3()),
                    cubeData: findCubeData(ci),
                    boneData: findBoneForCube(ci)
                });
            }
            if (others.length) {
                multiDrag = {
                    mode: transformControls.getMode(),
                    focusMesh: obj,
                    pivot: obj.getWorldPosition(new THREE.Vector3()),
                    startFocusWorld: obj.getWorldPosition(new THREE.Vector3()),
                    startFocusQuat: obj.getWorldQuaternion(new THREE.Quaternion()),
                    others
                };
            }
        }
    }
    // Raahauksen lopussa varmistetaan, että render ja data ovat yhtä —
    // kesken raahauksen ei tarkisteta (data päivittyy joka tapahtumassa,
    // ja toistuva tarkistus hidastaisi suuria malleja).
    if (!event.value) {
        multiDrag = null;
        // Spore-osa: gizmon skaalaus/siirto poltetaan dataan raahauksen lopussa
        if (state.selectedPart && state.partRootGroup) bakePartFromGroup(state.partRootGroup);
        checkRenderConsistency();
    }
});

transformControls.addEventListener('objectChange', () => {
    if (!transformControls.object) return;
    const obj = transformControls.object;
    if (state.bones.includes(obj)) {
        // Spore-osa: gizmo-työkalut käsitellään osakohtaisesti — kierto
        // kirjoitetaan dataan lennossa (kuten tavallinen luu), skaalaus ja
        // siirto poltetaan dataan raahauksen lopussa (bakePartFromGroup).
        if (state.selectedPart && obj === state.partRootGroup) {
            handlePartGizmo(obj);
        } else {
            updateBoneFromObject(obj);
        }
        // Asentotila: luun raahaaminen tallentaa asennon keyframeksi automaattisesti
        if (state.animation && state.animation.poseMode && state.animation.addKeyframe) {
            state.animation.addKeyframe(true);
        }
    } else {
        updatePropertiesFromObject(obj);
        // Monivalinta: sovella sama muutos myös muihin valittuihin kuutioihin
        applyMultiTransform(obj);
    }
    // Symmetria-editointi: peilaa muokkaus vastakkaiselle puolelle livenä
    if (state.symmetryEdit && !state.selectedPart) applySymmetryEdit();
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
    if (state.tool === 'paint' || state.tool === 'pipette' || state.tool === 'face') return; // ei valitse osia

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
        if (state.boneMode) {
            // B-tila (luutila): klikkaus valitsee kuution luun, jotta sitä voi
            // poseerata suoraan 3D:ssä (sama kuin poseMode mutta aina päällä).
            const idx = state.cubes.indexOf(mesh);
            const boneData = findBoneForCube(idx);
            if (boneData) {
                const bi = state.model.bones.indexOf(boneData);
                deselectAll();
                selectBone(bi);
                return;
            }
            setStatus('Tällä kuutiolla ei ole luuta — valitse toinen');
            return;
        }
        selectCube(mesh, event.shiftKey);
    } else if (!event.shiftKey) {
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
        [/^(.+)L$/, '$1R'],
        // camelCase-parit: rightArm_0 ↔ leftArm_0, LeftLeg ↔ RightLeg
        [/^right/i, 'left'],
        [/^left/i, 'right']
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

// ---- symmetria-editointi -------------------------------------------
// Kun symmetryEdit on päällä, valitun kuution/luun muokkaus (siirto/kierto/
// koko) peilataan automaattisesti vastakkaiselle puolelle livenä: jokaisessa
// objectChange-tapahtumassa haetaan nimen perusteella peilikuutio/-luu ja
// asetetaan sille peilattu transformi suoraan dataan + THREE-objektiin
// (ilman koko mallin rebuildia).
const SYM_MIRROR_MATRIX = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** Peilaa rotaation x-tason yli (oikea ↔ vasen) — sama matriisitapa kuin Mirror Pose. */
function mirrorRotationDeg(rot) {
    const e = new THREE.Euler(
        THREE.MathUtils.degToRad(rot[0] || 0),
        THREE.MathUtils.degToRad(rot[1] || 0),
        THREE.MathUtils.degToRad(rot[2] || 0),
        'XYZ'
    );
    const m = new THREE.Matrix4().makeRotationFromEuler(e);
    const mirrored = new THREE.Matrix4().multiplyMatrices(SYM_MIRROR_MATRIX, m).multiply(SYM_MIRROR_MATRIX);
    const eu = new THREE.Euler().setFromRotationMatrix(mirrored, 'XYZ');
    return [
        Math.round(THREE.MathUtils.radToDeg(eu.x)),
        Math.round(THREE.MathUtils.radToDeg(eu.y)),
        Math.round(THREE.MathUtils.radToDeg(eu.z))
    ];
}

/** Päivitä yhden kuution mesh dataan (koko/positio/rotaatio) ilman rebuildia. */
function updateCubeMeshInPlace(ci) {
    const mesh = state.cubes[ci];
    const cubeData = findCubeData(ci);
    const boneData = findBoneForCube(ci);
    if (!mesh || !cubeData || !boneData) return;
    const g = mesh.geometry;
    const sz = g && g.parameters ? [g.parameters.width, g.parameters.height, g.parameters.depth] : null;
    if (!sz || Math.abs(sz[0] - cubeData.size[0]) > 1e-4 || Math.abs(sz[1] - cubeData.size[1]) > 1e-4 || Math.abs(sz[2] - cubeData.size[2]) > 1e-4) {
        const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
        applyBoxTextureUVs(geo, cubeData, state.model.textureWidth, state.model.textureHeight);
        mesh.geometry.dispose();
        mesh.geometry = geo;
    }
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
}

/** Blockbench-tyylinen liikutus (nudge): siirrä valittua kuutiota (tai kuutioita)
 *  pikanäppäimillä. ←/→ = X, ↑/↓ = Z (malli katsoo −Z:tä), Ctrl+↑/Ctrl+↓ =
 *  Y (ylös/alas). Shift suurentaa askeleen (4×). Päivittää datan ja meshit
 *  pinnallisesti ilman täyttä rebuildia, ja tallentaa historyn (undo toimii). */
function nudgeSelected(dx, dy, dz, step) {
    const idxs = (state.selectedCubes && state.selectedCubes.length)
        ? state.selectedCubes
        : (state.selectedCube !== null ? [state.selectedCube] : []);
    if (!idxs.length) return false;
    state.history.push(state.model);
    for (const ci of idxs) {
        const cd = findCubeData(ci);
        if (!cd) continue;
        cd.origin[0] += (dx || 0) * step;
        cd.origin[1] += (dy || 0) * step;
        cd.origin[2] += (dz || 0) * step;
        updateCubeMeshInPlace(ci);
    }
    scheduleAutosave();
    const what = idxs.length > 1 ? `${idxs.length} cubes` : findCubeData(idxs[0]) && findCubeData(idxs[0]).name;
    setStatus(`Siirretty ${what} (${(dx || 0) * step}, ${(dy || 0) * step}, ${(dz || 0) * step})`);
    return true;
}

/** Päivitä yhden luun ryhmä + sen kuutiot dataan ilman rebuildia. */
function updateBoneGroupInPlace(bi) {
    const boneData = state.model.bones[bi];
    const group = state.bones[bi];
    if (!boneData || !group) return;
    const parentIdx = boneData.parent ? state.model.bones.findIndex(b => b.name === boneData.parent) : -1;
    const base = boneData.pivot.slice();
    if (parentIdx >= 0 && state.bones[parentIdx]) {
        const pp = state.model.bones[parentIdx].pivot;
        base[0] -= pp[0]; base[1] -= pp[1]; base[2] -= pp[2];
    }
    group.userData.basePosition = base;
    group.position.set(base[0], base[1], base[2]);
    group.rotation.order = 'ZYX';
    group.rotation.set(
        THREE.MathUtils.degToRad(boneData.rotation[0]),
        THREE.MathUtils.degToRad(boneData.rotation[1]),
        THREE.MathUtils.degToRad(boneData.rotation[2])
    );
    for (let ci = 0; ci < state.cubes.length; ci++) {
        if (state.cubes[ci].userData.boneIndex === bi) updateCubeMeshInPlace(ci);
    }
}

/** Peilaa valitun kuution transformin sen peilikuutiolle. */
function mirrorCubeTransform(ci) {
    const map = getCubeMirrorMap();
    const mi = map[ci];
    if (mi === null || mi === undefined || mi === ci) return;
    const src = findCubeData(ci);
    const dst = findCubeData(mi);
    if (!src || !dst) return;
    dst.size = src.size.slice();
    dst.origin = [-(src.origin[0] + src.size[0]), src.origin[1], src.origin[2]];
    dst.rotation = mirrorRotationDeg(src.rotation);
    updateCubeMeshInPlace(mi);
    if (state.uvEditor) state.uvEditor.draw();
}

/** Peilaa valitun luun transformin (pivot + rotaatio + kuutiot) peililuulle. */
function mirrorBoneTransform(bi) {
    const src = state.model.bones[bi];
    if (!src) return;
    const mName = mirrorCubeName(src.name);
    if (!mName) return;
    const mi = state.model.bones.findIndex(b => b.name === mName);
    if (mi === -1 || mi === bi) return;
    const dst = state.model.bones[mi];
    dst.pivot = [-src.pivot[0], src.pivot[1], src.pivot[2]];
    dst.rotation = mirrorRotationDeg(src.rotation);
    for (let i = 0; i < Math.min(src.cubes.length, dst.cubes.length); i++) {
        const s = src.cubes[i];
        const d = dst.cubes[i];
        d.origin = [-(s.origin[0] + s.size[0]), s.origin[1], s.origin[2]];
        d.size = s.size.slice();
        d.rotation = mirrorRotationDeg(s.rotation);
    }
    updateBoneGroupInPlace(mi);
    // Asentotila: kirjaa myös peililuun keyframe (peilattu rotaatio)
    if (state.animation && state.animation.poseMode && state.animation.tracks) {
        const frame = Math.round(state.animation.time);
        state.animation.tracks[mName] = state.animation.tracks[mName] || {};
        state.animation.tracks[mName][frame] = dst.rotation.slice();
        if (state.animation.redrawKeys) state.animation.redrawKeys();
    }
    if (state.uvEditor) state.uvEditor.draw();
}

/** objectChange-kuuntelijan kutsu: peilaa muokkaus vastakkaiselle puolelle. */
function applySymmetryEdit() {
    if (!state.symmetryEdit) return;
    if (state.selectedCube !== null) {
        mirrorCubeTransform(state.selectedCube);
    } else if (state.selectedBone !== null) {
        mirrorBoneTransform(state.selectedBone);
    }
}

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

// ==================== RESHAPE (Spore-tyylinen vartalon muokkaus) ==========
// Vedä muokataksesi koko olentoa: ylös/alas = korkeus (jalat pysyvät
// maassa), vasen/oikea = leveys, Shift + veto = pituus — tai tartu
// näkyvään kahvaan (ylä = korkeus, kylki = leveys, taka = pituus).
// Skaalaus tapahtuu koko mallille (luut + kuutiot), joten osat pysyvät
// kiinni pinnoissa. Kahvojen veto näyttää live-koot blokkeina.
const RESHAPE_HANDLE_COLORS = { x: '#f44336', y: '#4caf50', z: '#2196f3', center: '#ffeb3b' };
let reshapeActive = false;
let reshapeStart = null;      // kopio vedon alusta (undo + palautus)
let reshapeLastXY = null;
let reshapeAxis = null;       // 'x' | 'y' | 'z' | 'center' | null
let reshapeHandleGroup = null;
let reshapeTranslateOrigin = null; // [x, y, z] keskipisteen alkupositio

function scaleModelAxis(axis, factor, pivot) {
    for (const bone of state.model.bones) {
        bone.pivot[axis] = pivot + (bone.pivot[axis] - pivot) * factor;
        for (const c of bone.cubes) {
            const cy = c.origin[axis] + c.size[axis] / 2;
            c.size[axis] *= factor;
            c.origin[axis] = pivot + (cy - pivot) * factor - c.size[axis] / 2;
            // uvSize on kuution tekstuurisaarekkeen pikselikoko (Deep Void -mobeilla
            // = size × 10). Kun reshape venyttää kokoa, uvSize on skaalattava samalla
            // kertoimella että tekstuurin pikselitiheys pysyy (computeFaceRects käyttää
            // cube.uvSize || cube.size): muuten rectit jäävät vanhoiksi ja tekstuuri
            // venyy mallia muokatessa. Pyöristys desimaaliin kuten gizmo-skaalauksessa.
            if (c.uvSize) {
                c.uvSize[axis] = Math.round(Math.max(1, c.uvSize[axis] * factor) * 10) / 10;
            }
        }
    }
}

function reshapeBlockSize() {
    const bb = modelBBox();
    return [
        (bb.mx[0] - bb.mn[0]) / 16,
        (bb.mx[1] - bb.mn[1]) / 16,
        (bb.mx[2] - bb.mn[2]) / 16
    ];
}

let reshapeReadoutTimer = null;
function reshapeSetReadout(text) {
    const el = document.getElementById('reshape-readout');
    const span = document.getElementById('reshape-readout-text');
    if (!el || !span) return;
    if (reshapeReadoutTimer) { clearTimeout(reshapeReadoutTimer); reshapeReadoutTimer = null; }
    span.textContent = text;
    el.hidden = !text;
}

/** Luo kahvaryhmän (kerran): kolme tartuttavaa kahvaa mallin reunojen ulkopuolelle. */
function ensureReshapeHandles() {
    if (reshapeHandleGroup) return reshapeHandleGroup;
    const group = new THREE.Group();
    group.name = 'reshapeHandles';
    group.renderOrder = 999;
    for (const axis of ['y', 'x', 'z']) {
        const color = RESHAPE_HANDLE_COLORS[axis];
        const g = new THREE.Group();
        g.userData.axis = axis;
        // Varsi mallin reunasta kahvaan + tartuttava oktaedri päässä
        const stem = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, 0.4),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 })
        );
        stem.userData.axis = axis;
        stem.userData.baseEmissive = 0.7;
        const grip = new THREE.Mesh(
            new THREE.OctahedronGeometry(1, 0),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 })
        );
        grip.userData.axis = axis;
        grip.userData.baseEmissive = 0.9;
        g.add(stem, grip);
        g.userData.baseScale = null; // asetetaan updateReshapeHandles:ssa
        group.add(g);
    }
    // Keskipiste-kahva (keltainen kuutio) — vedä liikuttaa koko olentoa
    const centerG = new THREE.Group();
    centerG.userData.axis = 'center';
    const centerMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: RESHAPE_HANDLE_COLORS.center, emissive: RESHAPE_HANDLE_COLORS.center, emissiveIntensity: 0.8, roughness: 0.3, transparent: true, opacity: 0.85 })
    );
    centerMesh.userData.axis = 'center';
    centerMesh.userData.baseEmissive = 0.8;
    centerG.add(centerMesh);
    centerG.userData.baseScale = null; // asetetaan updateReshapeHandles:ssa
    group.add(centerG);
    reshapeHandleGroup = group;
    return group;
}

/** Aseta kahvat mallin bbox-reunoille (kutsutaan aina kun malli muuttuu). */
function updateReshapeHandles() {
    const group = ensureReshapeHandles();
    if (!scene.children.includes(group)) return;
    const bb = modelBBox();
    const cx = (bb.mn[0] + bb.mx[0]) / 2;
    const cy = (bb.mn[1] + bb.mx[1]) / 2;
    const cz = (bb.mn[2] + bb.mx[2]) / 2;
    const diag = Math.sqrt(
        (bb.mx[0] - bb.mn[0]) ** 2 + (bb.mx[1] - bb.mn[1]) ** 2 + (bb.mx[2] - bb.mn[2]) ** 2
    ) || 1;
    const hs = Math.max(1.2, Math.min(7, diag * 0.045)); // kahvan koko mallin mukaan
    const off = hs * 1.9;                                 // etäisyys pinnasta
    const h = (axis) => group.children.find(c => c.userData.axis === axis);
    // Y (korkeus): ylhäällä keskellä
    const hy = h('y');
    hy.position.set(cx, bb.mx[1] + off, cz);
    hy.scale.setScalar(hs);
    hy.userData.baseScale = hs;
    hy.children[0].scale.set(0.35, 1.6, 0.35); // varsi
    // X (leveys): oikealla kyljellä
    const hx = h('x');
    hx.position.set(bb.mx[0] + off, cy, cz);
    hx.scale.setScalar(hs);
    hx.userData.baseScale = hs;
    hx.children[0].scale.set(1.6, 0.35, 0.35); // varsi
    // Z (pituus): takana keskellä
    const hz = h('z');
    hz.position.set(cx, cy, bb.mx[2] + off);
    hz.scale.setScalar(hs);
    hz.userData.baseScale = hs;
    hz.children[0].scale.set(0.35, 0.35, 1.6); // varsi
    // Center (siirto): mallin keskellä
    const hc = h('center');
    if (hc) {
        hc.position.set(cx, cy, cz);
        const cs = Math.max(0.8, Math.min(3, diag * 0.02));
        hc.scale.setScalar(cs);
        hc.userData.baseScale = cs;
    }
}

function showReshapeHandles(on) {
    const group = ensureReshapeHandles();
    if (on) {
        if (!scene.children.includes(group)) scene.add(group);
        updateReshapeHandles();
    } else if (scene.children.includes(group)) {
        scene.remove(group);
    }
    if (!on) reshapeSetReadout(null);
    reshapeSetHover(null);
}

let reshapeHoverAxis = null;   // 'x' | 'y' | 'z' | 'center' | null

/** Hover-korostus: pienennä ja kirkasta kahvaa, vaihda kursori. */
function reshapeSetHover(axis) {
    const group = reshapeHandleGroup;
    // Nollaa edellinen korostus
    if (reshapeHoverAxis && reshapeHoverAxis !== axis && group) {
        const prev = group.children.find(c => c.userData.axis === reshapeHoverAxis);
        if (prev) {
            const bs = prev.userData.baseScale;
            if (bs) prev.scale.setScalar(bs);
            prev.traverse(o => {
                if (o.userData && o.userData.baseEmissive != null && o.material) {
                    o.material.emissiveIntensity = o.userData.baseEmissive;
                }
            });
        }
    }
    reshapeHoverAxis = axis;
    if (axis && group) {
        const cur = group.children.find(c => c.userData.axis === axis);
        if (cur) {
            const bs = cur.userData.baseScale;
            if (bs) cur.scale.setScalar(bs * 0.8); // pienennä hoverissa
            cur.traverse(o => {
                if (o.userData && o.userData.baseEmissive != null && o.material) {
                    o.material.emissiveIntensity = o.userData.baseEmissive * 1.8;
                }
            });
        }
        canvas.style.cursor = 'pointer';
    } else {
        canvas.style.cursor = (state && state.tool === 'reshape') ? 'move' : '';
    }
}

/** Osuuko veto kahvaan? Palauttaa akselin ('x'|'y'|'z') tai null. */
function reshapeHitHandle(e) {
    if (!reshapeHandleGroup || !scene.children.includes(reshapeHandleGroup)) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(reshapeHandleGroup.children, true);
    // Keskipiste (center) on etusijalla
    for (const hit of hits) {
        const axis = hit.object.userData.axis || (hit.object.parent && hit.object.parent.userData.axis);
        if (axis === 'center') return 'center';
    }
    for (const hit of hits) {
        const axis = hit.object.userData.axis || (hit.object.parent && hit.object.parent.userData.axis);
        if (axis && axis !== 'center') return axis;
    }
    return null;
}

function reshapeBegin(e, axis) {
    reshapeActive = true;
    reshapeAxis = axis || null;
    reshapeStart = JSON.parse(JSON.stringify(state.model));
    state.history.push(JSON.parse(JSON.stringify(state.model)));
    reshapeLastXY = [e.clientX, e.clientY];
    canvas.style.cursor = 'grabbing';
    if (axis === 'center') {
        // Tallenna keskipiste alkuperäisistä luupivoista
        const bb = modelBBox();
        reshapeTranslateOrigin = [(bb.mn[0] + bb.mx[0]) / 2, (bb.mn[1] + bb.mx[1]) / 2, (bb.mn[2] + bb.mx[2]) / 2];
        reshapeSetReadout('Move (drag to translate)');
    } else {
        reshapeTranslateOrigin = null;
        const s = reshapeBlockSize();
        reshapeSetReadout(`${s[0].toFixed(2)} × ${s[1].toFixed(2)} × ${s[2].toFixed(2)} blocks`);
    }
}

function reshapeMove(e) {
    if (!reshapeActive || !reshapeStart) return;
    const dx = e.clientX - reshapeLastXY[0];
    const dy = e.clientY - reshapeLastXY[1];
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    reshapeLastXY = [e.clientX, e.clientY];
    const axis = reshapeAxis;

    // Keskipiste = siirto (translate)
    if (axis === 'center' && reshapeTranslateOrigin) {
        state.model = JSON.parse(JSON.stringify(reshapeStart));
        // Projisoi hiiren liike kamera-tasolta X/Z-akseleille + Y suoraan
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        camRight.y = 0; camRight.normalize();
        const moveScale = 0.15;
        const worldDX = -dx * moveScale;
        const worldDY = dy * moveScale;
        const offX = worldDX * camRight.x;
        const offZ = worldDX * camRight.z;
        const offY = worldDY;
        for (const bone of state.model.bones) {
            bone.pivot[0] += offX;
            bone.pivot[1] += offY;
            bone.pivot[2] += offZ;
        }
        rebuildModel();
        updateReshapeHandles();
        const bb = modelBBox();
        reshapeSetReadout(`Move — ${offX.toFixed(2)}, ${offY.toFixed(2)}, ${offZ.toFixed(2)}`);
        return;
    }

    const clampF = (v) => Math.max(0.35, Math.min(2.5, v));
    // Ylös-veto (dy < 0) kasvattaa korkeutta → miinusmerkki y-akselilla
    const fx = (axis === 'x') ? clampF(1 + dx * 0.012) : ((axis === null) ? clampF(1 + dx * 0.012) : 1);
    const fy = (axis === 'y') ? clampF(1 - dy * 0.012) : ((axis === null) ? clampF(1 - dy * 0.012) : 1);
    const fz = (axis === 'z') ? clampF(1 + dx * 0.012) : ((axis === null && e.shiftKey) ? clampF(1 + dx * 0.012) : 1);
    // Palauta vedon alkutila ja sovella kumulatiiviset kertoimet
    state.model = JSON.parse(JSON.stringify(reshapeStart));
    const bb = modelBBox();
    const pivX = (bb.mn[0] + bb.mx[0]) / 2;
    const pivY = bb.mn[1];
    const pivZ = (bb.mn[2] + bb.mx[2]) / 2;
    if (fx !== 1) scaleModelAxis(0, fx, pivX);
    if (fy !== 1) scaleModelAxis(1, fy, pivY);
    if (fz !== 1) scaleModelAxis(2, fz, pivZ);
    rebuildModel();
    updateReshapeHandles();
    const s = reshapeBlockSize();
    const label = axis ? ` ${axis.toUpperCase()} ` : ' ';
    reshapeSetReadout(`${s[0].toFixed(2)} × ${s[1].toFixed(2)} × ${s[2].toFixed(2)} blocks${label ? ` — ${label.trim()}` : ''}`);
}

function reshapeEnd() {
    if (!reshapeActive) return;
    reshapeActive = false;
    reshapeStart = null;
    reshapeLastXY = null;
    reshapeAxis = null;
    reshapeTranslateOrigin = null;
    // Pyöristä luvut siisteiksi ja tallenna
    for (const bone of state.model.bones) {
        bone.pivot = bone.pivot.map(v => round2(v));
        for (const c of bone.cubes) {
            c.origin = c.origin.map(v => round2(v));
            c.size = c.size.map(v => round2(v));
            if (c.uvSize) c.uvSize = c.uvSize.map(v => round2(v));
        }
    }
    scheduleAutosave();
    checkRenderConsistency();
    updateReshapeHandles();
    // Kursori takaisin: jos hover jää päälle, palauta pointer (tai move)
    canvas.style.cursor = (reshapeHoverAxis && reshapeHandleGroup) ? 'pointer' : 'move';
    const s = reshapeBlockSize();
    setStatus(`Muotoiltu — nyt ${s[0].toFixed(2)} × ${s[1].toFixed(2)} × ${s[2].toFixed(2)} lohkoa. Vedä kahvoja (vihreä/punainen/sininen = skaalaus, keltainen = siirto) tai vedä vapaasti (Shift = pituus)`);
    reshapeReadoutTimer = setTimeout(() => reshapeSetReadout(null), 900);
}

let paint3D = false;
let paintLast = null;

// ==================== FACE DETAILS (Spore-tyylinen kasvojen veto) ======
// Face-tilassa silmä/suu-osa (kategoria 'päät', kiinnittyy head-luuhun)
// valitaan klikkaamalla ja liu'utetaan hiirellä pitkin pään pintaa. Veto
// tapahtuu kameran kanssa yhdensuuntaisella tasolla, liike projisoidaan
// maailman X/Y-akseleille ja rajataan pään kasvojen rajoihin — osa ei
// irtoa päästä eikä uppoa siihen (kuten Sporen kasvojen muokkaus).
let faceDrag = null; // { inst, rootStart, appliedX, appliedY, ref, plane, moved }

function isFaceDetail(inst) {
    return !!inst && !!inst.part && inst.part.category === 'päät'
        && inst.part.attach && inst.part.attach.bone === 'head';
}

function faceHeadRef() {
    const bone = state.model.bones.find(b => /head/i.test(b.name));
    if (!bone || !bone.cubes.length) return null;
    return { bone, cube: bone.cubes[0] };
}

function partOffsetBounds(inst) {
    // Osan kuutioiden minimi/maksimirajat PIVOTIN suhteen (origin − pivot).
    // translatePartData siirtää originit pivotin mukana, joten suhteellinen
    // geometria pysyy vakiona — näin osa pysyy pään sisällä myös kun se
    // roikkuu pivotin yläpuolella (esim. silmät).
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const bn of inst.bones) {
        for (const c of bn.cubes) {
            b.minX = Math.min(b.minX, c.origin[0] - bn.pivot[0]);
            b.maxX = Math.max(b.maxX, c.origin[0] - bn.pivot[0] + c.size[0]);
            b.minY = Math.min(b.minY, c.origin[1] - bn.pivot[1]);
            b.maxY = Math.max(b.maxY, c.origin[1] - bn.pivot[1] + c.size[1]);
        }
    }
    return b;
}

function faceDragBegin(e, inst) {
    const ref = faceHeadRef();
    if (!ref) {        setStatus('Kasvojen yksityiskohdat — tässä mallissa ei ole pääluuta'); return; }
    selectPart(inst);
    const wpos = boneWorldPos(inst.root);
    state.history.push(state.model);
    faceDrag = {
        inst, rootStart: wpos.slice(), appliedX: 0, appliedY: 0, ref,
        startX: e.clientX, startY: e.clientY, moved: false
    };
}

function faceDragMove(e) {
    if (!faceDrag) return;
    // Lineaarinen kamerakartoitus: pikseliveto → maailman siirtymä osan
    // syvyydellä (2·tan(fov/2)·dist / korkeus). Ääretön taso vahvistaisi
    // vinot säteet — tämä pysyy vakaana riippumatta vedon pituudesta.
    const rect = canvas.getBoundingClientRect();
    const s = faceDrag.rootStart;
    const camPos = camera.position;
    const dist = Math.sqrt(
        (camPos.x - s[0]) ** 2 + (camPos.y - s[1]) ** 2 + (camPos.z - s[2]) ** 2
    ) || 1;
    const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / Math.max(1, rect.height);
    const dxPx = e.clientX - faceDrag.startX;
    const dyPx = e.clientY - faceDrag.startY;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const dx = (right.x * dxPx - up.x * dyPx) * worldPerPx;
    const dy = (right.y * dxPx - up.y * dyPx) * worldPerPx;
    // dz (kameran syvyyssuunta) hylätään — osa liukuu vain pään pinnalla
    const wp = faceDrag.rootStart;
    // Rajaa pään kasvojen rajoihin (osan puolikkaan reunuksella). Kuution
    // maailmarajat = luun maailmapositio + (origin − pivot) … + size.
    const ref = faceDrag.ref;
    const hb = boneWorldPos(ref.bone);
    const bp = ref.bone.pivot;
    const c = ref.cube;
    const ob = partOffsetBounds(faceDrag.inst);
    // Kuution maailmarajat = luun maailmapositio + (origin − pivot) … + size.
    // Pivot clampataan niin, että osan kaikki kuutiot pysyvät pään sisällä:
    //   pivot + osan_min ≥ pään_min  ja  pivot + osan_max ≤ pään_max
    const bx = hb[0] + c.origin[0] - bp[0];
    const by = hb[1] + c.origin[1] - bp[1];
    const minX = bx - ob.minX;
    const maxX = bx + c.size[0] - ob.maxX;
    const minY = by - ob.minY;
    const maxY = by + c.size[1] - ob.maxY;
    let nx = wp[0] + dx;
    let ny = wp[1] + dy;
    if (maxX > minX) nx = Math.max(minX, Math.min(maxX, nx));
    if (maxY > minY) ny = Math.max(minY, Math.min(maxY, ny));
    const adx = nx - wp[0];
    const ady = ny - wp[1];
    if (Math.abs(adx - faceDrag.appliedX) < 1e-4 && Math.abs(ady - faceDrag.appliedY) < 1e-4) return;
    faceDrag.moved = true;
    // Palauta alku ja sovella kumulatiivinen siirtymä (kuten reshape)
    const inst = faceDrag.inst;
    translatePartData(inst, -faceDrag.appliedX, -faceDrag.appliedY, 0);
    translatePartData(inst, adx, ady, 0);
    faceDrag.appliedX = adx;
    faceDrag.appliedY = ady;
    syncPartToScene(inst);
    scheduleAutosave();
}

function faceDragEnd() {
    if (!faceDrag) return;
    const moved = faceDrag.moved;
    faceDrag = null;
    if (moved) setStatus('Kasvojen yksityiskohtaa siirretty — se pysyy pään pinnalla');
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Face: klikkaus valitsee silmä/suu-osan ja veto liu'uttaa sitä pitkin pään pintaa
    if (state.tool === 'face') {
        e.preventDefault();
        e.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(state.cubes, false);
        if (hits.length) {
            const boneData = findBoneForCube(state.cubes.indexOf(hits[0].object));
            const inst = boneData ? getPartInstanceForBone(boneData) : null;
            if (inst && isFaceDetail(inst)) {
                faceDragBegin(e, inst);
            } else if (boneData) {
                setStatus('Kasvojen yksityiskohdat — klikkaa silmä-/suu-/kuono-osaa (Päät & kasvot -kategoria), jotta voit siirtää sitä');
            }
        }
        return;
    }
    // Reshape: koko malli venyy/pullistuu vedolla (kuten Sporen kehonmuokkaus).
    // Kahvaosumaan tartutaan akselikohtaisesti — muuten vapaa veto.
    if (state.tool === 'reshape') {
        e.preventDefault();
        e.stopPropagation();
        reshapeBegin(e, reshapeHitHandle(e));
        return;
    }
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
                setStatus(`Väri poimittu: ${color} — jatka maalaamista`);
            } else {
                setStatus('Osuma oli läpinäkyvä — kokeile toista kohtaa');
            }
        } else {
            setStatus('Ei osumaa mallissa');
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
    if (state.tool === 'face') { faceDragMove(e); return; }
    if (state.tool === 'reshape') {
        if (!reshapeActive) {
            // Hover-tarkistus: korosta kahvaa ja vaihda kursori
            reshapeSetHover(reshapeHitHandle(e));
        } else {
            canvas.style.cursor = 'grabbing';
        }
        reshapeMove(e);
        return;
    }
    if (!paint3D || state.tool !== 'paint') return;
    const p = paint3DAt(e);
    paint3DLine(paintLast, p);
    paintLast = p;
});
window.addEventListener('mouseup', () => { paint3D = false; paintLast = null; reshapeEnd(); faceDragEnd(); });
canvas.addEventListener('mouseleave', () => { reshapeSetHover(null); });

// ==================== SELECTION ====================
function selectCube(mesh, multi) {
    const idx = state.cubes.indexOf(mesh);
    if (idx === -1) return;
    const boneData = findBoneForCube(idx);
    // Spore-tyyli: klikkaus osan kuutioon valitsee KOKO osan (luuryhmän).
    // Kuutiotilassa (partFineTune) klikkaus valitsee yksittäisen kuution.
    // Shift+klikkaa ohittaa osan sieppauksen (monivalinta kuutioilla).
    if (boneData && !state.partFineTune && !multi) {
        const inst = getPartInstanceForBone(boneData);
        if (inst) { selectPart(inst); return; }
    }
    doSelectCube(idx, multi);
}

/** Varsinainen yksittäiskuution valinta (ei osan sieppausta). */
function doSelectCube(idx, multi) {
    const mesh = state.cubes[idx];
    if (idx === -1 || !mesh) return;

    const clearHighlight = () => {
        for (const m of state.cubes) {
            if (state.emissiveTexture) {
                m.material.emissive.set(0xffffff);
                m.material.emissiveIntensity = 1.0;
            } else {
                m.material.emissive.set(0x000000);
                m.material.emissiveIntensity = 0;
            }
        }
    };

    if (multi) {
        // Shift+klikkaa: lisää/poista monivalinnasta
        const arr = state.selectedCubes || [];
        const has = arr.includes(idx);
        if (has) {
            state.selectedCubes = arr.filter(i => i !== idx);
        } else {
            state.selectedCubes = [...arr, idx];
        }
        if (state.selectedCubes.length === 0) {
            deselectAll();
            return;
        }
        state.selectedCube = state.selectedCubes[0];
        clearHighlight();
        for (const i of state.selectedCubes) {
            if (state.cubes[i]) {
                state.cubes[i].material.emissive.set(0x2266aa);
                state.cubes[i].material.emissiveIntensity = 0.3;
            }
        }
        transformControls.attach(state.cubes[state.selectedCube]);
        const cubeData = findCubeData(state.selectedCube);
        const boneData = findBoneForCube(state.selectedCube);
        if (boneData) {
            state.selectedBone = state.model.bones.indexOf(boneData);
            highlightBoneTree();
        }
        if (cubeData) showProperties(cubeData, boneData);
        updateRightPanel();
        setStatus(`Valittu ${state.selectedCubes.length} kuutiota — ominaisuudet koskevat kaikkia (Shift+klik lisää/poistaa)`);
        if (state.uvEditor) state.uvEditor.draw();
        return;
    }

    state.selectedCubes = [];
    deselectAll();
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
    updateRightPanel();
    setStatus(`Valittu: ${cubeData.name}`);
    if (state.uvEditor) state.uvEditor.draw(); // päivitä UV-editorin kasvovärit
}

function selectBone(index) {
    state.selectedCube = null;
    const bone = state.model.bones[index];
    // Spore-tyyli: osan luun valinta (puusta) valitsee koko osan
    if (bone && getPartInstanceForBone(bone)) {
        selectPart(getPartInstanceForBone(bone));
        return;
    }
    state.selectedPart = null;
    state.partRootGroup = null;
    state.partFineTune = false;
    hidePartPanel();
    state.selectedBone = index;

    if (index !== null && state.bones[index]) {
        transformControls.attach(state.bones[index]);
        if (state.tool === 'select' || (state.animation && state.animation.poseMode)) {
            setTool('rotate');  // posing bones is the most common action
        }
    }

    highlightBoneTree();
    updateRightPanel();
    if (bone) {
        setStatus(`Valittu luu: ${bone.name} — paina R pyörittääksesi, V siirtääksesi`);
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
    state.selectedCubes = [];
    state.selectedBone = null;
    state.selectedFace = null;
    state.selectedPart = null;
    state.partRootGroup = null;
    state.partFineTune = false;
    hidePartPanel();
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
    setStatus('Valmis');
    updateRightPanel();
    if (state.uvEditor) state.uvEditor.draw(); // piilota kasvovärit kun ei valintaa
}

/** Päivitä oikea paneeli: näytä vain valitun kohteen muokkaus (Blockbench-tyyli). */
function updateRightPanel() {
    const hasCube = state.selectedCube !== null;
    const hasPart = !!state.selectedPart;

    // Kuutioon liittyvät osiot (Ominaisuudet, Väri & tekstuuri, UV-editori)
    // näkyvät vain kun kuutio on valittu — osa-valinnassa niitä ei näytetä.
    const cubeSections = [
        document.getElementById('properties-panel') ? document.getElementById('properties-panel').closest('.panel-section') : null,
        document.getElementById('btn-load-texture') ? document.getElementById('btn-load-texture').closest('.panel-section') : null,
        document.getElementById('uv-canvas') ? document.getElementById('uv-canvas').closest('.panel-section') : null,
    ];
    for (const sec of cubeSections) {
        if (sec) sec.hidden = !hasCube;
    }

    // Tyhjä tila: näkyy kun mikään kohde ei ole valittuna (vain Muokkaa-välilehdellä — CSS hoitaa tabin).
    const empty = document.getElementById('right-empty');
    if (empty) {
        empty.hidden = hasCube || hasPart;
        if (!hasCube && !hasPart) {
            const bone = (state.selectedBone !== null && state.model.bones[state.selectedBone]) ? state.model.bones[state.selectedBone] : null;
            const strong = empty.querySelector('strong');
            const span = empty.querySelector('span');
            if (bone) {
                strong.textContent = `Luu: ${bone.name}`;
                span.textContent = 'Liikuta gizmolla (V siirrä · R kierrä) tai napsauta kuutiota sen muokkaukseen.';
            } else {
                strong.textContent = 'Ei valintaa';
                span.textContent = 'Klikkaa kuutiota 3D-näkymässä tai valitse osa vasemmasta paletista — sen muokkaus tulee tänne.';
            }
        }
    }
}

// ==================== SPORE-OSAN MUOKKAUS ====================
// Osa = yhden kiinnityksen luomat luut (esim. horn_0 + horn_0_1 ja peili
// horn_0m). Osan tunnistaa luunimestä: <partId>_<counter>[m][_<boneIdx>].
// Osan valinta aktivoi koko luuryhmän muokkauksen: gizmo (S=koko, R=kierto,
// G=siirto) ja oikean paneelin '🧩 Osa (Spore)' -osio (väri, skaala, kierto).

const _PART_ID_RE = new RegExp('^(' + MOB_PARTS.map(p => p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')_(\\d+)(m?)(?:_\\d+)?$');

/** Palauta osainstanssi luulle tai null, jos luu ei kuulu osaan. */
function getPartInstanceForBone(bone) {
    if (!bone || !bone.name) return null;
    const m = bone.name.match(_PART_ID_RE);
    if (!m) return null;
    const key = m[1] + '_' + m[2] + m[3];
    // Instanssin luut: juuri (nimi = key) + mahdolliset lisäluut (key_<i>).
    // Vanhat autosavet: kaikki luut samalla nimellä — osuvat key-vertailuun.
    const bones = state.model.bones.filter(b =>
        b.name === key || (b.name.length > key.length + 1 && b.name.startsWith(key + '_'))
    );
    if (!bones.length) return null;
    // Juuri = luu jonka vanhempi ei ole osan sisällä (kiinnityspiste)
    const root = bones.find(b => !bones.some(o => o.name === b.parent)) || bones[0];
    const part = MOB_PARTS.find(p => p.id === m[1]);
    return {
        key,
        id: m[1],
        mirror: !!m[3],
        bones,
        root,
        part,
        label: part ? `${part.name}${m[3] ? ' (mirror)' : ''}` : key
    };
}

function partCubeCount(inst) {
    let n = 0;
    for (const b of inst.bones) n += b.cubes.length;
    return n;
}

/** Valitse koko osa: gizmo kiinnittyy juuriluuhun (kiinnityspisteeseen). */
function selectPart(inst) {
    deselectAll();
    state.selectedPart = inst;
    state.partFineTune = false;
    state.selectedBone = state.model.bones.indexOf(inst.root);
    state.partRootGroup = state.selectedBone >= 0 ? state.bones[state.selectedBone] : null;
    if (state.partRootGroup) {
        if (state.tool === 'select') {
            setTool('scale'); // Spore-tyyli: osan valinta antaa heti skaalausgizmon
        } else if (state.tool === 'face') {
            // Face-tila: ei gizmoa — osaa vedetään hiirellä pitkin pään pintaa
        } else {
            transformControls.attach(state.partRootGroup);
        }
    }
    highlightBoneTree();
    showPartPanel(inst);
    updateRightPanel();
    setStatus(`Osa valittu: ${inst.label} — vedä gizmolla (G siirto · R kierto · skaalaustyökalu), väri ja koko oikealla`);
}

/** Poistu osatilasta yksittäiskuutioiden hienosäätöön (kuutiotila). */
function exitPartMode() {
    if (!state.selectedPart) return;
    const inst = state.selectedPart;
    hidePartPanel();
    let ci = null, idx = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            if (inst.bones.includes(bone)) { ci = idx; break; }
            idx++;
        }
        if (ci !== null) break;
    }
    if (ci !== null && state.cubes[ci]) {
        doSelectCube(ci);
        state.partFineTune = true; // kuutiotila: klikkaukset osuvat yksittäisiin kuutioihin
        setStatus(`Kuutiotila: ${inst.label} — muokkaa kuutioita yksitellen. Klikkaa osaa vasemmassa puussa palataksesi osatilaan`);
    } else {
        deselectAll();
    }
}

// ---- gizmo → data ---------------------------------------------------

/** objectChange (gizmo raahaus): osan kierto kirjoitetaan dataan lennossa. */
function handlePartGizmo(obj) {
    if (transformControls.getMode() === 'rotate') {
        updateBoneFromObject(obj);
        if (state.animation && state.animation.poseMode && state.animation.addKeyframe) {
            state.animation.addKeyframe(true);
        }
    }
    // scale/translate poltetaan dataan raahauksen lopussa (bakePartFromGroup)
}

/** Raahauksen lopussa: gizmon skaalaus/siirto kirjoitetaan osan dataan. */
function bakePartFromGroup(obj) {
    const inst = state.selectedPart;
    if (!inst || obj !== state.partRootGroup) return;
    const mode = transformControls.getMode();
    if (mode === 'scale' && (obj.scale.x !== 1 || obj.scale.y !== 1 || obj.scale.z !== 1)) {
        state.history.push(state.model);
        scalePartData(inst, obj.scale.x, obj.scale.y, obj.scale.z);
        obj.scale.set(1, 1, 1);
        syncPartToScene(inst);
        const abs = absolutePartScale(inst);
        inst.panelScale = abs;
        updatePartPanelScaleInputs();
        scheduleAutosave();
        setStatus(`${inst.label} skaalattu — ${abs[0].toFixed(2)}× / ${abs[1].toFixed(2)}× / ${abs[2].toFixed(2)}×`);
    } else if (mode === 'translate') {
        const worldPos = obj.getWorldPosition(new THREE.Vector3());
        const dx = worldPos.x - inst.root.pivot[0];
        const dy = worldPos.y - inst.root.pivot[1];
        const dz = worldPos.z - inst.root.pivot[2];
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
            state.history.push(state.model);
            translatePartData(inst, dx, dy, dz);
            syncPartToScene(inst);
            scheduleAutosave();
            setStatus(`${inst.label} siirretty`);
        }
    }
}

// ---- osan data-transformit (pivot = juuriluun kiinnityspiste) --------

function clampPartAxis(v, fallback) {
    if (!isFinite(v) || v === 0) return fallback;
    return Math.max(0.15, Math.min(10, v));
}

function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Osan kaikki sivut: instanssin omat luut + peilisisarus (jos symmetrinen).
 * Peilisisar etsitään ensisijaisesti kiinnityksen kirjaamasta partPair-merkinnästä,
 * muuten geometrisesta vastineesta (sama osa, viereinen laskuri, pivot peilattu
 * x:n yli) — sama logiikka kuin deleteSelectedissä. Jokaisella sivulla on oma
 * juuriluunsa, jonka pivot toimii kyseisen sivun kiinnityspisteenä.
 */
function partSides(inst) {
    const sides = [{ bones: inst.bones, root: inst.root }];
    const group = (inst.root && inst.root.partGroup) || null;
    if (group && group.length > 1) {
        // partGroup (2×2 / useat kopiot): kaikki juuret + niiden lisäluut
        const seen = new Set(inst.bones.map(b => b.name));
        for (const rn of group) {
            if (seen.has(rn)) continue;
            const rb = state.model.bones.find(b => b.name === rn);
            if (!rb) continue;
            const bones = state.model.bones.filter(b =>
                b.name === rn || (b.name.length > rn.length + 1 && b.name.startsWith(rn + '_'))
            );
            for (const b of bones) seen.add(b.name);
            sides.push({ bones, root: rb });
        }
        return sides;
    }
    // Fallback: partPair (vanhat tallennukset) tai geometrinen vastine
    let pairBones = null;
    if (inst.root && inst.root.partPair) {
        const p = inst.root.partPair;
        pairBones = state.model.bones.filter(b => b.name === p || (b.name.length > p.length + 1 && b.name.startsWith(p + '_')));
    } else {
        const names = new Set(inst.bones.map(b => b.name));
        const myCounter = parseInt(inst.key.split('_').pop().replace(/m$/, ''), 10);
        for (const b of state.model.bones) {
            if (names.has(b.name)) continue;
            const oi = getPartInstanceForBone(b);
            if (!oi || oi.id !== inst.id || oi.key === inst.key) continue;
            const oc = parseInt(oi.key.split('_').pop().replace(/m$/, ''), 10);
            if (Math.abs(oc - myCounter) !== 1) continue;
            const rp = inst.root.pivot, op = oi.root.pivot;
            if (Math.abs(op[0] + rp[0]) < 0.6 && Math.abs(op[1] - rp[1]) < 0.6 && Math.abs(op[2] - rp[2]) < 0.6) {
                pairBones = oi.bones;
                break;
            }
        }
    }
    if (pairBones && pairBones.length) {
        const pairRoot = pairBones.find(b => !pairBones.some(o => o.name === b.parent)) || pairBones[0];
        sides.push({ bones: pairBones, root: pairRoot });
    }
    return sides;
}

function roundPartData(inst) {
    for (const side of partSides(inst)) {
        for (const b of side.bones) {
            b.pivot = b.pivot.map(v => round2(v));
            for (const c of b.cubes) {
                c.origin = c.origin.map(v => round2(v));
                c.size = c.size.map(v => round2(v));
            }
        }
    }
}

/** Skaalaa koko osa (molemmat peilisivut) kunkin sivun kiinnityspisteen ympäri — Spore-tyyli. */
function scalePartData(inst, sx, sy, sz) {
    const S = [clampPartAxis(sx, 1), clampPartAxis(sy, 1), clampPartAxis(sz, 1)];
    for (const side of partSides(inst)) {
        const p = side.root.pivot;
        for (const b of side.bones) {
            for (let i = 0; i < 3; i++) {
                b.pivot[i] = p[i] + (b.pivot[i] - p[i]) * S[i];
            }
            for (const c of b.cubes) {
                const cx = c.origin[0] + c.size[0] / 2;
                const cy = c.origin[1] + c.size[1] / 2;
                const cz = c.origin[2] + c.size[2] / 2;
                c.size[0] *= S[0]; c.size[1] *= S[1]; c.size[2] *= S[2];
                c.origin[0] = p[0] + (cx - p[0]) * S[0] - c.size[0] / 2;
                c.origin[1] = p[1] + (cy - p[1]) * S[1] - c.size[1] / 2;
                c.origin[2] = p[2] + (cz - p[2]) * S[2] - c.size[2] / 2;
            }
        }
    }
    roundPartData(inst);
}

/** Lisää rotaatio (delta asteina) koko osaan (molemmat peilisivut) kunkin sivun kiinnityspisteen ympäri. */
function rotatePartData(inst, dx, dy, dz) {
    const R = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(dx), THREE.MathUtils.degToRad(dy), THREE.MathUtils.degToRad(dz), 'ZYX')
    );
    const v = new THREE.Vector3();
    for (const side of partSides(inst)) {
        const p = side.root.pivot;
        for (const b of side.bones) {
            v.set(b.pivot[0] - p[0], b.pivot[1] - p[1], b.pivot[2] - p[2]).applyMatrix4(R);
            b.pivot = [p[0] + v.x, p[1] + v.y, p[2] + v.z];
            b.rotation = composeRotationDeg(b.rotation, [dx, dy, dz]);
            for (const c of b.cubes) {
                v.set(c.origin[0] + c.size[0] / 2 - p[0], c.origin[1] + c.size[1] / 2 - p[1], c.origin[2] + c.size[2] / 2 - p[2]).applyMatrix4(R);
                c.origin = [p[0] + v.x - c.size[0] / 2, p[1] + v.y - c.size[1] / 2, p[2] + v.z - c.size[2] / 2];
                c.rotation = composeRotationDeg(c.rotation, [dx, dy, dz]);
            }
        }
    }
    roundPartData(inst);
}

/** Siirrä koko osa (molemmat peilisivut) annetulla vektorilla. */
function translatePartData(inst, dx, dy, dz) {
    for (const side of partSides(inst)) {
        for (const b of side.bones) {
            b.pivot[0] += dx; b.pivot[1] += dy; b.pivot[2] += dz;
            for (const c of b.cubes) {
                c.origin[0] += dx; c.origin[1] += dy; c.origin[2] += dz;
            }
        }
    }
    roundPartData(inst);
}

/** Yhdistä ZYX-rotaatio deltaan (delta sovelletaan ensin, vanhemman avaruus). */
function composeRotationDeg(baseDeg, deltaDeg) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(baseDeg[0] || 0),
        THREE.MathUtils.degToRad(baseDeg[1] || 0),
        THREE.MathUtils.degToRad(baseDeg[2] || 0),
        'ZYX'
    ));
    const d = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(deltaDeg[0] || 0),
        THREE.MathUtils.degToRad(deltaDeg[1] || 0),
        THREE.MathUtils.degToRad(deltaDeg[2] || 0),
        'ZYX'
    ));
    const out = new THREE.Matrix4().multiplyMatrices(d, m);
    const e = new THREE.Euler().setFromRotationMatrix(out, 'ZYX');
    return [
        Math.round(THREE.MathUtils.radToDeg(e.x)),
        Math.round(THREE.MathUtils.radToDeg(e.y)),
        Math.round(THREE.MathUtils.radToDeg(e.z))
    ];
}

/** Päivitä osan luuryhmät + kuutioiden geometriat dataan (ilman rebuildia). */
function syncPartToScene(inst) {
    for (const side of partSides(inst)) {
        for (const b of side.bones) {
            const bi = state.model.bones.indexOf(b);
            if (bi >= 0) updateBoneGroupInPlace(bi);
        }
    }
    if (state.uvEditor) state.uvEditor.draw();
}

// ---- paneelin tila ---------------------------------------------------

/** Osa-skannaus istunnon alussa: paneelin '1.0' = alkuperäinen koko. */
function snapshotPart(inst) {
    inst.panelScale = [1, 1, 1];
    inst.panelRot = [0, 0, 0];
    inst.snap = inst.bones.map(b => ({
        pivot: b.pivot.slice(),
        cubes: b.cubes.map(c => ({
            size: c.size.slice(),
            center: [c.origin[0] + c.size[0] / 2, c.origin[1] + c.size[1] / 2, c.origin[2] + c.size[2] / 2]
        }))
    }));
}

/** Nykyinen absoluuttinen skaalaus suhteessa istunnon alkuun (kokosuhteista). */
function absolutePartScale(inst) {
    if (!inst.snap) return [1, 1, 1];
    const avg = [null, null, null];
    for (let i = 0; i < inst.bones.length; i++) {
        const b = inst.bones[i];
        const sb = inst.snap[i];
        if (!sb) continue;
        for (let j = 0; j < b.cubes.length; j++) {
            const c = b.cubes[j];
            const sc = sb.cubes[j];
            if (!sc) continue;
            for (let a = 0; a < 3; a++) {
                if (sc.size[a] > 0.05) {
                    const r = c.size[a] / sc.size[a];
                    avg[a] = avg[a] === null ? r : avg[a] * 0.5 + r * 0.5;
                }
            }
        }
    }
    return [0, 1, 2].map(a => (avg[a] === null ? 1 : Math.max(0.15, Math.min(10, avg[a]))));
}

function hidePartPanel() {
    const s = document.getElementById('part-edit-section');
    if (s) s.hidden = true;
}

function showPartPanel(inst) {
    snapshotPart(inst);
    const section = document.getElementById('part-edit-section');
    if (!section) return;
    section.hidden = false;
    document.getElementById('part-edit-title').textContent =
        `${inst.label} — ${partCubeCount(inst)} cubes · ${inst.bones.length} bones`;
    const first = inst.bones[0] && inst.bones[0].cubes[0];
    document.getElementById('part-edit-color').value = (first && first.color) || '#c68642';
    updatePartPanelScaleInputs();
    document.getElementById('part-rot-x').value = 0;
    document.getElementById('part-rot-y').value = 0;
    document.getElementById('part-rot-z').value = 0;
    inst.panelRot = [0, 0, 0];
}

function updatePartPanelScaleInputs() {
    const inst = state.selectedPart;
    if (!inst) return;
    const abs = absolutePartScale(inst);
    inst.panelScale = abs;
    document.getElementById('part-scale-x').value = round2(abs[0]);
    document.getElementById('part-scale-y').value = round2(abs[1]);
    document.getElementById('part-scale-z').value = round2(abs[2]);
}

/** Aseta osan skaalaus tietylle akselille (arvo suhteessa istunnon alkuun). */
function setPartScale(inst, value, axis) {
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const prev = (inst.panelScale || [1, 1, 1])[ai] || 1;
    const d = clampPartAxis(value / prev, 1);
    const S = [1, 1, 1];
    S[ai] = d;
    scalePartData(inst, S[0], S[1], S[2]);
    inst.panelScale[ai] = value;
    syncPartToScene(inst);
}

/** Käännä osaa tietylle akselille (arvo = suhteellinen delta asteina). */
function setPartRot(inst, value, axis) {
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const prev = (inst.panelRot || [0, 0, 0])[ai] || 0;
    const d = value - prev;
    if (Math.abs(d) < 0.01) return;
    const D = [0, 0, 0];
    D[ai] = d;
    rotatePartData(inst, D[0], D[1], D[2]);
    inst.panelRot[ai] = value;
    syncPartToScene(inst);
}

/** Maalaa koko osan kuutiot (molemmat peilisivut) yhdellä värillä (kaikki kasvot tekstuuriin). */
function paintPartColor(inst, color) {
    ensureTexture();
    const tctx = state.textureCanvas.getContext('2d');
    for (const side of partSides(inst)) {
        for (const b of side.bones) {
            for (const c of b.cubes) {
                c.color = color;
                fillCubeFaces(tctx, c, color);
            }
        }
    }
    state.texture.needsUpdate = true;
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();        setStatus(`${inst.label} väritetty: ${color}`);
}

function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

/** '🧩 Osa (Spore)' -paneelin kytkennät. */
function setupPartEditPanel() {
    const section = document.getElementById('part-edit-section');
    if (!section) return;

    // Väri: maalaa koko osan kuutiot
    const colorInput = document.getElementById('part-edit-color');
    colorInput.addEventListener('change', () => {
        if (state.selectedPart) paintPartColor(state.selectedPart, colorInput.value);
    });
    document.getElementById('part-edit-rand-color').addEventListener('click', () => {
        if (!state.selectedPart) return;
        const color = hslToHex(Math.floor(Math.random() * 360), 0.55, 0.5);
        colorInput.value = color;
        paintPartColor(state.selectedPart, color);
    });

    // Skaalaus: live (input), undo-piste focusissa
    for (const axis of ['x', 'y', 'z']) {
        const inp = document.getElementById('part-scale-' + axis);
        inp.addEventListener('focus', () => { state._panelHistoryPushed = false; });
        inp.addEventListener('input', () => {
            if (!state.selectedPart) return;
            if (!state._panelHistoryPushed) { state.history.push(state.model); state._panelHistoryPushed = true; }
            const v = Math.max(0.15, Math.min(10, parseFloat(inp.value) || 1));
            inp.value = round2(v);
            setPartScale(state.selectedPart, v, axis);
            scheduleAutosave();
        });
    }
    document.getElementById('part-scale-reset').addEventListener('click', () => {
        if (!state.selectedPart) return;
        state.history.push(state.model);
        const inst = state.selectedPart;
        setPartScale(inst, 1, 'x');
        setPartScale(inst, 1, 'y');
        setPartScale(inst, 1, 'z');
        updatePartPanelScaleInputs();
        scheduleAutosave();
        setStatus(`${inst.label} palautettu alkuperäiseen kokoon`);
    });

    // Kierto: suhteellinen delta asteina
    for (const axis of ['x', 'y', 'z']) {
        const inp = document.getElementById('part-rot-' + axis);
        inp.addEventListener('focus', () => { state._panelHistoryPushed = false; });
        inp.addEventListener('input', () => {
            if (!state.selectedPart) return;
            if (!state._panelHistoryPushed) { state.history.push(state.model); state._panelHistoryPushed = true; }
            const v = parseFloat(inp.value) || 0;
            setPartRot(state.selectedPart, v, axis);
            scheduleAutosave();
        });
    }

    document.getElementById('part-edit-exit').addEventListener('click', exitPartMode);
}

// ==================== MODEL BUILDING ====================
function rebuildModel() {
    state.modelVersion++; // peilikartta ym. välimuistit vanhenevat
    // Clear old meshes
    for (const group of state.bones) {
        scene.remove(group);
    }
    for (const lm of state.locatorMeshes) {
        scene.remove(lm);
    }
    state.bones = [];
    state.cubes = [];
    state.locatorMeshes = [];

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
            // Per-kuutio materiaali (Fase 6): opacity 0..1 ja emissive 0..3
            // menevät kuutiodatasta materiaaliin. Oletus: teksturoitu = 1.0,
            // väripohjainen = 0.85 (editorin vanha käytäntö).
            const cubeOpacity = (typeof cubeData.opacity === 'number')
                ? Math.max(0.05, Math.min(1, cubeData.opacity))
                : (state.textureDataURL ? 1.0 : 0.85);
            const cubeEmissive = (typeof cubeData.emissive === 'number')
                ? Math.max(0, Math.min(3, cubeData.emissive))
                : 0;
            const mat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: state.texture,
                roughness: 0.7,
                metalness: 0.1,
                transparent: true,
                opacity: cubeOpacity,
                // Kuution oma emissive-kerros lisätään mobin glow-tekstuuriin
                emissive: (hasEmissive || cubeEmissive > 0) ? 0xffffff : 0x000000,
                emissiveMap: hasEmissive ? state.emissiveTexture : null,
                emissiveIntensity: Math.max(hasEmissive ? 1.0 : 0, cubeEmissive)
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

    // Päivitä locator-lista (nimet voivat muuttua)
    if (typeof renderLocatorList === 'function') renderLocatorList();

    // 3) Locatorit: näkyvät kiinnityspisteen merkit (pieni kartio/kuutio)
    const locGeo = new THREE.ConeGeometry(0.35, 0.8, 4);
    const locMat = new THREE.MeshStandardMaterial({
        color: 0x00bcd4,
        emissive: 0x00bcd4,
        emissiveIntensity: 0.8,
        roughness: 0.4,
        transparent: true,
        opacity: 0.9
    });
    for (const loc of state.model.locators || []) {
        const mesh = new THREE.Mesh(locGeo, locMat);
        const boneIdx = state.model.bones.findIndex(b => b.name === (loc.bone || 'root'));
        const pivot = boneIdx >= 0 ? state.model.bones[boneIdx].pivot : [0, 0, 0];
        const pos = loc.position || [0, 0, 0];
        // Locatorin positio on luun avaruudessa (bone-local) — renderöidään
        // luun pivotista siirrettynä, jotta se osuu maailmassa oikein.
        mesh.position.set(
            pos[0] + pivot[0],
            pos[1] + pivot[1],
            pos[2] + pivot[2]
        );
        mesh.name = `locator_${loc.name}`;
        mesh.userData.locatorName = loc.name;
        scene.add(mesh);
        state.locatorMeshes.push(mesh);
    }

    updateBoneTree();
    // resize() skaalaa canvaksen mallin tekstuurikoon mukaan ja piirtää
    // (aiemmin canvas pysyi vanhassa koossa mallin vaihtuessa)
    if (state.uvEditor) state.uvEditor.resize();
    if (state.animation) state.animation.applyPose();
    // Shadow-kamera ja maataso mallin koon mukaan + varjot jos pelinäkymä päällä
    if (state.gamePreview) {
        updateShadowBounds();
        for (const mesh of state.cubes) { mesh.castShadow = true; mesh.receiveShadow = true; }
        if (state.gamePreviewNight) boostGlowIntensities();
    }
    // Osan valinta säilyy rebuildin yli — luuryhmät uusiutuvat
    if (state.selectedPart) {
        const rootIdx = state.model.bones.indexOf(state.selectedPart.root);
        if (rootIdx >= 0 && state.bones[rootIdx]) {
            state.selectedBone = rootIdx;
            state.partRootGroup = state.bones[rootIdx];
            if (transformControls.object) transformControls.attach(state.partRootGroup);
        } else {
            state.selectedPart = null;
            state.partRootGroup = null;
            hidePartPanel();
        }
    }
    // Reshape-kahvat seuraavat mallia (vain kun työkalu on aktiivinen)
    if (state.tool === 'reshape' && reshapeHandleGroup && scene.children.includes(reshapeHandleGroup)) {
        updateReshapeHandles();
    }
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
    // Sijoita uusi kuutio MALLIN YLÄPUOLELLE (ei kiinteään "pivot + 8"):
    // pienissä malleissa (esim. Stalker) kiinteä lisäys vei kuution kauas
    // kameran näkymän ulkopuolelle, eikä siihen saanut kiinni. Lasketaan
    // mallin oikea MAAILMAboxi (huomioi luiden rotaatiot), ja käännetään
    // haluttu maailmapiste kohdeluun paikalliseen origin-avaruuteen.
    const SIZE = 4;
    const wbb = modelWorldBBox();
    const hasCubes = isFinite(wbb.mn[0]);
    // Kuution keskipiste maailmassa: mallin päällä, keskitetty X/Z.
    const cx = hasCubes ? (wbb.mn[0] + wbb.mx[0]) / 2 : 0;
    const cz = hasCubes ? (wbb.mn[2] + wbb.mx[2]) / 2 : 0;
    const cy = (hasCubes ? wbb.mx[1] : 0) + 2 + SIZE / 2;
    // Muunna maailmapiste kohdeluun paikalliseksi originiksi: luuryhmän
    // world-matriisi kertoo miten origin+size/2−pivot sijoittuu maailmaan,
    // joten origin = M⁻¹·W + pivot − size/2.
    const bi = state.model.bones.indexOf(bone);
    const group = bi >= 0 ? state.bones[bi] : null;
    let origin;
    if (group) {
        group.updateWorldMatrix(true, true);
        const inv = group.matrixWorld.clone().invert();
        const local = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
        origin = [
            local.x + bone.pivot[0] - SIZE / 2,
            local.y + bone.pivot[1] - SIZE / 2,
            local.z + bone.pivot[2] - SIZE / 2
        ];
    } else {
        origin = [cx - SIZE / 2, cy - SIZE / 2, cz - SIZE / 2];
    }
    bone.cubes.push({
        name: cubeName,
        origin,
        size: [SIZE, SIZE, SIZE],
        rotation: [0, 0, 0],
        uv: { offset: autoUV },
        mirror: false
    });

    rebuildModel();
    // Valitse uusi kuutio heti — gizmo kiinnittyy ja näet tarkalleen mitä lisäsit
    for (let i = 0; i < state.cubes.length; i++) {
        const cd = findCubeData(i);
        if (cd && cd.name === cubeName) {
            state.selectedCubes = [];
            doSelectCube(i, false);
            // Jos kuutio jäi ruudun ulkopuolelle (pieni malli + tiukka zoom),
            // siirrä kamera niin että se näkyy ja siihen saa kiinni.
            frameToNewCube(state.cubes[i]);
            setStatus(`Lisätty ${cubeName} — vedä V:llä (siirto), R kääntää, S venyttää`);
            break;
        }
    }
    scheduleAutosave();
}

// Varmistaa että juuri lisätty kuutio näkyy kameran kuvakulmassa: jos se
// on ruudun ulkopuolella (pieni malli + tiukka zoom), siirretään kameran
// kohdetta kuution suuntaan ilman zoomausta, jotta siihen saa kiinni.
function frameToNewCube(mesh) {
    if (!state.orbitControls || !state.camera) return;
    mesh.updateWorldMatrix(true, true);
    const center = new THREE.Vector3();
    mesh.getWorldPosition(center);
    state.camera.updateMatrixWorld(true);
    // Onko kuutio jo ruudulla? Projektoidaan ja katsotaan reunoja.
    const v = center.clone().project(state.camera);
    const rect = canvas.getBoundingClientRect();
    const px = ((v.x + 1) / 2) * rect.width;
    const py = ((1 - v.y) / 2) * rect.height;
    const margin = 80;
    if (px > -margin && px < rect.width + margin && py > -margin && py < rect.height + margin) {
        return; // näkyy jo
    }
    // Ei näy → siirrä kohde kuution kohdalle, kamera seuraa saman verran.
    const target = state.orbitControls.target;
    const delta = center.clone().sub(target);
    state.orbitControls.target.copy(center);
    state.camera.position.add(delta);
    state.orbitControls.update();
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
    setStatus(`Lisätty luu: ${name}`);
}

// ==================== 3D-ESIKATSEUT (SPORE-PALETTI JA POHJAT) ====================
// Renderöi jokaisen annetun kohteen (osa tai pohja) pieneksi 3D-kuvaksi
// (oikeat kuutiot ja värit) Sporen paletin tyyliin. Jokainen entry on
// { key, bones[] } (bones[i].cubes sisältävät origin/size/rotation/color).
// Palauttaa Map<key, dataURL>. Jos WebGL ei ole käytettävissä, palauttaa
// tyhjän kartan → napit käyttävät emojia. Renderöijä vapautetaan heti.
function buildVoxelThumbMap(entries) {
    const map = new Map();
    if (!renderer || !entries) return map; // ei 3D:ta → emoji-laatat
    let r = null;
    try {
        r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        r.setPixelRatio(1);
        r.setSize(96, 96);
        r.setClearColor(0x000000, 0); // läpinäkyvä tausta
        const s = new THREE.Scene();
        s.add(new THREE.AmbientLight(0xffffff, 0.9));
        const d1 = new THREE.DirectionalLight(0xffffff, 1.15);
        d1.position.set(3, 5, 4);
        s.add(d1);
        const d2 = new THREE.DirectionalLight(0xffffff, 0.4);
        d2.position.set(-4, -2, -5);
        s.add(d2);
        const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
        const geoCache = new Map();
        const mkGeo = (x, y, z) => {
            const k = x + 'x' + y + 'x' + z;
            let g = geoCache.get(k);
            if (!g) { g = new THREE.BoxGeometry(x, y, z); geoCache.set(k, g); }
            return g;
        };
        for (const entry of entries) {
            const bones = entry.bones || [];
            const group = new THREE.Group();
            let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
            for (const b of bones) {
                for (const cq of (b.cubes || [])) {
                    const geo = mkGeo(cq.size[0], cq.size[1], cq.size[2]);
                    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(cq.color || '#888888') });
                    const m = new THREE.Mesh(geo, mat);
                    const cx = cq.origin[0] + cq.size[0] / 2;
                    const cy = cq.origin[1] + cq.size[1] / 2;
                    const cz = cq.origin[2] + cq.size[2] / 2;
                    m.position.set(cx, cy, cz);
                    if (cq.rotation && cq.rotation.some(v => v)) {
                        const [rx, ry, rz] = cq.rotation.map(v => THREE.MathUtils.degToRad(v));
                        m.rotation.set(rx, ry, rz);
                    }
                    group.add(m);
                    for (let i = 0; i < 3; i++) {
                        mn[i] = Math.min(mn[i], cq.origin[i]);
                        mx[i] = Math.max(mx[i], cq.origin[i] + cq.size[i]);
                    }
                }
            }
            if (!group.children.length) { map.set(entry.key, ''); continue; }
            s.add(group);
            const center = [0, 1, 2].map(i => (mn[i] + mx[i]) / 2);
            const ext = Math.max(1, Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]));
            const dist = ext * 2.15;
            cam.near = 0.1; cam.far = 300;
            cam.updateProjectionMatrix();
            cam.position.set(center[0] + dist, center[1] + dist * 1.15, center[2] + dist);
            cam.lookAt(center[0], center[1], center[2]);
            r.render(s, cam);
            let url = '';
            try { url = r.domElement.toDataURL('image/png'); } catch (e) { url = ''; }
            map.set(entry.key, url);
            s.remove(group);
        }
    } catch (e) {
        console.warn('Esikatselukuvien renderöinti epäonnistui:', e.message);
    } finally {
        if (r) { try { r.dispose(); r.forceContextLoss && r.forceContextLoss(); } catch (e) { /* ohitetaan */ } }
    }
    return map;
}

function buildPartThumbMap() {
    return buildVoxelThumbMap(MOB_PARTS.map(p => ({ key: p.id, bones: p.bones })));
}

// ==================== OSAN VETÄMINEN OLENNON PÄÄLLE (DRAG&DROP) ====================
// Vedä osa vasemmasta paletista suoraan olennon päälle — se kiinnittyy
// siihen luuhun ja pinnalle, johon pudotat (Spore-tyyli).

let partDragActive = false;

function startPartDrag(partId) {
    partDragActive = true;
    const hint = document.getElementById('part-drop-hint');
    if (hint) hint.textContent = 'Vedä osa olennon päälle ja pudota';
}

function endPartDrag() {
    partDragActive = false;
    const hint = document.getElementById('part-drop-hint');
    if (hint) hint.classList.remove('visible');
    canvas.style.cursor = '';
}

/** Kasvon normaalin dominanssi → osan kiinnityspinta (top/bottom/front/back/side). */
function attachAtFromWorldNormal(n) {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) return n.y > 0 ? 'top' : 'bottom';
    if (az >= ax) return n.z < 0 ? 'front' : 'back';
    return 'side';
}

/** Päivitä vihje-ikkuna + kursorin tila osoittimen alla olevan osan mukaan. */
function updatePartDropState(ev) {
    const hint = document.getElementById('part-drop-hint');
    if (!renderer || ev.target !== canvas) {
        canvas.style.cursor = 'no-drop';
        if (hint) hint.classList.remove('visible');
        return;
    }
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(state.cubes, false);
    if (!hits.length) {
        canvas.style.cursor = 'no-drop';
        if (hint) hint.classList.remove('visible');
        return;
    }
    const mesh = hits[0].object;
    const idx = state.cubes.indexOf(mesh);
    const bone = findBoneForCube(idx);
    const at = attachAtFromWorldNormal(hits[0].face.normal.clone().transformDirection(mesh.matrixWorld));
    const atLabel = { top: 'Ylä', bottom: 'Ala', front: 'Etu', back: 'Taka', side: 'Sivu' }[at] || at;
    if (hint) {
        hint.textContent = '→ ' + (bone ? bone.name : '?') + ' · ' + atLabel;
        hint.classList.add('visible');
    }
    canvas.style.cursor = 'copy';
}

/** Pudotus: kiinnitä osa osuman luuhun ja pinnalle. */
function onPartDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    endPartDrag();
    const partId = ev.dataTransfer ? ev.dataTransfer.getData('application/x-part-id') : '';
    if (!partId) { setStatus('Vedä osa vasemmasta paletista olennon päälle'); return; }
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(state.cubes, false);
    if (!hits.length) { setStatus('Pudota osa olennon päälle'); return; }
    const mesh = hits[0].object;
    const idx = state.cubes.indexOf(mesh);
    const bone = findBoneForCube(idx);
    if (!bone) { setStatus('Ei kohdeluuta — pudota olennon pintaan'); return; }
    const at = attachAtFromWorldNormal(hits[0].face.normal.clone().transformDirection(mesh.matrixWorld));
    const mirrorChk = document.getElementById('part-mirror');
    addPartToModel(partId, { boneName: bone.name, at, mirror: !mirrorChk || mirrorChk.checked });
    setStatus(`Kiinnitettiin osa → ${bone.name} (${{ top: 'Ylä', bottom: 'Ala', front: 'Etu', back: 'Taka', side: 'Sivu' }[at]})`);
}

function setupPartDragDrop() {
    // dragover tarvitsee preventDefaultin, että drop sallitaan — päivitetään
    // samalla vihje siitä mihin osa kiinnittyy.
    canvas.addEventListener('dragover', (ev) => {
        if (!partDragActive) return;
        ev.preventDefault();
        updatePartDropState(ev);
    });
    canvas.addEventListener('drop', (ev) => {
        if (!partDragActive) return;
        onPartDrop(ev);
    });
    canvas.addEventListener('dragleave', (ev) => {
        if (ev.target === canvas) endPartDrag();
    });
}

// ==================== OSAN KIINNITYSVALIKKO ====================
// Kun osa lisätään, käyttäjä voi valita mihin luuhun (vanhempi) ja mille
// pinnalle (alhaalle / ylös / eteen / taakse / sivulle) osa kiinnittyy.

let pendingPartId = null;
let pendingPartCopies = 2;

function openPartAttachDialog(partId, opts = {}) {
    const part = MOB_PARTS.find(p => p.id === partId);
    if (!part) return;
    const bones = state.model.bones;
    const select = document.getElementById('part-attach-bone');
    if (!select) return;

    // Luettelo luista (vanhemmiksi kelpaavat kaikki)
    select.innerHTML = '';
    for (const b of bones) {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = `${b.name} (${b.cubes.length} cubes)`;
        select.appendChild(opt);
    }
    // Oletus: osan oma oletusluu (auto-etsintä)
    const def = findPartAttachBone(part, {});
    if (def) select.value = def.name;

    // Oletuspinta osan määritelmästä, valinta korostetaan
    const surfBtns = document.querySelectorAll('#part-attach-surface button');
    surfBtns.forEach(btn => btn.classList.toggle('selected', btn.dataset.at === part.attach.at));

    // Kopioiden määrä: paneelin globaali oletus, käyttäjä voi vaihtaa per osa.
    // Epäsymmetriset osat (ei part.symmetric) pakotetaan yhteen kopioon —
    // peilipari ei ole järkevä jos osa ei ole symmetrinen.
    const forced = part.symmetric === false ? 1 : null;
    const copiesSel = document.getElementById('part-attach-copies');
    pendingPartCopies = forced || (opts.copies || 2);
    copiesSel.value = String(pendingPartCopies);
    copiesSel.disabled = !!forced;

    pendingPartId = partId;
    document.getElementById('part-attach-title').textContent = `Kiinnitä: ${part.name}`;
    document.getElementById('part-attach-dialog').style.display = 'flex';
}

function closePartAttachDialog() {
    document.getElementById('part-attach-dialog').style.display = 'none';
    pendingPartId = null;
}

function setupPartAttachDialog() {
    const dialog = document.getElementById('part-attach-dialog');
    if (!dialog) return;

    // Pintanapit: valitse yksi kerrallaan
    document.querySelectorAll('#part-attach-surface button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#part-attach-surface button').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });

    document.getElementById('part-attach-confirm').addEventListener('click', () => {
        if (!pendingPartId) return;
        const select = document.getElementById('part-attach-bone');
        const sel = document.querySelector('#part-attach-surface button.selected');
        const at = sel ? sel.dataset.at : null;
        const copies = parseInt(document.getElementById('part-attach-copies').value, 10) || 2;
        addPartToModel(pendingPartId, { boneName: select.value, at, copies });
        closePartAttachDialog();
    });

    document.getElementById('part-attach-cancel').addEventListener('click', closePartAttachDialog);
    // Esc sulkee
    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePartAttachDialog();
    });
}

// ==================== SPORE-TYYYLINEN OSAPALETTI ====================
// Valmiita osia (jalat, päät, hännät, siivet…) voi kiinnittää mihin tahansa
// malliin. Osat on määritelty paikallisessa koordinaatistossa (kiinnityspiste
// = origo) ja ne kiinnittyvät lähimmän sopivan luun ulkopintaan.

let partCounter = 0;

function cubeBBox(c) {
    return {
        mn: c.origin.slice(),
        mx: [c.origin[0] + c.size[0], c.origin[1] + c.size[1], c.origin[2] + c.size[2]]
    };
}

function boneCubeBBox(bone) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const c of bone.cubes || []) {
        const { mn: a, mx: b } = cubeBBox(c);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a[i]); mx[i] = Math.max(mx[i], b[i]); }
    }
    return { mn, mx };
}

function modelBBox() {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const bone of state.model.bones) {
        const { mn: a, mx: b } = boneCubeBBox(bone);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a[i]); mx[i] = Math.max(mx[i], b[i]); }
    }
    return { mn, mx };
}

/** Mallin MAAILMAkoordinaattiboxi renderöidyistä mesh-objekteista.
 * Toisin kuin modelBBox (databoxi), tämä huomioi luiden rotaatiot ja
 * hierarkian — siis sen, mitä käyttäjä oikeasti näkee ruudulla. */
function modelWorldBBox() {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const mesh of state.cubes) {
        mesh.updateWorldMatrix(true, true);
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        for (let i = 0; i < 8; i++) {
            const v = new THREE.Vector3(
                (i & 1) ? bb.max.x : bb.min.x,
                (i & 2) ? bb.max.y : bb.min.y,
                (i & 4) ? bb.max.z : bb.min.z
            );
            mesh.localToWorld(v);
            for (let k = 0; k < 3; k++) {
                mn[k] = Math.min(mn[k], v.getComponent(k));
                mx[k] = Math.max(mx[k], v.getComponent(k));
            }
        }
    }
    return { mn, mx };
}

/** Etsi luu johon osa kiinnittyy: opts.boneName pakottaa luun, muuten mieluiten oikea luu (head/body), sitten mikä tahansa kuutioita sisältävä. */
function findPartAttachBone(part, opts = {}) {
    const bones = state.model.bones;
    if (opts.boneName) {
        return bones.find(b => b.name === opts.boneName) || null;
    }
    const want = part.attach.bone;
    if (want === 'head') {
        const h = bones.find(b => /head/i.test(b.name));
        if (h) return h;
    }
    if (want === 'body') {
        const b = bones.find(b => /body/i.test(b.name) && b.cubes.length > 0);
        if (b) return b;
        const any = bones.find(b => b.cubes.length > 0);
        if (any) return any;
    }
    const first = bones.find(b => b.cubes.length > 0) || bones[0];
    return first || null;
}

/** Kiinnityspisteen siirtymä luun pivotista mallin uloimpaan pintaan (osat kasvattavat mallia). */
function partAttachOffset(part, bone, at) {
    const dir = at || part.attach.at;
    // Pinta lasketaan KOHTELUUN omasta bounding boxista, ei koko mallista:
    // muuten jo aiemmin lisätyt osat (esim. sarvet päässä) nostaisivat
    // seuraavan osan väärälle korkeudelle (selkäpiikit leijuivat ilmassa).
    // Jos luulla ei ole kuutioita, pudotaan koko mallin bboxiin.
    const boneBox = boneCubeBBox(bone);
    const hasCubes = Number.isFinite(boneBox.mn[0]);
    const g = hasCubes ? boneBox : modelBBox();
    const p = bone.pivot;
    switch (dir) {
        case 'bottom': return [0, g.mn[1] - p[1], 0];
        case 'top': return [0, g.mx[1] - p[1], 0];
        case 'front': return [0, 0, g.mn[2] - p[2]];
        case 'back': return [0, 0, g.mx[2] - p[2]];
        case 'side': return [g.mx[0] - p[0], (g.mn[1] + g.mx[1]) / 2 - p[1], (g.mn[2] + g.mx[2]) / 2 - p[2]];
        default: return [0, 0, 0];
    }
}

/** Pakkaa uusien kuutioiden UV:t vapaaseen tekstuuritilaan (16px ruudukko) ja kasvattaa tekstuuria tarvittaessa. */
function packPartUVs(newCubes) {
    const per = Math.max(1, Math.floor(state.model.textureWidth / 16));
    let maxSlot = 0;
    for (const bone of state.model.bones) {
        for (const c of bone.cubes) {
            if (newCubes.includes(c)) continue;
            const off = (c.uv && c.uv.offset) || [0, 0];
            const slot = Math.floor(off[1] / 16) * per + Math.floor(off[0] / 16);
            maxSlot = Math.max(maxSlot, slot + 1);
        }
    }
    for (const c of newCubes) {
        const slot = maxSlot++;
        c.uv.offset = [(slot % per) * 16, Math.floor(slot / per) * 16];
    }
    let needW = state.model.textureWidth, needH = state.model.textureHeight;
    for (const c of newCubes) {
        needW = Math.max(needW, c.uv.offset[0] + c.size[0]);
        needH = Math.max(needH, c.uv.offset[1] + c.size[1]);
    }
    const newW = Math.max(state.model.textureWidth, Math.ceil(needW / 16) * 16);
    const newH = Math.max(state.model.textureHeight, Math.ceil(needH / 16) * 16);
    if (newW !== state.model.textureWidth || newH !== state.model.textureHeight) {
        state.model.textureWidth = newW;
        state.model.textureHeight = newH;
        if (state.textureCanvas) {
            // Kasvata kanvaasia kopioimalla vanha kuva — valokuvatekstuurit säilyvät
            const old = state.textureCanvas;
            const c = document.createElement('canvas');
            c.width = newW; c.height = newH;
            const tctx = c.getContext('2d');
            tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, newW, newH);
            tctx.drawImage(old, 0, 0);
            state.textureCanvas = c;
            state.texture = makeTextureFromCanvas(c);
        }
    }
}

/** Maalaa uusien osakuutioiden pinnat olemassa olevaan tekstuurikanvaasiin. */
function repaintPartFaces(newCubes) {
    const c = state.textureCanvas;
    if (!c) return; // kanvaasi uusitaan rebuildin ensureTexture():ssa väreistä
    const tctx = c.getContext('2d');
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            if (!newCubes.includes(cube) || !cube.color) continue;
            fillCubeFaces(tctx, cube, cube.color);
        }
    }
    if (state.texture) state.texture.needsUpdate = true;
}

/** Osan omien kuutioiden koko (x/y/z) — käytetään 2×2-ruudukon rivivälinä. */
function partBBoxSize(part) {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of part.bones) for (const c of b.cubes) {
        for (let i = 0; i < 3; i++) {
            mn[i] = Math.min(mn[i], c.origin[i]);
            mx[i] = Math.max(mx[i], c.origin[i] + c.size[i]);
        }
    }
    return [0, 1, 2].map(i => (Number.isFinite(mn[i]) ? Math.max(1, mx[i] - mn[i]) : 1));
}

/** 2×2-ruudukon toissijainen akseli pinnan suuntaan nähden (0=x, 1=y, 2=z). */
function surfaceSecondaryAxis(at) {
    if (at === 'top' || at === 'bottom') return 2; // pinta vaakatasossa → rivit eteen/taakse
    return 1; // front/back/side → rivit ylös/alas
}

/**
 * Lisää Spore-tyylisen osan malliin.
 * opts: { boneName, at, copies (1|2|4), mirror (vanha: boolean, yhteensopivuus),
 *         color (koko osan väri), noHistory (ei pushia historiaan) }
 * Kopiot: 1 = yksittäinen, 2 = peilipari, 4 = 2×2-ruudukko (Spore-klusterit).
 * Jokainen kopio on oma juuriluu; partGroup-merkintä listaa kaikki kopiot
 * (poisto ja editointi partSides():n kautta toimivat kaikille).
 */
function addPartToModel(partId, opts = {}) {
    const part = MOB_PARTS.find(p => p.id === partId);
    if (!part) {        setStatus('Osaa ei löytynyt: ' + partId); return; }
    const target = findPartAttachBone(part, opts);
    if (!target) { setStatus('Ei luuta johon kiinnittää — aloita pohjasta (esim. Humanoid)'); return; }
    const at = opts.at || part.attach.at;
    const off = partAttachOffset(part, target, at);
    // Kopioiden määrä: 1 / 2 (peilipari) / 4 (2×2). Epäsymmetriset → aina 1.
    let copies = part.symmetric === false ? 1 : (opts.copies || (opts.mirror !== false && !!part.symmetric ? 2 : 1));
    if (copies !== 1 && copies !== 2 && copies !== 4) copies = 2;
    const grid = copies === 4;

    if (!opts.noHistory) state.history.push(state.model);
    const newCubes = [];
    const groupRoots = []; // kaikkien kopioiden juurinimet (partGroup)

    // 2×2: toisen rivin siirtymä pinnan toissijaista akselia pitkin (osa ei
    // mene päällekkäin — väli = osan koko + 0.5).
    let rowOff = [0, 0, 0];
    if (grid) {
        const partSize = partBBoxSize(part);
        const sec = surfaceSecondaryAxis(at);
        rowOff[sec] = partSize[sec] + 0.5;
    }

    const addSide = (flipX, rowOffset) => {
        const suffix = partCounter++;
        let prevName = null;
        let rootName = null;
        for (let pi = 0; pi < part.bones.length; pi++) {
            const pb = part.bones[pi];
            // Ensimmäinen luu on osan juuri (nimi = instanssin nimi); lisäluut
            // saavat yksilöllisen liitteen, jotta hierarkia toimii luotettavasti
            // (ennen kaikki luut saivat saman nimen ja lapsi viittasi itseensä).
            const boneName = pi === 0
                ? `${part.id}_${suffix}${flipX ? 'm' : ''}`
                : `${part.id}_${suffix}${flipX ? 'm' : ''}_${pi}`;
            if (pi === 0) rootName = boneName;
            // Peilaus kääntää VAIN x-akselin — y/z pysyvät samoina
            const pivot = pb.pivot.map((v, i) => (flipX && i === 0 ? -1 : 1) * (target.pivot[i] + off[i] + rowOffset[i] + v));
            const boneData = {
                name: boneName,
                pivot,
                rotation: flipX ? mirrorRotationDeg(pb.rotation) : pb.rotation.slice(),
                cubes: [],
                parent: prevName || target.name
            };
            for (const pc of pb.cubes) {
                const origin = pc.origin.map((v, i) => (flipX && i === 0 ? -1 : 1) * (target.pivot[i] + off[i] + rowOffset[i] + v));
                boneData.cubes.push({
                    name: `${pc.name}_${suffix}${flipX ? 'm' : ''}`,
                    origin: flipX ? [-(origin[0] + pc.size[0]), origin[1], origin[2]] : origin,
                    size: pc.size.slice(),
                    rotation: flipX ? mirrorRotationDeg(pc.rotation) : pc.rotation.slice(),
                    uv: { offset: [0, 0] },
                    color: opts.color || pc.color
                });
            }
            newCubes.push(...boneData.cubes);
            state.model.bones.push(boneData);
            prevName = boneName;
        }
        groupRoots.push(rootName);
    };

    // Kopiot: 1 = yksittäinen, 2 = peilipari, 4 = 2×2 (kaksi peiliparia,
    // toinen rivi siirrettynä pinnan suuntaisesti).
    addSide(false, [0, 0, 0]);
    if (copies >= 2) addSide(true, [0, 0, 0]);
    if (grid) { addSide(false, rowOff); addSide(true, rowOff); }

    // partGroup: jokainen juuriluu tietää kaikki kopionsa (editointi + poisto).
    // partPair säilyy vierekkäiselle peilille (vanhat tallennukset / fallback).
    for (let i = 0; i < groupRoots.length; i++) {
        const root = state.model.bones.find(b => b.name === groupRoots[i]);
        if (!root) continue;
        root.partGroup = groupRoots.slice();
        if (copies >= 2 && (i % 2 === 1)) {
            const mate = groupRoots[i - 1];
            root.partPair = mate;
            const mateBone = state.model.bones.find(b => b.name === mate);
            if (mateBone && !mateBone.partPair) mateBone.partPair = root.name;
        }
    }

    packPartUVs(newCubes);
    repaintPartFaces(newCubes);
    deselectAll(); // vanha valinta viittaisi poistettuun meshiin rebuildin jälkeen
    rebuildModel();
    scheduleAutosave();
    setStatus(`Kiinnitettiin ${part.name} (${copies === 1 ? 'yksi' : copies + ' kappaletta'}) → ${target.name}`);
}

// ==================== 🎲 RANDOMIZE (Spore) ====================
// Rakentaa satunnaisen olennon Spore-osista: satunnainen luu, pinta,
// peilaus ja väri joka osalle — Sporen luontieditorin hengessä.

const RANDOM_CREATURE_NAMES = [
    'Goblin', 'Spark', 'Troll', 'Goblinfish', 'Beaktail', 'Shaggysnout',
    'Stareye', 'Thunderbeast', 'Forest Spirit', 'Bog Ghost', 'Stonefish',
    'Firefox', 'Frost Fiend', 'Storm Horse', 'Bellpaw', 'Frostback',
    'Marsh Wader', 'Thornheart', 'Shadow Belly', 'Fluffy Ear'
];

/**
 * 🎲 Randomize — rakentaa satunnaisen olennon: 6-luinen humanoidipohja
 * yhtenäisellä väripaletilla + suunniteltu osakokonaisuus (jalkapari,
 * häntä, pää ja valinnaisesti siivet/kädet/koristeet). Jokainen osa
 * kiinnittyy omaan luonnolliseen luuhunsa ja oletuspintaansa (ei
 * satunnaisia pintoja/luita — ne tekivät olennoista sekavia), peilaus
 * symmetrisille 90 % ajasta ja väri otetaan vartalon paletista (ei
 * satunnaisia sävyjä). Yksi undo palauttaa edellisen mallin (osat
 * lisätään noHistory-optiolla).
 */

/**
 * Muunna yksiluinen template-malli (kaikki kuutiot yhdessä body-luussa)
 * moniluuiseksi: jokainen kuutio omaan luuhunsa, pivot = kuution
 * keskipiste. Renderöinti pysyy identtisenä (mesh.position lasketaan
 * origin + size/2 − pivot), mutta osat voivat kiinnittyä oikeisiin
 * luihin (head/body/legs) ja animaatiogenerointi tunnistaa raajat.
 */
function splitTemplateIntoSkeleton(model) {
    const out = JSON.parse(JSON.stringify(model));
    out.bones = [];
    for (const bone of model.bones) {
        for (const cube of bone.cubes) {
            out.bones.push({
                name: cube.name,
                pivot: [
                    cube.origin[0] + cube.size[0] / 2,
                    cube.origin[1] + cube.size[1] / 2,
                    cube.origin[2] + cube.size[2] / 2
                ],
                rotation: [0, 0, 0],
                cubes: [JSON.parse(JSON.stringify(cube))]
            });
        }
    }
    return out;
}

function randomizeCreature() {
    // Pohja: satunnainen template (Humanoid/Quadruped/Bird/Fish/Spider).
    // MOB_TEMPLATES-pohjat ovat yksiluisia, joten ne jaetaan moniluuiseksi
    // luurangoksi — osien kiinnitys ja animaatiot vaativat erilliset luut.
    const tpl = MOB_TEMPLATES[Math.floor(Math.random() * MOB_TEMPLATES.length)];
    if (!tpl) { setStatus('Ei pohjia löytynyt'); return; }
    // Jaetaan aina moniluuiseksi — myös spider-pohja (2 luuta, joissa useita
    // kuutioita) saa jokaiselle kuutiolle oman luun, jotta osat kiinnittyvät
    // oikeisiin luihin eivätkä kaikki body-luuhun.
    state.history.push(state.model);
    state.model = JSON.parse(JSON.stringify(splitTemplateIntoSkeleton(tpl.model)));
    state.projectName = RANDOM_CREATURE_NAMES[Math.floor(Math.random() * RANDOM_CREATURE_NAMES.length)];
    state.model.modelId = slugifyModelId(state.projectName);
    state.sourceCategory = 'template';
    state.texture = null;
    state.textureCanvas = null;
    state.textureDataURL = null;
    state.emissiveTexture = null;
    state.emissiveDataURL = null;
    state.projectAnimations = {};
    state.currentAnimName = null;
    const sel = document.getElementById('anim-select');
    if (sel) { sel.innerHTML = ''; sel.style.display = 'none'; }

    // Yhtenäinen perusväripaletti: vartalo + vaaleampi pää + tummemmat raajat.
    // Kaikki kuutiot saavat palettivärin — myös template-pohjien siivet,
    // hännät ja evät (wing/tail/fin), etteivät ne jää erivärisiksi täpliksi.
    const h = Math.random() * 360;
    const s = 0.45 + Math.random() * 0.30;
    const l = 0.38 + Math.random() * 0.22;
    const col = (dl, ds = 0) => hslToHex(h, Math.min(0.90, Math.max(0.15, s + ds)), Math.min(0.80, Math.max(0.15, l + dl)));
    const bodyColor = col(0), headColor = col(8), armColor = col(-8), legColor = col(-14, 5);
    const wingColor = col(-4), tailColor = col(-10);
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            if (cube.name === 'head' || /skull|jaw|beak|comb/.test(cube.name)) cube.color = headColor;
            else if (/arm|hand|claw/.test(cube.name)) cube.color = armColor;
            else if (/leg|foot|thigh|hoof/.test(cube.name)) cube.color = legColor;
            else if (/wing/.test(cube.name)) cube.color = wingColor;
            else if (/tail|fin|tentacle|stinger/.test(cube.name)) cube.color = tailColor;
            else if (/body|chest|torso|abdomen|belly|hips|main|neck/.test(cube.name)) cube.color = bodyColor;
            else cube.color = bodyColor;
        }
    }

    // Kategoriasuunnitelma pohjan mukaan. Humanoid/Quadruped/Bird saavat
    // jalkaparin + hännän; Fish ei saa jalkoja (uintianimaatio vaatii että
    // jalkoja ei ole, ja kalaan jalat näyttävät rumilta) vaan evät + pään;
    // Spider ei saa jalkoja (8 jo olemassa) vaan pään + selkäkoristeet.
    // Pääosat kiinnittyvät omaan luuhunsa ja oletuspintaansa — satunnaiset
    // pinnat/luut tekivät olennoista epäluonnollisia (sarvet alaspäin jne.).
    const byCat = (cat) => MOB_PARTS.filter(p => p.category === cat);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const heads = byCat('päät');
    const topHeads = heads.filter(p => p.attach.at === 'top');
    const frontHeads = heads.filter(p => p.attach.at === 'front');
    const fishBase = tpl.id === 'fish';
    const spiderBase = tpl.id === 'spider';
    const plan = [];
    if (!fishBase && !spiderBase) {
        plan.push(pick(byCat('jalat')), pick(byCat('hännät')));
    } else if (fishBase) {
        const fins = byCat('siivet').filter(p => p.id === 'fin');
        if (fins.length && Math.random() < 0.6) plan.push(pick(fins)); // evät
    } else {
        if (Math.random() < 0.5) plan.push(pick(byCat('hännät')));
    }
    if (topHeads.length && Math.random() < 0.7) plan.push(pick(topHeads));
    if (frontHeads.length && Math.random() < 0.6) plan.push(pick(frontHeads));
    if (!fishBase && !spiderBase && Math.random() < 0.5) plan.push(pick(byCat('siivet')));
    if (!spiderBase && Math.random() < 0.4) plan.push(pick(byCat('kädet')));
    if (Math.random() < 0.35) plan.push(pick(byCat('muut')));

    // Väri osan kategorian mukaan — vartalon paletista, ei satunnaisesta sävystä
    const partColor = (cat) => {
        if (cat === 'jalat') return legColor;
        if (cat === 'päät') return headColor;
        if (cat === 'hännät') return col(-6);
        if (cat === 'siivet') return col(-4);
        if (cat === 'kädet') return armColor;
        return col(-2);
    };

    let attached = 0;
    for (const part of plan) {
        const natural = findPartAttachBone(part, {});
        if (!natural) continue;
        // Jalat ja siivet peilataan aina (yksipuolinen jalka näyttää rumalta),
        // koristeet (sarvet, korvat) usein mutta eivät aina. 2×2-klusterit:
        // päät/koristeet (sarvet, korvat, piikit) saavat joskus neljä kopiota
        // Spore-tyyliin.
        const alwaysPair = part.category === 'jalat' || part.category === 'siivet';
        let copies = part.symmetric === false ? 1 : 2;
        if (!alwaysPair && (part.category === 'päät' || part.category === 'muut') && Math.random() < 0.3) copies = 4;
        addPartToModel(part.id, {
            boneName: natural.name,
            at: part.attach.at,
            copies,
            color: partColor(part.category),
            noHistory: true
        });
        attached++;
    }

    deselectAll();
    rebuildModel();
    // Satunnaiset mutta vakaat tekstuurikuviot (raidat/täplät) perusvärin päälle
    const patterned = applyRandomTexturePatterns();
    // Satunnainen emissiivinen valonhehku (~35 % olennoista hehkuu)
    const glow = generateRandomGlow();
    const tmp = prepareMob({ category: 'template', model: JSON.parse(JSON.stringify(state.model)) });
    const cubes = state.model.bones.reduce((n, b) => n + b.cubes.length, 0);
    // Olento herää heti eloon: generoi kävely/idle-animaatiot luurangosta
    // (sama 🕺 Auto -logiikka kuin nappia painamalla)
    generateAutoAnimations();
    const animNames = Object.keys(state.projectAnimations || {});
    fitCameraToMob({ fit: computeModelFit(state.model) });
    applyGamePreviewDefault();
    updateProjectNameLabel();
    scheduleAutosave();
    setStatus(`Satunnaistus: "${state.projectName}" — ${attached} osaa, ${state.model.bones.length} luuta, ${cubes} kuutiota, ${tmp.size} lohkoa, ${patterned} kuviotettua kuutiota, ${glow ? 'hehkuu, ' : ''}animaatiot: ${animNames.join(', ') || 'ei yhtään'}. Kumoa (⌘Z) palauttaa edellisen mallin — satunnaista uudelleen milloin vain.`);
}

function deleteSelected() {
    // Spore-osa: Delete poistaa koko osan (kaikki kopiot — peiliparit ja 2×2)
    if (state.selectedPart) {
        state.history.push(state.model);
        const inst = state.selectedPart;
        const names = new Set(inst.bones.map(b => b.name));
        // partGroup (uudet kiinnitykset): kaikki kopiot suoraan merkinnästä.
        // Fallback: partPair / geometrinen vastine (vanhat tallennukset).
        const group = (inst.root && inst.root.partGroup) || null;
        if (group && group.length > 1) {
            for (const rn of group) {
                const bones = state.model.bones.filter(b =>
                    b.name === rn || (b.name.length > rn.length + 1 && b.name.startsWith(rn + '_'))
                );
                for (const b of bones) names.add(b.name);
            }
        } else {
            let pairBones = [];
            if (inst.root && inst.root.partPair) {
                const p = inst.root.partPair;
                pairBones = state.model.bones.filter(b => b.name === p || (b.name.length > p.length + 1 && b.name.startsWith(p + '_')));
            } else {
                const myCounter = parseInt(inst.key.split('_').pop().replace(/m$/, ''), 10);
                for (const b of state.model.bones) {
                    if (names.has(b.name)) continue;
                    const oi = getPartInstanceForBone(b);
                    if (!oi || oi.id !== inst.id || oi.key === inst.key) continue;
                    const oc = parseInt(oi.key.split('_').pop().replace(/m$/, ''), 10);
                    if (Math.abs(oc - myCounter) !== 1) continue;
                    const rp = inst.root.pivot, op = oi.root.pivot;
                    if (Math.abs(op[0] + rp[0]) < 0.6 && Math.abs(op[1] - rp[1]) < 0.6 && Math.abs(op[2] - rp[2]) < 0.6) {
                        pairBones = oi.bones;
                        break;
                    }
                }
            }
            for (const pb of pairBones) names.add(pb.name);
        }
        state.model.bones = state.model.bones.filter(b => !names.has(b.name));
        deselectAll();
        rebuildModel();
        scheduleAutosave();
        setStatus('Osa poistettu' + (names.size > inst.bones.length ? ` (${names.size / inst.bones.length} kopiota poistettu)` : ''));
        return;
    }
    const multiIdx = (state.selectedCubes && state.selectedCubes.length) ? state.selectedCubes : null;
    if (state.selectedCube !== null) {
        state.history.push(state.model);
        const targets = multiIdx ? multiIdx : [state.selectedCube];
        const byBone = new Map(); // boneData → [cubeData]
        for (const idx of targets) {
            const cd = findCubeData(idx);
            const bd = findBoneForCube(idx);
            if (!cd || !bd) continue;
            if (!byBone.has(bd)) byBone.set(bd, []);
            byBone.get(bd).push(cd);
        }
        for (const [boneData, cds] of byBone) {
            for (const cd of cds) {
                const cubeLocalIdx = boneData.cubes.indexOf(cd);
                if (cubeLocalIdx !== -1) boneData.cubes.splice(cubeLocalIdx, 1);
            }
        }
        deselectAll();
        rebuildModel();
        scheduleAutosave();
        setStatus(targets.length > 1 ? `${targets.length} kuutiota poistettu` : 'Kuutio poistettu');
    } else if (state.selectedBone !== null) {
        state.history.push(state.model);
        if (state.model.bones.length > 1) {
            state.model.bones.splice(state.selectedBone, 1);
            deselectAll();
            rebuildModel();
            scheduleAutosave();
            setStatus('Luu poistettu');
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
        const isPart = getPartInstanceForBone(bone);
        const partSel = isPart && state.selectedPart && isPart.key === state.selectedPart.key;
        item.className = 'bone-item' + (state.selectedBone === i ? ' selected' : '')
            + (partSel ? ' part-selected' : '');
        item.innerHTML = `
            <span class="bone-icon">${isPart
                ? '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="8" height="8" rx="1"/><path d="M6 2v8M2 6h8"/></svg>'
                : '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><path d="M4.4 4.4l3.2 3.2M7.6 4.4l-3.2 3.2"/></svg>'}</span>
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
                    scheduleAutosave();
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
                <span class="bone-icon"><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 1.5 10.5 4v4L6 10.5 1.5 8V4z"/><path d="M1.5 4 6 6.5 10.5 4"/><path d="M6 6.5V10.5"/></svg></span>
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
    // Materiaali: näytä valitun kuution arvot (monivalinnassa ensimmäisen)
    const opacity = (typeof cubeData.opacity === 'number') ? cubeData.opacity : 1;
    const emissive = (typeof cubeData.emissive === 'number') ? cubeData.emissive : 0;
    const oInp = document.getElementById('prop-opacity');
    const oNum = document.getElementById('prop-opacity-num');
    if (oInp) oInp.value = opacity;
    if (oNum) oNum.value = opacity;
    const eInp = document.getElementById('prop-emissive');
    const eNum = document.getElementById('prop-emissive-num');
    if (eInp) eInp.value = emissive;
    if (eNum) eNum.value = emissive;
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
        const sf = [Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z)];
        cubeData.size[0] = Math.max(0.25, Math.round(Math.abs(cubeData.size[0] * sf[0]) * 100) / 100);
        cubeData.size[1] = Math.max(0.25, Math.round(Math.abs(cubeData.size[1] * sf[1]) * 100) / 100);
        cubeData.size[2] = Math.max(0.25, Math.round(Math.abs(cubeData.size[2] * sf[2]) * 100) / 100);
        // uvSize on kuution tekstuurisaarekkeen pikselikoko (Deep Void -mobeilla
        // = size × 10). Kun koko muuttuu, uvSize on skaalattava samalla kertoimella
        // että tekstuurin pikselitiheys pysyy: muuten rectit jäävät vanhoiksi ja
        // tekstuuri venyy kuutiota suurennettaessa (mobeissa ilman uvSize:aa
        // computeFaceRects käyttää size:ä, joten ne skaalautuvat jo oikein).
        if (cubeData.uvSize) {
            cubeData.uvSize[0] = Math.round(Math.max(1, cubeData.uvSize[0] * sf[0]) * 10) / 10;
            cubeData.uvSize[1] = Math.round(Math.max(1, cubeData.uvSize[1] * sf[1]) * 10) / 10;
            cubeData.uvSize[2] = Math.round(Math.max(1, cubeData.uvSize[2] * sf[2]) * 10) / 10;
        }
        const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
        applyBoxTextureUVs(geo, cubeData, state.model.textureWidth, state.model.textureHeight);
        mesh.geometry.dispose();
        mesh.geometry = geo;
        mesh.scale.set(1, 1, 1);
    }

    // Update cube data from mesh LOCAL position — mesh on keskipisteessä
    // LUUN avaruudessa, origin on alakulma luun koordinaatistossa:
    // origin = mesh.position − koko/2 + luun pivot. Maailmapositiota EI voi
    // käyttää: se sisältää vanhempaluun asennon (animaatio tai lepopositio),
    // jolloin dataan kirjoittuisi väärä origin ja render-varoitustarkistus
    // (rest-asennossa) näyttäisi virheen. Pyöristys 3 desimaaliin.
    cubeData.origin[0] = Math.round((mesh.position.x + boneData.pivot[0] - cubeData.size[0] / 2) * 1000) / 1000;
    cubeData.origin[1] = Math.round((mesh.position.y + boneData.pivot[1] - cubeData.size[1] / 2) * 1000) / 1000;
    cubeData.origin[2] = Math.round((mesh.position.z + boneData.pivot[2] - cubeData.size[2] / 2) * 1000) / 1000;

    cubeData.rotation[0] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.x));
    cubeData.rotation[1] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.y));
    cubeData.rotation[2] = Math.round(THREE.MathUtils.radToDeg(mesh.rotation.z));

    showProperties(cubeData, boneData);
    if (state.uvEditor) state.uvEditor.draw(); // koon muutos päivittää kasvojen rectit
}

/**
 * Monivalinta-gizmo: kohdista focus-kuution muutos (siirto/kierto/skaalaus)
 * myös muihin valittuihin kuutioihin. Tilannekuva otetaan raahauksen alussa
 * (dragging-changed → multiDrag). Muunnokset tehdään maailma-avaruudessa ja
 * käännetään kunkin kuution oman luun paikalliseen avaruuteen, joten eri
 * luissa olevat kuutiot liikkuvat yhdessä oikein.
 */
function applyMultiTransform(obj) {
    if (!multiDrag || multiDrag.focusMesh !== obj) return;
    const m = multiDrag;
    const setOrigin = (o, local) => {
        o.cubeData.origin[0] = Math.round((local.x + o.boneData.pivot[0] - o.cubeData.size[0] / 2) * 1000) / 1000;
        o.cubeData.origin[1] = Math.round((local.y + o.boneData.pivot[1] - o.cubeData.size[1] / 2) * 1000) / 1000;
        o.cubeData.origin[2] = Math.round((local.z + o.boneData.pivot[2] - o.cubeData.size[2] / 2) * 1000) / 1000;
    };
    if (m.mode === 'translate') {
        const delta = obj.getWorldPosition(new THREE.Vector3()).sub(m.startFocusWorld);
        const tmp = new THREE.Vector3();
        for (const o of m.others) {
            const local = o.group.worldToLocal(tmp.copy(o.startWorld).add(delta));
            o.mesh.position.copy(local);
            setOrigin(o, local);
        }
    } else if (m.mode === 'scale') {
        const sf = [Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z)];
        for (const o of m.others) {
            o.cubeData.size[0] = Math.max(0.25, Math.round(Math.abs(o.cubeData.size[0] * sf[0]) * 100) / 100);
            o.cubeData.size[1] = Math.max(0.25, Math.round(Math.abs(o.cubeData.size[1] * sf[1]) * 100) / 100);
            o.cubeData.size[2] = Math.max(0.25, Math.round(Math.abs(o.cubeData.size[2] * sf[2]) * 100) / 100);
            if (o.cubeData.uvSize) {
                o.cubeData.uvSize[0] = Math.round(Math.max(1, o.cubeData.uvSize[0] * sf[0]) * 10) / 10;
                o.cubeData.uvSize[1] = Math.round(Math.max(1, o.cubeData.uvSize[1] * sf[1]) * 10) / 10;
                o.cubeData.uvSize[2] = Math.round(Math.max(1, o.cubeData.uvSize[2] * sf[2]) * 10) / 10;
            }
            updateCubeMeshInPlace(o.idx);
        }
    } else if (m.mode === 'rotate') {
        const dq = new THREE.Quaternion();
        obj.getWorldQuaternion(dq).multiply(m.startFocusQuat.clone().invert());
        const tmp = new THREE.Vector3();
        const q = new THREE.Quaternion();
        for (const o of m.others) {
            // Kierto gizmon keskipisteen ympäri (maailma-avaruudessa)
            tmp.copy(o.startWorld).sub(m.pivot).applyQuaternion(dq).add(m.pivot);
            const local = o.group.worldToLocal(tmp);
            o.mesh.position.copy(local);
            setOrigin(o, local);
            // Sama kiertodelta luun paikallisessa avaruudessa
            const boneQuat = o.group.getWorldQuaternion(new THREE.Quaternion());
            const dqLocal = boneQuat.clone().invert().multiply(dq).multiply(boneQuat);
            q.setFromEuler(o.mesh.rotation).premultiply(dqLocal);
            o.mesh.rotation.setFromQuaternion(q);
            o.cubeData.rotation[0] = Math.round(THREE.MathUtils.radToDeg(o.mesh.rotation.x));
            o.cubeData.rotation[1] = Math.round(THREE.MathUtils.radToDeg(o.mesh.rotation.y));
            o.cubeData.rotation[2] = Math.round(THREE.MathUtils.radToDeg(o.mesh.rotation.z));
        }
    }
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
            `${offenders.length} cubes render incorrectly — the 3D view and data differ by more than 0.01: ${first}${offenders.length > 3 ? '…' : ''}`;
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
        setStatus(`${cubeData ? cubeData.name : 'kuutio'} valittu — tarkista sen sijainti/koko`);
    }
});

// ==================== PROPERTY INPUT HANDLERS ====================
function setupPropertyInputs() {
    // Kokokentän asetus säilyttää tekstuurin pikselitiheyden: uvSize (Deep Void
    // -saarekkeen pikselikoko, = size × 10) skaalataan samassa suhteessa kuin
    // size, jotta UV-rectit pysyvät yhtä suurina kuin geometria (muuten
    // tekstuuri venyy kun kuutiota suurennetaan). Kuutioilla ilman uvSize:aa
    // computeFaceRects käyttää size:ä ja skaalautuu jo automaattisesti.
    function setSizeAxis(cd, i, v) {
        const n = parseFloat(v);
        if (!isFinite(n) || !cd.size[i]) return;
        const newVal = Math.max(0.25, n);
        const sf = newVal / cd.size[i];
        cd.size[i] = newVal;
        if (cd.uvSize && sf > 0) {
            cd.uvSize[i] = Math.round(Math.max(1, cd.uvSize[i] * sf) * 10) / 10;
        }
    }
    const props = {
        'prop-pos-x': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.origin[0] = n; },
        'prop-pos-y': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.origin[1] = n; },
        'prop-pos-z': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.origin[2] = n; },
        'prop-rot-x': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.rotation[0] = n; },
        'prop-rot-y': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.rotation[1] = n; },
        'prop-rot-z': (v, cd) => { const n = parseFloat(v); if (isFinite(n)) cd.rotation[2] = n; },
        'prop-size-x': (v, cd) => setSizeAxis(cd, 0, v),
        'prop-size-y': (v, cd) => setSizeAxis(cd, 1, v),
        'prop-size-z': (v, cd) => setSizeAxis(cd, 2, v),
        'prop-name': (v, cd) => cd.name = v,
    };

    /** Kaikki valitut kuutiot (monivalinta tai yksittäinen). */
    function selectedCubeDatas() {
        const list = [];
        if (state.selectedCubes && state.selectedCubes.length) {
            for (const idx of state.selectedCubes) {
                const cd = findCubeData(idx);
                if (cd) list.push(cd);
            }
        } else if (state.selectedCube !== null) {
            const cd = findCubeData(state.selectedCube);
            if (cd) list.push(cd);
        }
        return list;
    }

    for (const [id, setter] of Object.entries(props)) {
        document.getElementById(id).addEventListener('change', (e) => {
            if (state.selectedCube === null && !(state.selectedCubes && state.selectedCubes.length)) return;
            state.history.push(state.model);
            const datas = selectedCubeDatas();
            for (const cd of datas) setter(e.target.value, cd);
            rebuildModel();
            // Kiinnitä gizmo uudelleen uuteen mesh-objektiin samalla indeksillä
            const focusIdx = (state.selectedCubes && state.selectedCubes.length) ? state.selectedCubes[0] : state.selectedCube;
            if (focusIdx !== null && state.cubes[focusIdx]) {
                transformControls.attach(state.cubes[focusIdx]);
            } else if (state.selectedBone !== null && state.bones[state.selectedBone]) {
                transformControls.attach(state.bones[state.selectedBone]);
            }
            scheduleAutosave();
        });
    }

    // Cube color — refills the cube's face regions on the texture so the
    // color change is immediately visible in both UV editor and 3D view.
    document.getElementById('prop-color').addEventListener('input', (e) => {
        if (state.selectedCube === null && !(state.selectedCubes && state.selectedCubes.length)) return;
        const datas = selectedCubeDatas();
        for (const cubeData of datas) {
            cubeData.color = e.target.value;
            ensureTexture();
            fillCubeFaces(state.textureCanvas.getContext('2d'), cubeData, cubeData.color);
        }
        state.texture.needsUpdate = true;
        if (state.uvEditor) state.uvEditor.draw();
        scheduleAutosave();
    });

    // Materiaali: läpinäkyvyys (opacity) + hehku (emissive) — live-päivitys
    function bindMaterialInput(rangeId, numId, apply) {
        const range = document.getElementById(rangeId);
        const num = document.getElementById(numId);
        if (!range || !num) return;
        const commit = () => {
            if (state.selectedCube === null && !(state.selectedCubes && state.selectedCubes.length)) return;
            state.history.push(state.model);
            const v = parseFloat(range.value);
            for (const cd of selectedCubeDatas()) apply(cd, v);
            num.value = v;
            rebuildModel();
            scheduleAutosave();
        };
        range.addEventListener('input', () => {
            num.value = range.value;
            const v = parseFloat(range.value);
            for (const cd of selectedCubeDatas()) apply(cd, v);
            if (state.uvEditor) state.uvEditor.draw();
            rebuildModel();
            scheduleAutosave();
        });
        range.addEventListener('change', commit);
        num.addEventListener('change', () => {
            const v = Math.max(parseFloat(num.value) || 0, 0.05);
            range.value = v;
            commit();
        });
    }
    bindMaterialInput('prop-opacity', 'prop-opacity-num', (cd, v) => { cd.opacity = Math.max(0.05, Math.min(1, v)); });
    bindMaterialInput('prop-emissive', 'prop-emissive-num', (cd, v) => { cd.emissive = Math.max(0, Math.min(3, v)); });
}

// ==================== LOCATORS (Blockbench-puoli) ====================
// Kiinnityspisteet esineille/partikkeleille (esim. talutin, kädessä
// pidettävä esine). Tallennetaan model.locators: [{ name, bone, position }]
// ja viedään Bedrock-geometriaan per-luu `locators`-kenttään sekä
// bbmodel-outlineriin locator-solmuina.
function setupLocatorPanel() {
    const list = document.getElementById('locator-list');
    const addBtn = document.getElementById('btn-add-locator');
    if (!list || !addBtn) return;

    addBtn.addEventListener('click', () => {
        state.history.push(state.model);
        if (!Array.isArray(state.model.locators)) state.model.locators = [];
        const bone = state.selectedBone !== null ? state.model.bones[state.selectedBone] : state.model.bones[0];
        const pivot = bone ? bone.pivot : [0, 0, 0];
        const n = state.model.locators.length + 1;
        state.model.locators.push({
            name: `locator_${n}`,
            bone: bone ? bone.name : 'root',
            // Oletus: luun pivot + pieni etäisyys eteenpäin (z-akseli),
            // porrastettu sivusuunnassa jotta peräkkäiset eivät pinoudu
            position: [pivot[0] + ((n - 1) % 3) * 2 - 2, pivot[1] + 4, pivot[2] - 4]
        });
        rebuildModel();
        scheduleAutosave();
        setStatus(`Lisätty kiinnityspiste locator_${n} luuhun ${bone ? bone.name : '(juuri)'} — se seuraa luuta animaatioissa`);
    });

    // Piirrä lista heti (rebuildModel kutsuu renderLocatorListia jatkossa)
    renderLocatorList();
}

function renderLocatorList() {
    const list = document.getElementById('locator-list');
    if (!list) return;
    const locs = state.model.locators || [];
    list.querySelectorAll('.locator-row').forEach(el => el.remove());
    for (let i = 0; i < locs.length; i++) {
        const loc = locs[i];
        const row = document.createElement('div');
        row.className = 'locator-row';
        row.style.cssText = 'display:flex;align-items:center;gap:4px;background:#232833;border:1px solid #3a4356;border-radius:6px;padding:3px 6px';
        const name = document.createElement('input');
        name.type = 'text';
        name.value = loc.name;
        name.style.cssText = 'flex:1;min-width:0;background:transparent;border:none;color:#eee;font-size:12px';
        name.title = 'Locator name';
        name.addEventListener('change', () => {
            state.history.push(state.model);
            loc.name = name.value.trim() || loc.name;
            rebuildModel();
            scheduleAutosave();
        });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Delete locator';
        del.style.cssText = 'background:none;border:none;color:#f66;cursor:pointer;font-size:12px;padding:0 2px';
        del.addEventListener('click', () => {
            state.history.push(state.model);
            state.model.locators.splice(i, 1);
            rebuildModel();
            scheduleAutosave();
            renderLocatorList();
        });
        row.appendChild(name);
        row.appendChild(del);
        list.appendChild(row);
    }
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
    } else if (tool === 'paint' || tool === 'pipette' || tool === 'reshape' || tool === 'face') {
        transformControls.detach();
        canvas.style.cursor = tool === 'reshape' ? 'move' : 'crosshair';
        // Näkymän pysäytys: maalaus-/pipetti-/reshape-/face-tilassa kamera ei
        // kierrä/zoomaa/panoroi — malli pysyy täysin paikallaan.
        if (orbitControls) {
            orbitControls.enabled = false;
            orbitControls.mouseButtons.LEFT = null;
        }
        if (tool === 'reshape') {
            showReshapeHandles(true);
            setStatus('Muotoile — vedä kahvoja (vihreä = korkeus · punainen = leveys · sininen = pituus · keltainen keskus = siirto) tai vedä mallia: ylös/alas = korkeus · vasen/oikea = leveys · Shift = pituus');
        } else if (tool === 'face') {
            setStatus('Kasvojen yksityiskohdat — klikkaa silmä-/suu-/kuono-osaa ja vedä liu\'uttaaksesi sitä pään pinnalla');
        }
    } else {
        showReshapeHandles(false);
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

    // Test Creature -tila
    const testBtn = document.getElementById('btn-test');
    if (testBtn) testBtn.addEventListener('click', () => setTestMode(!state.testMode));

    document.getElementById('btn-add-cube').addEventListener('click', addCube);
    document.getElementById('btn-add-group').addEventListener('click', addBone);

    // ---- Add Element -kontekstivalikko ---------------------------------
    // Mirror Copy ja Symmetry ovat harvoin käytettyjä: ne on piilotettu
    // ⋯-napin ja oikean klikkauksen taakse, jotta näkyvät työkalut vähenevät.
    // Toiminta on täsmälleen sama kuin aikaisemmissa näkyvissä napeissa.
    const addCtx = document.getElementById('add-context-menu');
    const ctxMirror = document.getElementById('ctx-mirror-copy');
    const ctxSym = document.getElementById('ctx-symmetry');

    function toggleSymmetry() {
        state.symmetryEdit = !state.symmetryEdit;
        ctxSym.classList.toggle('active', state.symmetryEdit);
        ctxSym.title = state.symmetryEdit
            ? 'Symmetria päällä — muokkaa toista puolta, toinen peilautuu livenä (klikkaa sammuttaaksesi)'
            : 'Symmetry edit — edit one side (move/rotate/scale), the other mirrors live';
        setStatus(state.symmetryEdit
            ? 'Symmetria päällä — valitse kuutio tai luu kummalta puolelta tahansa, peilikuva seuraa livenä'
            : 'Symmetria pois');
    }

    function openAddContextMenu(x, y) {
        addCtx.hidden = false;
        const r = addCtx.getBoundingClientRect();
        addCtx.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
        addCtx.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
        ctxSym.classList.toggle('active', !!state.symmetryEdit);
    }
    function closeAddContextMenu() { addCtx.hidden = true; }

    // ⋯-nappi avaa valikon vasemmalla klikkauksella
    document.getElementById('btn-add-more').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openAddContextMenu(r.left, r.bottom + 4);
    });
    // Oikea klikkaus + Cube / + Bone/Group -nappiin avaa saman valikon
    document.getElementById('btn-add-cube').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openAddContextMenu(e.clientX, e.clientY);
    });
    document.getElementById('btn-add-group').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openAddContextMenu(e.clientX, e.clientY);
    });

    ctxMirror.addEventListener('click', () => { closeAddContextMenu(); mirrorCopy(); });
    ctxSym.addEventListener('click', () => { closeAddContextMenu(); toggleSymmetry(); });

    // Klikkaus valikon ulkopuolelle tai Escape sulkee
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#add-context-menu') && !e.target.closest('#btn-add-more')) {
            closeAddContextMenu();
        }
    });
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#add-context-menu')
            && !e.target.closest('#btn-add-cube')
            && !e.target.closest('#btn-add-group')) {
            closeAddContextMenu();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAddContextMenu();
    });

    // Peilattu maalaus -kytkin (🪞 UV-työkalupalkissa)
    const mirrorPaintBtn = document.getElementById('btn-mirror-paint');
    if (mirrorPaintBtn) {
        mirrorPaintBtn.addEventListener('click', () => {
            state.mirrorPaint = !state.mirrorPaint;
            mirrorPaintBtn.classList.toggle('active', state.mirrorPaint);
            mirrorPaintBtn.title = state.mirrorPaint
                ? 'Peilimaalaus päällä — maalaa myös peilikuva (klikkaa sammuttaaksesi)'
                : 'Mirror paint — also paint the mirror image on the opposite side';
            setStatus(state.mirrorPaint ? 'Peilattu maalaus päällä' : 'Peilattu maalaus pois');
        });
    }

    // Pattern body -painike: koherentti kuvio koko vartalolle yhdellä klikkauksella
    const patternBodyBtn = document.getElementById('btn-pattern-body');
    if (patternBodyBtn) {
        patternBodyBtn.addEventListener('click', () => {
            applyBodyPatterns();
        });
    }

    // Monivalinnan UV-työkalut: kohdistus, skaalaus ja peilaus useille kuutioille
    const uvAlignBtn = document.getElementById('btn-uv-align');
    if (uvAlignBtn) {
        uvAlignBtn.addEventListener('click', () => uvAlignSelected());
    }
    const uvScaleBtn = document.getElementById('btn-uv-scale');
    if (uvScaleBtn) {
        uvScaleBtn.addEventListener('click', (e) => uvScaleSelected(e.shiftKey ? 0.5 : 2));
    }
    const uvMirrorBtn = document.getElementById('btn-uv-mirror');
    if (uvMirrorBtn) {
        uvMirrorBtn.addEventListener('click', (e) => uvMirrorSelected(!!e.shiftKey));
    }

    // Display settings
    document.getElementById('chk-wireframe').addEventListener('change', (e) => {
        state.cubes.forEach(m => m.material.wireframe = e.target.checked);
    });

    document.getElementById('chk-grid').addEventListener('change', (e) => {
        if (!state.gamePreview) gridHelper.visible = e.target.checked;
    });

    document.getElementById('bg-color').addEventListener('input', (e) => {
        if (renderer && !state.gamePreview) renderer.setClearColor(e.target.value);
    });

    // 🎮 Game Preview — pelin näköinen esikatselu: Minecraft-valaistus,
    // pehmeät varjot ja glow-kerros ennen paketin latausta.
    const gamePreviewChk = document.getElementById('chk-game-preview');
    if (gamePreviewChk) {
        gamePreviewChk.addEventListener('change', (e) => {
            // Käyttäjän valinta on uusi oletus: kun käyttäjä sammuttaa
            // Game Previewin, se pysyy pois seuraavillakin mobin latauksilla
            // (kunnes käyttäjä laittaa sen uudelleen päälle).
            state.gamePreviewDefault = e.target.checked;
            setGamePreview(e.target.checked);
            updateShadowBounds();
            setStatus(e.target.checked
                ? 'Peliesikatselu päällä — Minecraft-valaistus, varjot ja hehku (editorin valot pois)'
                : 'Editorinäkymä palautettu');
        });
        // Pidä varjot editorissa pois päältä oletuksena — kevyempi
        setGamePreview(false);
    }

    // 🌙 Yötila — vain Game Preview -tilassa: tumma taivas, kuunvalo, glow loistaa
    const nightChk = document.getElementById('chk-game-night');
    if (nightChk) {
        nightChk.addEventListener('change', (e) => {
            if (e.target.checked && !state.gamePreview) {
                // Yö kytkee Game Previewin automaattisesti päälle
                gamePreviewChk.checked = true;
                setGamePreview(true);
                updateShadowBounds();
            }
            setGamePreviewNight(e.target.checked);
            setStatus(e.target.checked
                ? 'Night-tila päällä — kuunvalo, hehku loistaa kirkkaammin'
                : state.gamePreview ? 'Päivä palautettu' : 'Night-tila pois');
        });
        setGamePreviewNight(false);
    }
}

// ==================== MOB LIBRARY ====================
/** Hakutoiminto + lajittelu: suodattaa mob-kirjaston nimen/kuvauksen/id:n
 *  perusteella, lajittelee oletuksella / isoimmat ensin / pienimmät ensin /
 *  aakkosilla, ja voi rajata vain Deep Void -otoksiin. */
const libraryFilter = { search: '', sort: 'default', deepvoidOnly: false, voxelOnly: false, sizeClass: 'all' };
// setupLibrary sulkee renderLibrary:n sisäänsä — tämä hook päästää
// setupVoxelDropin (vokseloinnin jälkeinen kirjastopäivitys) käsiksi siihen.
let refreshLibraryUI = null;

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
        const sizeLabels = { jatti: 'Jätti', iso: 'Suuri', keski: 'Keskikoko', pieni: 'Pieni' };
        const sizeBadges = { jatti: 'Jätti', iso: 'Suuri', keski: 'Keskikoko', pieni: 'Pieni' };
        btn.title = (mob.description || '') +
            (mob.size ? ` — ${mob.size} lohkoa korkea` : '') +
            ` — ${mob.tier === 'boss' ? 'BOSS' : 'minion'} (pisteet ${mob.score})` +
            ` — ${sizeLabels[mob.sizeClass] || ''}`;
        btn.innerHTML = `<span class="mob-name">${mob.name}</span>` +
            `<span class="mob-size-badge">${sizeBadges[mob.sizeClass] || ''}</span>`;
        btn.addEventListener('click', () => loadLibraryMob(mob));
        if (mob.category === 'deepvoid' && MOB_STATS[mob.id]) {
            const statsBtn = document.createElement('button');
            statsBtn.type = 'button';
            statsBtn.className = 'mob-stats-btn';
            statsBtn.title = 'HP / kyvyt / kutsuminen — pelin bytecodesta';
            statsBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 13V8"/><path d="M7 13V3"/><path d="M11 13v-6"/><path d="M15 13V6"/></svg>';
            statsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openMobStats(mob);
            });
            btn.appendChild(statsBtn);
        }
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
            list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en'));
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
        appendGroup('Bossit', bosses);
        appendGroup('Minionit', minions);
        if (countEl) {
            countEl.textContent = list.length < LIBRARY_MOBS.length
                ? `— ${list.length} / ${LIBRARY_MOBS.length} mobia`
                : `— klikkaa ladataksesi`;
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
    refreshLibraryUI = renderLibrary;
    renderLibrary();

    // Mobi-stats-modal: sulkeminen (✕, Sulje, overlay-klikki, Esc)
    const statsModal = document.getElementById('mob-stats-modal');
    if (statsModal) {
        const closeStats = () => { statsModal.style.display = 'none'; };
        document.getElementById('mstats-close').addEventListener('click', closeStats);
        document.getElementById('mstats-close2').addEventListener('click', closeStats);
        statsModal.addEventListener('click', (e) => {
            if (e.target === statsModal) closeStats();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && statsModal.style.display !== 'none') closeStats();
        });
    }

    // ---- Oma malli → vokselointi selaimessa (drag & drop GLB/OBJ) ----
    setupVoxelDrop();

    // ---- Vasemman paneelin välilehdet (Työkalut / Osat / Pohja / Kirjasto) ----
    // Vähentää näkymän meteliä: vain aktiivisen välilehden sisältö näkyy.
    document.querySelectorAll('#left-tabs .lt-tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('#left-tabs .lt-tab').forEach(x => x.classList.toggle('active', x === t));
            const panel = document.getElementById('left-panel');
            if (panel) panel.dataset.activeTab = t.dataset.tab;
        });
    });

    // ---- Oikean paneelin välilehdet (Muokkaa / Näyttö) ----
    // Blockbench-tyyli: Muokkaa näyttää vain valitun kohteen tiedot,
    // Näyttö sisältää näyttöasetukset ja kiinnityspisteet.
    document.querySelectorAll('#right-tabs .rt-tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('#right-tabs .rt-tab').forEach(x => x.classList.toggle('active', x === t));
            const panel = document.getElementById('right-panel');
            if (panel) panel.dataset.activeTab = t.dataset.rtab;
        });
    });
    updateRightPanel();

    // ---- '🧬 Omat olennot' -välilehti: tallenna/lataa/poista omia olentoja ----
    document.querySelectorAll('.lib-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', t === tab));
            const view = tab.dataset.libview;
            const lib = document.getElementById('lib-view-library');
            const mine = document.getElementById('lib-view-mine');
            if (lib) lib.hidden = view !== 'library';
            if (mine) mine.hidden = view !== 'mine';
            if (view === 'mine') renderMyCreatures();
        });
    });
    const saveBtn = document.getElementById('btn-save-creature');
    if (saveBtn) saveBtn.addEventListener('click', openSaveCreatureDialog);

    // 🎲 Randomize — satunnainen olento Spore-osista
    const randomizeBtn = document.getElementById('btn-randomize');
    if (randomizeBtn) randomizeBtn.addEventListener('click', randomizeCreature);

    // Uuden mobin pohjat — valmiit luurangot aloittamiseen (kuvallinen ruudukko)
    let tplThumbs = new Map();
    try { tplThumbs = buildVoxelThumbMap(MOB_TEMPLATES.map(t => ({ key: t.id, bones: t.model.bones }))); } catch (e) { /* emoji-laatat fallback */ }
    const tplContainer = document.getElementById('template-grid');
    if (tplContainer) {
        for (const tpl of MOB_TEMPLATES) {
            const btn = document.createElement('button');
            btn.className = 'mob-btn part-tile';
            btn.title = tpl.description;
            const thumb = tplThumbs.get(tpl.id);
            btn.innerHTML = thumb
                ? `<span class="part-thumb"><img src="${thumb}" alt="" draggable="false"></span><span class="part-name">${tpl.name}</span>`
                : `<span class="mob-emoji-tile">${tpl.emoji || '🧩'}</span><span class="mob-name">${tpl.name}</span>`;
            btn.addEventListener('click', () => openNewMobDialog(tpl.id));
            tplContainer.appendChild(btn);
        }
    }
    // ---- Spore-tyylinen osapaletti: valmiita osia, jotka kiinnittyvät malliin ----
    // Esikatselukuvat renderöidään kerran pieniksi 3D-kuviksi (Sporen osapaletin
    // tyyliin). Jos WebGL:ää ei ole, käytetään emoji-laattoja.
    const partGrid = document.getElementById('part-grid');
    if (partGrid) {
        const mirrorChk = document.getElementById('part-mirror');
        const partThumbs = buildPartThumbMap();
        for (const cat of PART_CATEGORIES) {
            const parts = MOB_PARTS.filter(p => p.category === cat.id);
            if (!parts.length) continue;
            const header = document.createElement('div');
            header.className = 'part-cat';
            header.textContent = cat.name;
            partGrid.appendChild(header);
            for (const part of parts) {
                const btn = document.createElement('button');
                btn.className = 'mob-btn part-btn part-tile';
                btn.title = `${part.name}${part.symmetric ? ' — peilipari molemmille puolille' : ''}\nVasen klikkaus = kiinnitä heti · Oikea klikkaus = asetukset (luu / pinta / kpl)`;
                const thumb = partThumbs.get(part.id);
                btn.innerHTML = thumb
                    ? `<span class="part-thumb"><img src="${thumb}" alt="" draggable="false"></span><span class="part-name">${part.name}</span>`
                    : `<span class="mob-emoji-tile">${part.emoji || '🧩'}</span><span class="mob-name">${part.name}</span>`;
                // Vasen klikkaus: kiinnitä heti oletusasennolla (Spore-tyyli)
                btn.addEventListener('click', () => {
                    addPartToModel(part.id, { mirror: !mirrorChk || mirrorChk.checked });
                });
                // Raahaus: vedä osa suoraan olennon päälle (drag & drop)
                btn.draggable = true;
                btn.addEventListener('dragstart', (ev) => {
                    ev.dataTransfer.setData('application/x-part-id', part.id);
                    ev.dataTransfer.effectAllowed = 'copy';
                    startPartDrag(part.id);
                });
                btn.addEventListener('dragend', () => endPartDrag());
                // Oikea klikkaus: avaa asennusdialogi (luu, pinta, kpl-määrä)
                btn.addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    openPartAttachDialog(part.id, { mirror: !mirrorChk || mirrorChk.checked });
                });
                partGrid.appendChild(btn);
            }
        }
    }

    setupPartAttachDialog();
    setupPartEditPanel();
    setupPartDragDrop();

    // Vaihda animaatiota (tallennetaan ensin nykyinen, ladataan valittu)
    const animSelect = document.getElementById('anim-select');
    if (animSelect) {
        animSelect.addEventListener('change', () => {
            if (!state.projectAnimations || !state.projectAnimations[animSelect.value]) return;
            saveCurrentAnimation();
            loadAnimationData(state.projectAnimations[animSelect.value]);
            state.currentAnimName = animSelect.value;
            setStatus(`Animaatio: ${animSelect.value} — paina toistoa`);
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
        if (!src || !state.projectAnimations[src]) { setStatus('Ei animaatiota monistettavaksi'); return; }
        let name = src + '_copy';
        let n = 1;
        while (state.projectAnimations[name]) name = `${src}_copy_${n++}`;
        state.projectAnimations[name] = JSON.parse(JSON.stringify(state.projectAnimations[src]));
        state.currentAnimName = name;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[name]);
        setStatus(`Monistettu: ${src} → ${name}`);
    });

    document.getElementById('anim-rename').addEventListener('click', async () => {
        if (!state.currentAnimName) { setStatus('Ei animaatiota nimeämättä uudelleen'); return; }
        saveCurrentAnimation();
        const old = state.currentAnimName;
        const name = (await askConfirm('Anna animaatiolle uusi nimi:', { prompt: true, title: 'Nimeä animaatio uudelleen', defaultValue: old, okLabel: 'Nimeä' })).trim();
        if (!name || name === old) return;
        if (state.projectAnimations[name]) { setStatus(`Nimi on jo käytössä: ${name}`); return; }
        state.projectAnimations[name] = state.projectAnimations[old];
        delete state.projectAnimations[old];
        state.currentAnimName = name;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[name]);
        setStatus(`Nimetty uudelleen: ${old} → ${name}`);
    });

    document.getElementById('anim-del').addEventListener('click', async () => {
        const names = Object.keys(state.projectAnimations);
        if (names.length <= 1) { setStatus('Vähintään yksi animaatio vaaditaan'); return; }
        const ok = await askConfirm(`Poistetaanko animaatio "${state.currentAnimName}"?`, { title: 'Poista animaatio', okLabel: 'Poista' });
        if (!ok) return;
        saveCurrentAnimation();
        delete state.projectAnimations[state.currentAnimName];
        const next = Object.keys(state.projectAnimations)[0];
        state.currentAnimName = next;
        refreshAnimationSelect();
        loadAnimationData(state.projectAnimations[next]);
        setStatus(`Poistettu — nyt: ${next}`);
    });

    // 🕺 Auto: Spore-tyylinen animaatiogenerointi luurangosta
    document.getElementById('anim-auto').addEventListener('click', generateAutoAnimations);
}

/**
 * 🕺 Generoi idle/walk/attack (ja fly/swim jos rakenne sen sallii)
 * automaattisesti analysoimalla luurangon — jalojen geometria, kädet,
 * siivet, häntä ja pää. Korvaa projektin animaatiot yhdellä klikkauksella.
 */
function generateAutoAnimations() {
    saveCurrentAnimation();
    const { animations, analysis } = generateAutoAnimationsForModel(state.model);
    const names = Object.keys(animations);
    if (!names.length) {
        setStatus('Ei luurankoa — lisää ensin kuutioita');
        return;
    }
    state.projectAnimations = animations;
    state.currentAnimName = names[0];
    refreshAnimationSelect();
    loadAnimationData(animations[names[0]]);
    const parts = [];
    if (analysis.body) parts.push('body');
    if (analysis.legs.length) parts.push(`${analysis.legs.length} legs`);
    if (analysis.arms.length) parts.push(`${analysis.arms.length} arms`);
    if (analysis.wings.length >= 2) parts.push('wings');
    if (analysis.tail) parts.push('tail');
    if (analysis.head) parts.push('head');
    setStatus(`Luotu ${names.join(', ')} — luuranko: ${parts.join(', ')}. Muokkaa avainruutuja tai vie pakettina.`);
    scheduleAutosave();
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

/**
 * Avaa HP/kyvyt/kutsuminen-näkymän mobille. Kaikki arvot ovat pelin
 * bytecodesta (createAttributes + registerGoals + bossbar) ja lang-tiedoston
 * rekisteri-id:stä — ei arvauksia.
 */
function openMobStats(mob) {
    const stats = MOB_STATS[mob.id];
    if (!stats) return;
    const modal = document.getElementById('mob-stats-modal');
    if (!modal) return;

    document.getElementById('mstats-name').textContent = mob.name || mob.id;
    const bits = [];
    if (mob.size) bits.push(`${mob.size} blocks tall`);
    if (stats.bossbar) bits.push('Bossbar boss');
    if (mob.tier === 'boss') bits.push('BOSS');
    bits.push(`${mob.model.bones.length} bones`);
    document.getElementById('mstats-sub').textContent = bits.join(' · ');

    // ❤️ HP
    const hpEl = document.getElementById('mstats-hp');
    const heartsEl = document.getElementById('mstats-hearts');
    if (stats.hp != null) {
        // Poista edellinen HP-bar (muuten bar kasautuu joka modalin avauksella)
        hpEl.parentElement.querySelectorAll('.mstats-hp-bar').forEach(el => el.remove());
        const hearts = stats.hp / 2;
        const pct = Math.min(100, (stats.hp / 999) * 100);
        hpEl.innerHTML = `${stats.hp} <small>HP = ${hearts} hearts</small>`;
        const bar = document.createElement('div');
        bar.className = 'mstats-hp-bar';
        const fill = document.createElement('i');
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        hpEl.insertAdjacentElement('afterend', bar);
        // sydänrivistö (rajoitettu 30 näkyvään + laskuri)
        const show = Math.min(30, Math.ceil(hearts));
        let html = '';
        for (let i = 0; i < show; i++) {
            html += (i < Math.floor(hearts)) ? '♥' : '<span class="empty">♡</span>';
        }
        if (hearts > show) html += ` <span class="empty">+${Math.round(hearts - show)}</span>`;
        heartsEl.innerHTML = html;
    } else {
        hpEl.textContent = '— (no entity class in this JAR version)';
        heartsEl.innerHTML = '';
    }

    // 📊 ominaisuudet
    const rows = [
        ['Armor', stats.armor],
        ['Armor toughness', stats.toughness],
        ['Movement speed', stats.speed != null ? stats.speed : null],
        ['Flight speed', stats.flySpeed != null ? stats.flySpeed : null],
        ['Follow distance', stats.follow != null ? `${stats.follow} blocks` : null],
        ['Knockback resistance', stats.knockback != null ? (stats.knockback >= 999 ? 'full (999)' : stats.knockback) : null],
        ['Attack damage', stats.damage != null ? stats.damage : null],
    ].filter(([, v]) => v != null);
    const grid = document.getElementById('mstats-grid');
    grid.innerHTML = rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');

    // ⚔️ kyvyt
    const GOAL_LABELS = {
        'Kostaa vahingon aiheuttajalle': 'Retaliates against attacker',
        'Vaeltelee satunnaisesti': 'Wanders randomly',
        'Katselee ympärilleen': 'Looks around',
        'Kelluu veden pinnalla': 'Floats on water',
        'Hyökkää lähimmän vihollisen kimppuun': 'Attacks nearest enemy',
        'Katsoo pelaajaa': 'Looks at player',
        'Väistelee tiettyjä entiteettejä': 'Avoids certain entities',
        'Vaeltelee (välttää vettä)': 'Wanders (avoids water)',
        'Ui satunnaisesti': 'Swims randomly',
        'Seuraa toista mobia': 'Follows another mob',
        'Seuraa syöttiä': 'Follows food',
        'Loikkaa kohti kohdetta': 'Jumps at target',
        'Tuhoaa lohkoja': 'Destroys blocks',
        'Kostaa omistajalle tehdyn vahingon': 'Retaliates against owner\'s attacker',
        'Hyökkää omistajansa vihollisia vastaan': 'Attacks owner\'s enemies',
    };
    const goalsEl = document.getElementById('mstats-goals');
    if (stats.goals && stats.goals.length) {
        goalsEl.innerHTML = stats.goals.map((g) => `<li title="${g.id}">${GOAL_LABELS[g.label] || g.label}</li>`).join('');
    } else {
        goalsEl.innerHTML = '<li style="border:none">No standard AI goals (static/scripted)</li>';
    }

    // 🎬 animaatiot
    const animsEl = document.getElementById('mstats-anims');
    const animNames = Object.keys(mob.animations || (mob.animation ? { animation: mob.animation } : {}) || {});
    animsEl.innerHTML = animNames.length
        ? animNames.map((n) => `<span class="mstats-anim-chip">${n}</span>`).join('')
        : '<span class="modal-hint">No animations</span>';

    // 🎮 kutsuminen
    document.getElementById('mstats-summon').textContent = stats.summon;
    document.getElementById('mstats-registry').textContent = stats.registry;

    // napit
    document.getElementById('mstats-load').onclick = () => {
        modal.style.display = 'none';
        loadLibraryMob(mob);
    };
    document.getElementById('mstats-copy').onclick = () => {
        navigator.clipboard && navigator.clipboard.writeText(stats.summon);
        const b = document.getElementById('mstats-copy');
        b.textContent = 'Copied';
        setTimeout(() => (b.textContent = 'Copy'), 1200);
    };

    modal.style.display = 'flex';
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
    // Oletus: idle (neutraali, maanpinnan asento) — 'spawn'-animaatio
    // alkaa usein maan alta (posTracks [0,-3.3,0]), jolloin mobi olisi
    // piilossa ensimmäisellä ruudulla.
    const defaultAnim = names.includes('idle') ? 'idle' : names[0];
    state.currentAnimName = names.length ? defaultAnim : null;
    refreshAnimationSelect();
    if (state.animation && names.length) {
        loadAnimationData(state.projectAnimations[defaultAnim]);
    } else if (state.animation) {
        state.animation.length = 40;
        state.animation.tracks = {};
        state.animation.posTracks = null;
        state.animation.syncSlider && state.animation.syncSlider();
        state.animation.redrawKeys && state.animation.redrawKeys();
        state.animation.applyPose();
    }
}

/** Vokseloi käyttäjän oma GLB/OBJ-malli selaimessa ja lataa se editoriin. */
function setupVoxelDrop() {
    const zone = document.getElementById('voxel-dropzone');
    if (!zone) return;
    const fileInput = document.getElementById('voxel-file');
    const fileBtn = document.getElementById('voxel-file-btn');
    const heightInput = document.getElementById('voxel-height');
    const sizeSelect = document.getElementById('voxel-size');
    const statusEl = document.getElementById('voxel-status');
    const tick = () => new Promise(r => setTimeout(r, 30)); // anna UI:n piirtyä
    const setStatus = (msg, cls) => {
        statusEl.textContent = msg;
        statusEl.className = 'voxel-drop-status' + (cls ? ' ' + cls : '');
    };

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag');
        if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFiles(fileInput.files);
        fileInput.value = '';
    });

    async function handleFiles(files) {
        const list = [...files];
        const hasGlb = list.some(f => /^.*\.glb$/i.test(f.name));
        const hasObj = list.some(f => /^.*\.obj$/i.test(f.name));
        if (!hasGlb && !hasObj) {
            setStatus('Pudota .glb- tai .obj-tiedosto (voi sisältää .mtl + tekstuurikuvan)', 'error');
            return;
        }
        setStatus('Luetaan tiedostoja…');
        await tick();
        const buffers = new Map();
        for (const f of list) buffers.set(f.name, await f.arrayBuffer());
        const primary = list.find(f => /^.*\.(glb|obj)$/i.test(f.name));
        const baseName = primary.name.replace(/\.(glb|obj)$/i, '');
        const heightBlocks = Math.max(0.5, Math.min(20, parseFloat(heightInput.value) || 2));
        const voxel = parseInt(sizeSelect.value, 10) || 2;
        setStatus('Vokseloidaan… (isot mallit voivat kestää hetken)');
        await tick();
        try {
            const mob = await voxelizeModel(buffers, { name: baseName, heightBlocks, voxel });
            mob.category = 'voxel';
            prepareMob(mob);
            LIBRARY_MOBS.push(mob);
            if (refreshLibraryUI) refreshLibraryUI();
            loadLibraryMob(mob);
            const cubes = mob.model.bones.reduce((n, b) => n + b.cubes.length, 0);
            setStatus(`${mob.name} vokseloitu — ${mob.model.bones.length} luuta, ${cubes} kuutiota, ${mob.size} lohkoa. Ladattu editoriin!`, 'ok');
        } catch (err) {
            setStatus(err && err.message ? err.message : String(err), 'error');
        }
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
    state.sourceCategory = mob.category || 'voxel';
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
    applyGamePreviewDefault(); // Game Preview päälle latauksen jälkeen (oletus)
    scheduleAutosave();
    const tierTxt = mob.tier === 'boss' ? 'BOSS' : 'minion';
    setStatus(`${mob.name} (${tierTxt}, ${mob.size} lohkoa, pisteet ${mob.score}) ladattu — malli, tekstuuri ja animaatiot valmiina. Paina toistoa esikatsellaksesi.`);
}

/** Uuden mobin aloittaminen pohjasta: malli + väripohjatekstuuri. */
function loadTemplate(tpl) {
    state.history.push(state.model);
    state.model = JSON.parse(JSON.stringify(tpl.model));
    state.projectName = tpl.name;
    state.sourceCategory = 'template';
    state.texture = null;
    state.textureCanvas = null;
    state.textureDataURL = null;
    state.emissiveTexture = null;
    state.emissiveDataURL = null;
    state.projectAnimations = {};
    state.currentAnimName = null;
    state.packOptions = { ...DEFAULT_PACK_OPTIONS };
    const sel = document.getElementById('anim-select');
    if (sel) { sel.innerHTML = ''; sel.style.display = 'none'; }
    deselectAll();
    rebuildModel();
    // Autosäilö pohjasta alkava malli
    fitCameraToMob({
        fit: { center: [0, 8, 0], radius: 12 }
    });
    applyGamePreviewDefault(); // Game Preview päälle latauksen jälkeen (oletus)
    updateProjectNameLabel();
    scheduleAutosave();        setStatus(`${tpl.name}-pohja luotu — muokkaa kuutioita, maalaa UV-editorissa tai 3D:ssä`);
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
    } else {        setStatus('Valitse ensin kuutio tai luu peilattavaksi');
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
    setStatus(`Peilattiin ${created.length} kuutiota: ${mirrorName} → ${mirrorName}_peili`);
}

// ==================== OMIA OLENTOJA ('Omat olennot') ====================
// Kirjaston '🧬 Omat olennot' -välilehti: rakennetut olennot tallennetaan
// localStorage:aan (malli + tekstuuri + animaatiot + 📦-statit) ja ladataan
// takaisin editoriin milloin vain. Täysi kopio nykyisestä projektista —
// autosave koskee vain viimeisintä työtä, tämä galleria säilyttää ne kaikki.
const MY_CREATURES_KEY = 'freebuff_mobstudio_mycreatures_v1';

function getMyCreatures() {
    try {
        const list = JSON.parse(localStorage.getItem(MY_CREATURES_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

function putMyCreatures(list) {
    try {
        localStorage.setItem(MY_CREATURES_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('My Creatures save failed:', e);
        setStatus('Tallennus epäonnistui — onko selaimen tallennustila täynnä?');
    }
}

/** Laske mallin rajaus (kameran kohdistukseen) luut huomioiden. */
function computeModelFit(model) {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const byName = new Map(model.bones.map(b => [b.name, b]));
    const world = new Map();
    function worldPivot(bone) {
        if (world.has(bone.name)) return world.get(bone.name);
        const parent = bone.parent ? byName.get(bone.parent) : null;
        const p = parent ? worldPivot(parent) : [0, 0, 0];
        const w = [
            p[0] + bone.pivot[0] - (parent ? parent.pivot[0] : 0),
            p[1] + bone.pivot[1] - (parent ? parent.pivot[1] : 0),
            p[2] + bone.pivot[2] - (parent ? parent.pivot[2] : 0)
        ];
        world.set(bone.name, w);
        return w;
    }
    for (const bone of model.bones) {
        const wp = worldPivot(bone);
        for (const c of bone.cubes) {
            for (let i = 0; i < 8; i++) {
                const x = wp[0] + (c.origin[0] - bone.pivot[0]) + (i & 1 ? c.size[0] : 0);
                const y = wp[1] + (c.origin[1] - bone.pivot[1]) + (i & 2 ? c.size[1] : 0);
                const z = wp[2] + (c.origin[2] - bone.pivot[2]) + (i & 4 ? c.size[2] : 0);
                if (x < mn[0]) mn[0] = x;
                if (x > mx[0]) mx[0] = x;
                if (y < mn[1]) mn[1] = y;
                if (y > mx[1]) mx[1] = y;
                if (z < mn[2]) mn[2] = z;
                if (z > mx[2]) mx[2] = z;
            }
        }
    }
    if (!isFinite(mn[0])) return { center: [0, 8, 0], radius: 12 };
    return {
        center: [0, (mn[1] + mx[1]) / 2, 0],
        radius: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2
    };
}

/** Tallenna nykyinen olento galleriaan (nimi + emoji + kaikki data + statit). */
function saveCurrentCreature(name, emoji) {
    saveCurrentAnimation();
    const list = getMyCreatures();
    const id = 'mine_' + Date.now().toString(36);
    // prepareMob laskee korkeuden/tierin/kokoluokan samalla logiikalla kuin
    // kirjaston mobeilla (deepvoid = lohkoasteikko, muut 1/16). autoLayoutUVs
    // on no-op — kaikilla tallennettavilla kuutioilla on jo UV-offset.
    const tmp = prepareMob({
        category: state.sourceCategory || 'voxel',
        model: JSON.parse(JSON.stringify(state.model))
    });
    const entry = {
        id,
        name: name || 'Creature',
        emoji: emoji || '🧬',
        savedAt: Date.now(),
        sourceCategory: state.sourceCategory || 'voxel',
        size: tmp.size,
        tier: tmp.tier,
        sizeClass: tmp.sizeClass,
        score: tmp.score,
        bones: state.model.bones.length,
        cubes: state.model.bones.reduce((n, b) => n + b.cubes.length, 0),
        animCount: Object.keys(state.projectAnimations || {}).length,
        model: JSON.parse(JSON.stringify(state.model)),
        textureDataURL: state.textureCanvas ? state.textureCanvas.toDataURL() : null,
        emissiveDataURL: state.emissiveDataURL,
        projectAnimations: state.projectAnimations ? JSON.parse(JSON.stringify(state.projectAnimations)) : {},
        currentAnimName: state.currentAnimName,
        packOptions: { ...DEFAULT_PACK_OPTIONS, ...state.packOptions },
        previewOptions: getPreviewOptions()
    };
    list.unshift(entry);
    if (list.length > 60) list.length = 60;
    putMyCreatures(list);
    renderMyCreatures();
    setStatus(`"${entry.name}" saved to My Creatures — ${entry.size} blocks, ${entry.bones} bones, ${entry.cubes} cubes`);
}

/** Lataa tallennettu olento takaisin editoriin (malliksi kirjastolle). */
function loadMyCreature(id) {
    const entry = getMyCreatures().find(e => e.id === id);
    if (!entry) { renderMyCreatures(); return; }
    const mob = {
        id: entry.id,
        name: entry.name || 'Creature',
        emoji: entry.emoji || '🧬',
        description: 'Custom creature — from My Creatures library',
        category: 'mine',
        model: JSON.parse(JSON.stringify(entry.model)),
        textureDataURL: entry.textureDataURL || null,
        emissiveDataURL: entry.emissiveDataURL || null,
        animations: entry.projectAnimations || {},
        size: entry.size,
        tier: entry.tier,
        sizeClass: entry.sizeClass,
        score: entry.score,
        fit: computeModelFit(entry.model)
    };
    loadLibraryMob(mob);
    // Palauta olennon omat statit ja näkymäasetukset
    state.packOptions = { ...DEFAULT_PACK_OPTIONS, ...(entry.packOptions || {}) };
    applyPreviewOptions(entry.previewOptions || null);
    state.sourceCategory = entry.sourceCategory || 'voxel';
    scheduleAutosave();
    setStatus(`"${mob.name}" ladattu — ${mob.size} lohkoa, HP ${state.packOptions.health}, vahinko ${state.packOptions.damage}`);
}

/** Poista tallennettu olento galleriasta. */
function deleteMyCreature(id) {
    const list = getMyCreatures().filter(e => e.id !== id);
    putMyCreatures(list);
    renderMyCreatures();        setStatus('Olento poistettu kohdasta Omat olennot');
}

/** Piirrä 'Omat olennot' -ruudukko (kortti: emoji, nimi, koko, luut, statit). */
function renderMyCreatures() {
    const grid = document.getElementById('my-creatures-grid');
    const empty = document.getElementById('my-creatures-empty');
    if (!grid) return;
    const list = getMyCreatures();
    grid.innerHTML = '';
    if (empty) empty.style.display = list.length ? 'none' : '';
    const sizeLabels = { jatti: 'Giant', iso: 'Large', keski: 'Medium', pieni: 'Small' };
    for (const entry of list) {
        const card = document.createElement('div');
        card.className = 'my-creature-card';
        const stats = entry.packOptions || {};
        const chips = [
            `${entry.bones} bones`,
            `${entry.cubes} cubes`,
            `${entry.animCount || 0} animations`
        ];
        if (stats.health) chips.push(`${stats.health} HP`);            if (stats.damage) chips.push(`${stats.damage} damage`);
        if (stats.speed) chips.push(`${stats.speed} speed`);

        const head = document.createElement('div');
        head.className = 'my-creature-head';
        const emoji = document.createElement('span');
        emoji.className = 'mob-emoji';
        emoji.textContent = entry.emoji || '✦';
        const title = document.createElement('div');
        title.className = 'my-creature-title';
        const strong = document.createElement('strong');
        strong.textContent = entry.name || 'Creature';
        const meta = document.createElement('span');
        meta.className = 'my-creature-meta';
        meta.textContent = `${sizeLabels[entry.sizeClass] || ''} · ${entry.size} blocks`.replace(/^ · /, '');
        title.appendChild(strong);
        title.appendChild(meta);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'my-creature-del';
        del.title = 'Delete creature';
        del.textContent = '✕';
        del.addEventListener('click', () => deleteMyCreature(entry.id));
        head.appendChild(emoji);
        head.appendChild(title);
        head.appendChild(del);

        const statsRow = document.createElement('div');
        statsRow.className = 'my-creature-stats';
        for (const chip of chips) {
            const s = document.createElement('span');
            s.textContent = chip;
            statsRow.appendChild(s);
        }

        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'action-btn my-creature-load';
        load.textContent = 'Load';
        load.addEventListener('click', () => loadMyCreature(entry.id));

        card.appendChild(head);
        card.appendChild(statsRow);
        card.appendChild(load);
        grid.appendChild(card);
    }
}

// ---- vahvistus/nimeä-dialogi (korvaa natiivin confirm/prompt, joka jumittaa webview'n) ----
let confirmDialog = null;
let confirmResolve = null;

/** Näytä oma vahvistusdialogi (tai nimikentällä prompt). Palauttaa lupauksen. */
function askConfirm(message, opts = {}) {
    if (!confirmDialog) setupConfirmDialog();
    const overlay = confirmDialog;
    document.getElementById('app-confirm-title').textContent = opts.title || 'Vahvista';
    document.getElementById('app-confirm-message').textContent = message;
    const field = document.getElementById('app-confirm-field');
    const input = document.getElementById('app-confirm-input');
    field.style.display = opts.prompt ? 'block' : 'none';
    if (opts.prompt) {
        input.value = opts.defaultValue != null ? opts.defaultValue : '';
        input.placeholder = opts.placeholder || '';
        input.focus();
        input.select();
    }
    const okBtn = document.getElementById('app-confirm-ok');
    okBtn.textContent = opts.okLabel || 'OK';
    overlay.style.display = 'flex';
    return new Promise(resolve => {
        confirmResolve = (value) => {
            overlay.style.display = 'none';
            confirmResolve = null;
            resolve(value);
        };
    });
}

/** Näytä oma virheilmoitus (ei-natiivi alert). */
async function showAlert(message, title = 'Virhe') {
    await askConfirm(message, { title, okLabel: 'OK' });
}

function setupConfirmDialog() {
    confirmDialog = document.getElementById('app-confirm-dialog');
    document.getElementById('app-confirm-ok').addEventListener('click', () => {
        if (!confirmResolve) return;
        const input = document.getElementById('app-confirm-input');
        const promptMode = document.getElementById('app-confirm-field').style.display !== 'none';
        confirmResolve(promptMode ? input.value : true);
    });
    const cancel = () => { if (confirmResolve) confirmResolve(false); };
    document.getElementById('app-confirm-cancel').addEventListener('click', cancel);
    confirmDialog.addEventListener('click', (e) => { if (e.target === confirmDialog) cancel(); });
    const input = document.getElementById('app-confirm-input');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('app-confirm-ok').click();
        if (e.key === 'Escape') cancel();
    });
}

// ---- tallennusdialogi (nimi + emoji) --------------------------------
let saveCreatureDialog = null;

function openSaveCreatureDialog() {
    if (!saveCreatureDialog) setupSaveCreatureDialog();
    const nameInput = document.getElementById('save-creature-name');
    nameInput.value = state.projectName && state.projectName !== 'My Mob' ? state.projectName : '';
    const emojiInput = document.getElementById('save-creature-emoji');
    saveCreatureDialog.emoji = '🧬';
    emojiInput.value = saveCreatureDialog.emoji;
    document.getElementById('save-creature-dialog').style.display = 'flex';
    nameInput.focus();
    nameInput.select();
}

function setupSaveCreatureDialog() {
    saveCreatureDialog = { emoji: '🧬' };
    const overlay = document.getElementById('save-creature-dialog');
    const nameInput = document.getElementById('save-creature-name');
    const emojiInput = document.getElementById('save-creature-emoji');
    const picks = document.getElementById('save-creature-emojis');
    const EMOJIS = ['🧬', '🐺', '🐲', '🦖', '👹', '🧟', '🦇', '🐙', '🦂', '🐉', '👽', '🤖', '👻', '🦅', '🐍', '🦈'];
    for (const e of EMOJIS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'emoji-pick';
        b.textContent = e;
        b.addEventListener('click', () => {
            saveCreatureDialog.emoji = e;
            emojiInput.value = e;
            picks.querySelectorAll('.emoji-pick').forEach(x => x.classList.toggle('active', x === b));
        });
        picks.appendChild(b);
    }
    emojiInput.addEventListener('input', () => {
        saveCreatureDialog.emoji = emojiInput.value.trim() || '🧬';
        picks.querySelectorAll('.emoji-pick').forEach(x => x.classList.toggle('active', x.textContent === saveCreatureDialog.emoji));
    });
    const confirm = () => {
        const name = nameInput.value.trim() || 'Creature';
        const emoji = saveCreatureDialog.emoji || '🧬';
        overlay.style.display = 'none';
        saveCurrentCreature(name, emoji);
    };
    document.getElementById('save-creature-confirm').addEventListener('click', confirm);
    document.getElementById('save-creature-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    [nameInput, emojiInput].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirm(); }
            if (e.key === 'Escape') overlay.style.display = 'none';
        });
    });
}

// ==================== AUTOSAVE ====================
let autosaveTimer = null;
function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        try {
            saveCurrentAnimation();
            localStorage.setItem(AUTOSAVE_KEY_ACTIVE, JSON.stringify({
                savedAt: Date.now(), // deeplink-avainten ikä (30 pv siivous)
                model: state.model,
                projectName: state.projectName,
                textureDataURL: state.textureCanvas ? state.textureCanvas.toDataURL() : null,
                emissiveDataURL: state.emissiveDataURL,
                animation: state.animation ? {
                    length: state.animation.length,
                    tracks: state.animation.tracks
                } : null,
                projectAnimations: state.projectAnimations,
                currentAnimName: state.currentAnimName,
                packOptions: state.packOptions,
                previewOptions: getPreviewOptions(),
                sourceCategory: state.sourceCategory
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
    const options = [{ id: 'empty', emoji: '⬜', name: 'Empty' }, ...MOB_TEMPLATES];
    for (const tpl of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-tpl-btn';
        btn.dataset.tpl = tpl.id;
        btn.title = tpl.description || '';
        btn.innerHTML = `<span>${tpl.name}</span>`;
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
        // Template-pohjat ovat yksiluisia (kaikki kuutiot body-luussa) — jaetaan
        // moniluuiseksi luurangoksi, jotta Spore-osat kiinnittyvät oikeisiin
        // luihin (head/body/legs) ja animaatiot tunnistavat raajat (sama
        // logiikka kuin Randomizessa).
        const baseModel = tpl ? JSON.parse(JSON.stringify(splitTemplateIntoSkeleton(tpl.model))) : createEmptyModel();
        state.model = baseModel;
        state.model.modelId = modelId;
        state.projectName = name;
        state.sourceCategory = 'template';
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
        applyGamePreviewDefault(); // Game Preview päälle uuden mobin luonnin jälkeen (oletus)
        updateProjectNameLabel();
        closeNewMobDialog();
        scheduleAutosave();
        setStatus(`${name} created (${modelId}) — export: ${exportFileName(modelId, 'bedrock')}`);
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
            projectAnimations: state.projectAnimations,
            packOptions: state.packOptions,
            previewOptions: getPreviewOptions()
        };
        downloadJson(data, `${state.model.modelId.replace('geometry.', '')}.mobstudio.json`);
        setStatus('Projekti tallennettu');
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
                    state.packOptions = data.packOptions || { ...DEFAULT_PACK_OPTIONS };
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
                    // Preview-asetukset (päivä/yö, taustaväri) palautuvat
                    applyPreviewOptions(data.previewOptions);
                    scheduleAutosave();
                    setStatus(`Avattu: ${file.name}`);
                } else {
                    showAlert('Tämä ei ole kelvollinen Freebuff Mob Studio -projektitiedosto.');
                }
            } catch (err) {
                showAlert('Projektin avaaminen epäonnistui: ' + err.message);
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
        setStatus('Tekstuuri palautettu kuutioiden väreihin');
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
                setStatus(`Tuotu Blockbench-malli: ${file.name} (${parsed.model.bones.reduce((n, b) => n + b.cubes.length, 0)} kuutiota${parsed.animation ? ', animaatio mukana' : ''})`);
            } catch (err) {
                showAlert('Blockbench-mallin tuonti epäonnistui: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Blockbench (.bbmodel) export — vie malli tekstuureineen ja animaatioineen
    document.getElementById('btn-export-bbmodel').addEventListener('click', () => {
        const id = state.model.modelId.replace('geometry.', '');
        ensureTexture();
        const textureDataURL = state.textureCanvas ? state.textureCanvas.toDataURL() : state.textureDataURL || null;
        const animations = currentAnimations(); // null jos ei animaatioita
        const bb = exportBBModel(state.model, {
            projectName: state.projectName || id,
            textureDataURL,
            animations,
        });
        const blob = new Blob([JSON.stringify(bb, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${id}.bbmodel`;
        a.click();
        URL.revokeObjectURL(url);
        const cubeCount = state.model.bones.reduce((n, b) => n + (b.cubes ? b.cubes.length : 0), 0);
        setStatus(`Blockbench-tiedosto tallennettu (${id}.bbmodel) — ${cubeCount} kuutiota, ${animations ? Object.keys(animations).length + ' animaatiota' : 'ei animaatioita'}, tekstuuri ${textureDataURL ? 'mukana' : 'puuttuu'}`);
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
                setStatus(`Tuotu: ${file.name}`);
            } catch (err) {
                showAlert('Bedrock-geometrian jäsennys epäonnistui: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('btn-export-bedrock').addEventListener('click', () => {
        const json = exportBedrockGeometry(state.model);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_bedrock.json`);
        setStatus('Bedrock-geometria viety');
    });

    document.getElementById('btn-export-java').addEventListener('click', () => {
        const json = exportJavaModel(state.model);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_java.json`);
        setStatus('Java Edition -malli viety');
    });

    document.getElementById('btn-export-anim-bedrock').addEventListener('click', () => {
        const animations = currentAnimations();
        if (!animations) { setStatus('Ei animaatioita vietäväksi — lisää ensin avainruutuja'); return; }
        const json = exportBedrockAnimations(state.model, animations);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_animations.json`);
        setStatus('Animaatiot viety (Bedrock .animation.json)');
    });

    document.getElementById('btn-export-anim-java').addEventListener('click', () => {
        const animations = currentAnimations();
        if (!animations) { setStatus('Ei animaatioita vietäväksi — lisää ensin avainruutuja'); return; }
        const json = exportJavaAnimations(state.model, animations);
        downloadJson(json, `${state.model.modelId.replace('geometry.', '')}_geckolib.json`);
        setStatus('Animaatiot viety (Java/GeckoLib .animation.json)');
    });

    // ---- 📦 resurssipaketti ---------------------------------------
    const packDialog = document.getElementById('pack-dialog');
    const packFmtBtns = document.querySelectorAll('#pack-formats button');
    const packNsInput = document.getElementById('pack-namespace');
    const packFileList = document.getElementById('pack-file-list');
    const packBehaviorBtns = document.querySelectorAll('#pack-behavior button');
    const packHealthInput = document.getElementById('pack-health');
    const packDamageInput = document.getElementById('pack-damage');
    const packSpeedInput = document.getElementById('pack-speed');
    const packJumpInput = document.getElementById('pack-jump');
    const packFlyingInput = document.getElementById('pack-flying');
    const BEHAVIOR_DEFAULTS = {
        passive: { health: 10, damage: 0, speed: 0.30 },
        neutral: { health: 20, damage: 4, speed: 0.25 },
        hostile: { health: 30, damage: 6, speed: 0.35 },
    };

    function currentPackBehavior() {
        const active = document.querySelector('#pack-behavior button.active');
        return active ? active.dataset.behavior : 'neutral';
    }

    function currentPackFormats() {
        const active = document.querySelector('#pack-formats button.active');
        const fmt = active ? active.dataset.fmt : 'java';
        return fmt === 'both' ? ['java', 'bedrock'] : [fmt];
    }

    function slugify(value) {
        return String(value).replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/gi, '').toLowerCase();
    }

    function updatePackFileList() {
        const id = state.model.modelId.replace('geometry.', '');
        const ns = slugify(packNsInput.value || id) || id;
        const hasAnims = !!(state.projectAnimations && Object.keys(state.projectAnimations).length > 0);
        const hasGlow = !!state.emissiveDataURL;
        const paths = previewPackFiles(currentPackFormats(), id, ns, hasAnims, hasGlow);
        packFileList.textContent = paths.join('\n');
        const notes = [];
        if (!hasAnims) notes.push('no animations');
        if (hasAnims && currentPackFormats().includes('bedrock')) notes.push('one animation plays in game (idle/walk takes priority)');
        if (!hasGlow) notes.push('no glow layer');
        if (hasGlow && currentPackFormats().includes('bedrock')) notes.push('glow shines in game (entity_emissive_alpha)');
        packFileList.title = notes.length ? notes.join(', ') : '';
        // .mcaddon vain kun valittuna pelkkä Bedrock (Minecraft avaa sen suoraan)
        const isMcaddon = currentPackFormats().length === 1 && currentPackFormats()[0] === 'bedrock';
        const dlBtn = document.getElementById('pack-download');
        dlBtn.textContent = isMcaddon ? '⬇ Download .mcaddon' : '⬇ Download .zip';
        dlBtn.title = isMcaddon ? 'Minecraft opens .mcaddon directly for installation' : '';
    }

    function openPackDialog() {
        packNsInput.value = state.model.modelId.replace('geometry.', '');
        // Palauta tallennetut käytös-/statistiikkavalinnat (projekti/autosave)
        const po = { ...DEFAULT_PACK_OPTIONS, ...(state.packOptions || {}) };
        packBehaviorBtns.forEach((b) => b.classList.toggle('active', b.dataset.behavior === po.behavior));
        packHealthInput.value = po.health;
        packDamageInput.value = po.damage;
        document.getElementById('pack-health-val').textContent = po.health;
        document.getElementById('pack-damage-val').textContent = po.damage;
        packSpeedInput.value = Math.round(po.speed * 100);
        document.getElementById('pack-speed-val').textContent = po.speed.toFixed(2);
        packJumpInput.value = po.jump ? 1 : 0;
        document.getElementById('pack-jump-val').textContent = po.jump ? 'on' : 'off';
        packFlyingInput.checked = !!po.flying;
        packDialog.style.display = 'flex';
        drawEggPreview();
        drawPackIconPreview();
        updatePackFileList();
    }
    function closePackDialog() { packDialog.style.display = 'none'; }

    document.getElementById('btn-export-pack').addEventListener('click', openPackDialog);
    document.getElementById('pack-cancel').addEventListener('click', closePackDialog);
    packDialog.addEventListener('click', (e) => { if (e.target === packDialog) closePackDialog(); });
    packFmtBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            packFmtBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            updatePackFileList();
        });
    });
    packBehaviorBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            packBehaviorBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const def = BEHAVIOR_DEFAULTS[btn.dataset.behavior] || BEHAVIOR_DEFAULTS.neutral;
            packHealthInput.value = def.health;
            packDamageInput.value = def.damage;
            document.getElementById('pack-health-val').textContent = def.health;
            document.getElementById('pack-damage-val').textContent = def.damage;
            packSpeedInput.value = Math.round(def.speed * 100);
            document.getElementById('pack-speed-val').textContent = def.speed.toFixed(2);
            state.packOptions = {
                behavior: btn.dataset.behavior,
                health: def.health,
                damage: def.damage,
                speed: def.speed,
                jump: packJumpInput.value === '1',
                flying: packFlyingInput.checked,
            };
            scheduleAutosave();
        });
    });
    packHealthInput.addEventListener('input', () => {
        document.getElementById('pack-health-val').textContent = packHealthInput.value;
        if (state.packOptions) state.packOptions.health = parseInt(packHealthInput.value) || 20;
        scheduleAutosave();
    });
    packDamageInput.addEventListener('input', () => {
        document.getElementById('pack-damage-val').textContent = packDamageInput.value;
        if (state.packOptions) state.packOptions.damage = parseInt(packDamageInput.value) || 4;
        scheduleAutosave();
    });
    packSpeedInput.addEventListener('input', () => {
        const v = (parseInt(packSpeedInput.value) || 25) / 100;
        document.getElementById('pack-speed-val').textContent = v.toFixed(2);
        if (state.packOptions) state.packOptions.speed = v;
        scheduleAutosave();
    });
    packJumpInput.addEventListener('input', () => {
        const on = packJumpInput.value === '1';
        document.getElementById('pack-jump-val').textContent = on ? 'on' : 'off';
        if (state.packOptions) state.packOptions.jump = on ? 1 : 0;
        scheduleAutosave();
    });
    packFlyingInput.addEventListener('change', () => {
        if (state.packOptions) state.packOptions.flying = packFlyingInput.checked;
        scheduleAutosave();
    });
    packNsInput.addEventListener('input', updatePackFileList);

    document.getElementById('pack-download').addEventListener('click', () => {
        const formats = currentPackFormats();
        const id = state.model.modelId.replace('geometry.', '');
        const ns = slugify(packNsInput.value || id) || id;
        ensureTexture();
        const animations = currentAnimations(); // palauttaa null jos ei animaatioita
        const packIcon = renderPackIcon(state.model, state.textureCanvas, 256);
        const { files } = buildResourcePack(state.model, {
            formats,
            namespace: ns,
            projectName: state.projectName || id,
            animations,
            primaryAnimation: state.currentAnimName,
            textureCanvas: state.textureCanvas,
            emissiveDataURL: state.emissiveDataURL || null,
            eggColors: averageEggColors(state.textureCanvas),
            packIcon,
            behavior: {
                type: currentPackBehavior(),
                health: parseInt(packHealthInput.value) || 20,
                damage: parseInt(packDamageInput.value) || 4,
                speed: (parseInt(packSpeedInput.value) || 25) / 100,
                jump: packJumpInput.value === '1',
                flying: packFlyingInput.checked,
            },
        });
        const zip = zipFiles(files);
        const blob = new Blob([zip], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const isMcaddon = formats.length === 1 && formats[0] === 'bedrock';
        const filename = isMcaddon ? `${id}.mcaddon` : `${id}_resource_pack.zip`;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        closePackDialog();
        setStatus(`${formats.length === 2 ? 'Java + Bedrock' : formats[0] === 'java' ? 'Java (GeckoLib)' : 'Bedrock'} pack downloaded (${files.length} files) — ${filename}${isMcaddon ? ' — open with Minecraft to install' : ''}`);
    });

    document.getElementById('btn-screenshot').addEventListener('click', exportScreenshot);
}

/**
 * 📸 Save PNG — tallentaa mobista PNG-kuvan nykyisestä kamerakulmasta.
 * Piilottaa ruudukon, akselit, gizmon, HTML-overlayn ja valintakorostuksen,
 * renderöi 2× tarkkuudella (supersamplaus) ja palauttaa kaiken ennalleen.
 */
function exportScreenshot() {
    if (!renderer) {
        setStatus('3D-näkymä ei ole käytettävissä (WebGL pois) — PNG:tä ei voida tallentaa');
        return;
    }

    // Piilota apuobjektit — tallennetaan tilat, jotta kaikki palautuu
    const restores = [];
    const hideObj = (o) => { restores.push(() => { o.visible = true; }); o.visible = false; };
    hideObj(gridHelper);
    hideObj(axesHelper);
    if (transformControls.object) {
        restores.push(() => { transformControls.visible = true; });
        transformControls.visible = false;
    }
    const overlay = document.getElementById('viewport-overlay');
    const overlayDisplay = overlay.style.display;
    overlay.style.display = 'none';

    // Valintakorostus (emissiivinen) pois kuvasta — vain valittu kuutio
    let selEmiss = null;
    if (state.selectedCube !== null && state.cubes[state.selectedCube]) {
        const mat = state.cubes[state.selectedCube].material;
        selEmiss = { hex: mat.emissive.getHex(), i: mat.emissiveIntensity };
        if (state.emissiveTexture) { mat.emissive.set(0xffffff); mat.emissiveIntensity = 1; }
        else { mat.emissive.set(0x000000); mat.emissiveIntensity = 0; }
    }

    try {
        // 2× supersamplaus: isompi piirtoalue, CSS-asettelu pysyy (updateStyle=false)
        const vp = document.getElementById('viewport');
        const w = vp.clientWidth, h = vp.clientHeight;
        renderer.setSize(w * 2, h * 2, false);
        camera.aspect = (w * 2) / (h * 2);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        const dataUrl = canvas.toDataURL('image/png');

        // Palauta näkymä ja lataa PNG
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);

        const filename = `${state.model.modelId.replace('geometry.', '')}_screenshot.png`;
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus(`PNG saved (${filename})`);
    } finally {
        restores.forEach(f => f());
        overlay.style.display = overlayDisplay;
        if (selEmiss) {
            const mat = state.cubes[state.selectedCube].material;
            mat.emissive.set(selEmiss.hex);
            mat.emissiveIntensity = selEmiss.i;
        }
    }
}

/**
 * Current animation set for export: library mob's multiple animations
 * (with the live editor track merged into the selected one), or the
 * single editor animation.
 */
/**
 * Piirtää spawn-eggin esikatselun 📦 Pack -dialogiin: munan kuori
 * tekstuurin keskiarvoväristä + vanilla-tyylinen täpläkuvio overlay-värillä.
 */
function drawEggPreview() {
    const canvas = document.getElementById('pack-egg-canvas');
    if (!canvas) return;
    ensureTexture();
    const colors = averageEggColors(state.textureCanvas) || { base: '#7da06a', overlay: '#4a5f3f' };
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Munan kuori (ellipsi, alhaalta hieman leveämpi)
    ctx.save();
    ctx.translate(W / 2, H * 0.55);
    ctx.scale(1, 1.18);
    ctx.beginPath();
    ctx.ellipse(0, 0, W * 0.36, H * 0.36, 0, 0, Math.PI * 2);
    ctx.fillStyle = colors.base;
    ctx.fill();
    // Alavalon varjostus
    ctx.beginPath();
    ctx.ellipse(0, H * 0.14, W * 0.34, H * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
    // Ylävalon heijastus
    ctx.beginPath();
    ctx.ellipse(-W * 0.1, -H * 0.2, W * 0.16, H * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.restore();

    // Vanilla-tyylinen täpläkuvio overlay-värillä (kiinteä asetelma)
    const spots = [
        [0.30, 0.26, 0.055], [0.63, 0.20, 0.045], [0.56, 0.36, 0.065],
        [0.30, 0.44, 0.05],  [0.70, 0.52, 0.06],  [0.26, 0.62, 0.05],
        [0.52, 0.66, 0.065], [0.71, 0.74, 0.045], [0.40, 0.80, 0.05],
        [0.61, 0.90, 0.04],  [0.47, 0.34, 0.03],  [0.64, 0.44, 0.035],
    ];
    ctx.fillStyle = colors.overlay;
    for (const [sx, sy, r] of spots) {
        ctx.beginPath();
        ctx.arc(W * sx, H * sy, Math.max(1.2, W * r), 0, Math.PI * 2);
        ctx.fill();
    }

    // Väritiedot
    document.getElementById('pack-egg-base-swatch').style.background = colors.base;
    document.getElementById('pack-egg-overlay-swatch').style.background = colors.overlay;
    document.getElementById('pack-egg-base').textContent = colors.base;
    document.getElementById('pack-egg-overlay').textContent = colors.overlay;
}

/** Piirtää pakki-ikonin esikatselun 📦 Pack -dialogiin. */
function drawPackIconPreview() {
    const canvas = document.getElementById('pack-icon-canvas');
    if (!canvas) return;
    ensureTexture();
    const icon = renderPackIcon(state.model, state.textureCanvas, 128);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(icon, 0, 0);
}

/** Spawn-eggin värit tekstuurin keskiarvosta (4×4 alasample). */
function averageEggColors(canvas) {
    try {
        const c = document.createElement('canvas');
        c.width = 4;
        c.height = 4;
        const ctx = c.getContext('2d');
        ctx.drawImage(canvas, 0, 0, 4, 4);
        const d = ctx.getImageData(0, 0, 4, 4).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue; // läpinäkyvät pois
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        if (!n) return null;
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        const hex = (v) => v.toString(16).padStart(2, '0');
        return {
            base: '#' + hex(r) + hex(g) + hex(b),
            overlay: '#' + hex(Math.round(r * 0.5)) + hex(Math.round(g * 0.5)) + hex(Math.round(b * 0.5)),
        };
    } catch {
        return null;
    }
}

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
/**
 * Luun maailmapositio (lepopose): luuryhmä on scene-hierarkiassa
 * vanhempansa sisällä paikassa pivot − parentPivot, joten ryhmän
 * maailmapositio = oma pivot (ketjun pivotit kumoutuvat). Kuutioiden
 * originit ja osien pivotit ovat mallikoordinaateissa (lepopose = maailma).
 */
function boneWorldPos(bone) {
    return [bone.pivot[0], bone.pivot[1], bone.pivot[2]];
}

/** Kuution maailmakeskipiste (lepopose): origin + koko/2 — pivot-ketju kumoutuu. */
function cubeWorldCenter(bone, cube) {
    return [
        cube.origin[0] + cube.size[0] / 2,
        cube.origin[1] + cube.size[1] / 2,
        cube.origin[2] + cube.size[2] / 2
    ];
}

/**
 * Maalaa kuution kasvoille kuvion (vaakaraidat tai täplät) olemassa olevan
 * perusvärin päälle. Raidat ovat MAAILMANKOherentteja: nauhojen vaihe
 * lasketaan kuution maailma-Y:stä, joten raidat jatkuvat saumattomasti
 * kuutioiden yli (sama korkeus = sama raita — koko vartalon yli). bandH
 * annetaan globaalina, jotta kaikki kuutiot käyttävät samaa rautaväliä.
 */
function paintCubePattern(tctx, cube, base, rand, kind, world, bandH) {
    const wc = world || [
        cube.origin[0] + cube.size[0] / 2,
        cube.origin[1] + cube.size[1] / 2,
        cube.origin[2] + cube.size[2] / 2
    ];
    for (const r of computeFaceRects(cube)) {
        const shade = FACE_SHADE[r.face] || 1;
        const x = Math.round(r.x), y = Math.round(r.y);
        const w = Math.round(r.w), h = Math.round(r.h);
        if (w < 2 || h < 2) continue;
        if (kind === 'stripes') {
            if (r.face === 'up' || r.face === 'down') {
                // Ylä-/alakasvot perussävyllä — raidat vain kyljissä, joten
                // vaakaraidat piirtyvät yhtenäisinä ympäri vartaloa.
                tctx.fillStyle = shadeHex(base, shade);
                tctx.fillRect(x, y, w, h);
                continue;
            }
            // Kylkikasvot: jokainen pikselirivi kartoittuu maailma-Y:hen
            // (rectin korkeus = kuution Y-koko), joten raidan raja osuu
            // samaan maailmankorkeuteen kuution reunasta riippumatta.
            const band = bandH || (1.5 + rand() * 1.5);
            for (let py = 0; py < h; py++) {
                const wy = wc[1] + (py + 0.5 - h / 2) * (cube.size[1] / h);
                const on = Math.floor(wy / band) % 2 === 0;
                tctx.fillStyle = shadeHex(base, shade * (on ? 1.18 : 0.68));
                tctx.fillRect(x, y + py, w, 1);
            }
        } else if (kind === 'spots') {
            // Täplät: maailmasoluun ankkuroitu seed, joten täplät pysyvät
            // paikoillaan myös jos kuution nimi muuttuu.
            const cellSeed = [Math.floor(wc[0] * 2), Math.floor(wc[1] * 2), Math.floor(wc[2] * 2), r.face]
                .join('|').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
            const srand = seededRand(cellSeed);
            const n = Math.max(2, Math.round((w * h) / 22));
            for (let i = 0; i < n; i++) {
                const s = Math.max(1, Math.round(srand() * 3));
                const px = x + Math.floor(srand() * Math.max(1, w - s));
                const py = y + Math.floor(srand() * Math.max(1, h - s));
                tctx.fillStyle = shadeHex(base, shade * (srand() < 0.5 ? 0.55 : 1.3));
                tctx.fillRect(px, py, s, s);
            }
        }
    }
}

/**
 * Satunnaiset mutta vakaat tekstuurikuviot (raidat/täplät) koko olennolle.
 * Raidat ovat maailmankoherentteja (yhteinen rautaväli koko vartalolle),
 * joten kuviot jatkuvat saumattomasti kuutioiden yli eivätkä näytä
 * satunnaiselta kohinalta. Valinta perustuu kuution nimen seediin — samasta
 * mallista tulee aina sama kuvio.
 */
function applyRandomTexturePatterns() {
    if (!state.textureCanvas) ensureTexture();
    const tctx = state.textureCanvas.getContext('2d');
    // Yhteinen rautaväli koko olennolle (projektin nimestä) → raidat
    // kohdistuvat kuutioiden yli myös satunnaiskuvioissa.
    const gseed = (state.projectName || 'body').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    const bandH = 1.5 + seededRand(gseed)() * 1.5;
    let patterned = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            const seed = (cube.name || 'cube').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) * 131
                + ((cube.uv && cube.uv.offset) ? cube.uv.offset[0] * 13 + cube.uv.offset[1] * 7 : 1);
            const rand = seededRand(seed);
            const roll = rand();
            const maxDim = Math.max(...computeFaceRects(cube).map(r => Math.max(r.w, r.h)));
            let kind = null;
            if (maxDim >= 4 && roll < 0.3) kind = 'stripes';
            else if (maxDim >= 3 && roll < 0.55) kind = 'spots';
            if (kind) {
                paintCubePattern(tctx, cube, cube.color || '#ffffff', rand, kind, cubeWorldCenter(bone, cube), bandH);
                patterned++;
            }
        }
    }
    if (patterned > 0) {
        state.texture.needsUpdate = true;
        if (state.uvEditor) state.uvEditor.draw();
    }
    return patterned;
}

/**
 * Pattern body -työkalu: maalaa koko vartalolle yhden koherentin kuvion
 * (raidat tai täplät projektin nimestä valittuna). Maalaa ensin puhtaat
 * perussävyt, sitten kuvion — yhdellä klikkauksella koko olento saa
 * yhtenäisen premium-kuvion.
 */
function applyBodyPatterns() {
    if (!state.textureCanvas) ensureTexture();
    const tctx = state.textureCanvas.getContext('2d');
    const seed = (state.projectName || 'body').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    const kind = seededRand(seed)() < 0.5 ? 'stripes' : 'spots';
    const bandH = 1.5 + seededRand(seed + 1)() * 1.5;
    let n = 0;
    for (const bone of state.model.bones) {
        for (const cube of bone.cubes) {
            const base = cube.color || '#ffffff';
            fillCubeFaces(tctx, cube, base);
            const maxDim = Math.max(...computeFaceRects(cube).map(r => Math.max(r.w, r.h)));
            if (kind === 'stripes' && maxDim < 4) continue;
            if (kind === 'spots' && maxDim < 2) continue;
            const cseed = (cube.name || 'cube').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) * 131
                + ((cube.uv && cube.uv.offset) ? cube.uv.offset[0] * 13 + cube.uv.offset[1] * 7 : 1);
            paintCubePattern(tctx, cube, base, seededRand(cseed), kind, cubeWorldCenter(bone, cube), bandH);
            n++;
        }
    }
    state.texture.needsUpdate = true;
    if (state.uvEditor) state.uvEditor.draw();
    setStatus(`Kuviotettu ${n} kuutiota (${kind}) — kuvio jatkuu yhtenäisenä koko kehon yli.`);
    scheduleAutosave();
    return n;
}

// ==================== MONIVALINNAN UV-TYÖKALUT ====================
// Toimivat kaikille valituille kuutioille kerralla (shift+klikkaa
// monivalintaan), tai yhdelle valitulle kuutiolle jos monivalintaa ei ole.

/** Valittujen kuutioiden globaalit indeksit (monivalinta tai yksittäinen). */
function uvSelectedIndices() {
    if (state.selectedCubes && state.selectedCubes.length) return state.selectedCubes;
    if (state.selectedCube !== null && state.selectedCube !== undefined) return [state.selectedCube];
    return [];
}

/** Kuution tekstuurisaarekkeen (island) rajat atlasissa: [u0, v0, w, h]. */
function uvIslandBounds(cube) {
    const rs = computeFaceRects(cube);
    if (!rs.length) return null;
    const minX = Math.min(...rs.map(r => r.x));
    const minY = Math.min(...rs.map(r => r.y));
    const maxX = Math.max(...rs.map(r => r.x + r.w));
    const maxY = Math.max(...rs.map(r => r.y + r.h));
    return [minX, minY, maxX - minX, maxY - minY];
}

/**
 * Kohdista UV:t: nappaa valittujen kuutioiden saarekkeet tekstuurin
 * 4px-ruudukkoon (offset + kasvojen siirrot). Poistaa manuaalisten
 * vetojen jättämät murto-osat ja kohdistaa saarekkeet samaan ruudukkoon,
 * joten kuvioiden rajat jatkuvat kuutioiden yli.
 */
function uvAlignSelected() {
    const idxs = uvSelectedIndices();
    if (!idxs.length) {
        setStatus('Valitse ensin kuutioita — Shift+klik monivalintaan');
        return 0;
    }
    const GRID = 4;
    let n = 0;
    for (const i of idxs) {
        const cube = findCubeData(i);
        if (!cube) continue;
        cube.uv = cube.uv || {};
        if (Array.isArray(cube.uv.offset)) {
            cube.uv.offset = [Math.round(cube.uv.offset[0] / GRID) * GRID, Math.round(cube.uv.offset[1] / GRID) * GRID];
        }
        if (cube.uv.faces) {
            for (const f of Object.keys(cube.uv.faces)) {
                const fo = cube.uv.faces[f];
                cube.uv.faces[f] = [Math.round(fo[0]), Math.round(fo[1])];
            }
        }
        n++;
    }
    applyAllBoxUVs();
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
    setStatus(`Kohdistettu ${n} kuution UV ${GRID}px-tekstuuriruudukkoon — kuviot jatkuvat kuutioiden yli.`);
    return n;
}

/**
 * Skaalaa UV:t: kasvattaa/pienentää valittujen kuutioiden tekstuuritiheyttä.
 * Jokainen saareke skaalataan oman keskipisteensä ympäri, joten atlas-
 * asettelu säilyy ja kaikki valitut saavat saman kertoimen (2× tai 0.5×).
 */
function uvScaleSelected(factor) {
    const idxs = uvSelectedIndices();
    if (!idxs.length) {
        setStatus('Valitse ensin kuutioita — Shift+klik monivalintaan');
        return 0;
    }
    const f = (factor === 0.5) ? 0.5 : 2;
    let n = 0;
    for (const i of idxs) {
        const cube = findCubeData(i);
        if (!cube) continue;
        const b = uvIslandBounds(cube);
        if (!b) continue;
        const [u0, v0, w, h] = b;
        cube.uv = cube.uv || {};
        // Uusi offset pitää saarekkeen keskipisteen paikallaan: newU = c − W·f/2
        cube.uv.offset = [
            Math.round((u0 + w / 2 - w * f / 2) * 10) / 10,
            Math.round((v0 + h / 2 - h * f / 2) * 10) / 10
        ];
        // uvSize määrää saarekkeen pikselikoon → tekstuuritiheys
        const base = cube.uvSize ? cube.uvSize.slice() : cube.size.slice();
        cube.uvSize = base.map(v => Math.round(v * f * 10) / 10);
        if (cube.uv.faces) {
            for (const face of Object.keys(cube.uv.faces)) {
                cube.uv.faces[face] = cube.uv.faces[face].map(v => Math.round(v * f * 10) / 10);
            }
        }
        n++;
    }
    applyAllBoxUVs();
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
    setStatus(`Skaalattu ${n} kuution UV ×${f} — tekstuuritiheys ${f === 2 ? 'kaksinkertaistui' : 'puolittui'}.`);
    return n;
}

/**
 * Peilaa UV:t: kääntää valittujen kuutioiden saarekkeet tekstuurin
 * keskilinjan yli (vaaka = U, pysty = V). Peilattu sijainti pysyy
 * tekstuurin rajoissa, joten kasvot näyttävät peilikuvan alueesta.
 */
function uvMirrorSelected(vertical) {
    const idxs = uvSelectedIndices();
    if (!idxs.length) {
        setStatus('Valitse ensin kuutioita — Shift+klik monivalintaan');
        return 0;
    }
    const texW = state.model.textureWidth || 16;
    const texH = state.model.textureHeight || 16;
    let n = 0;
    for (const i of idxs) {
        const cube = findCubeData(i);
        if (!cube) continue;
        const b = uvIslandBounds(cube);
        if (!b) continue;
        const [u0, v0, w, h] = b;
        cube.uv = cube.uv || {};
        if (vertical) {
            cube.uv.offset = [
                Math.round(u0 * 10) / 10,
                Math.round((texH - v0 - h) * 10) / 10
            ];
        } else {
            cube.uv.offset = [
                Math.round((texW - u0 - w) * 10) / 10,
                Math.round(v0 * 10) / 10
            ];
        }
        n++;
    }
    applyAllBoxUVs();
    if (state.uvEditor) state.uvEditor.draw();
    scheduleAutosave();
    setStatus(`Peilattu ${n} kuution UV tekstuurin ${vertical ? 'pysty' : 'vaaka'}keskiön yli.`);
    return n;
}

/**
 * Satunnainen emissiivinen valonhehku (glow) randomisoiduille olennoille.
 * Noin 35 % olennoista hehkuu: silmät tai valitut kuutiot saavat kirkkaan
 * emissiivisen värin, joka maalataan erilliseen glow-tekstuuriin
 * (emissiveDataURL) — sama mekanismi kuin pelin omilla glow-mobeilla
 * (esim. Deep Void). Päätös on deterministinen (seed projektin nimestä),
 * joten sama malli hehkuu samalla tavalla autosaven/päivityksen yli.
 * Palauttaa true jos olento hehkuu.
 */
function generateRandomGlow() {
    const seedStr = state.projectName || 'creature';
    const seed = seedStr.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) * 131;
    const rand = seededRand(seed);
    if (rand() >= 0.35) { // 35 %:lla hehku päällä
        state.emissiveTexture = null;
        state.emissiveDataURL = null;
        return false;
    }
    // Kuumat hehkuvärit — syaani, vihreä, punainen, violetti, keltainen, sininen
    const GLOW_COLORS = ['#66ffff', '#66ff66', '#ff6666', '#ff66ff', '#ffff66', '#66aaff'];
    const glowColor = GLOW_COLORS[Math.floor(rand() * GLOW_COLORS.length)];
    const c = document.createElement('canvas');
    c.width = state.model.textureWidth;
    c.height = state.model.textureHeight;
    const tctx = c.getContext('2d');

    // Kohteet: ensin silmät/valo-osat, muuten 1–2 pientä kuutiota
    const all = [];
    for (const bone of state.model.bones) for (const cube of bone.cubes) all.push(cube);
    const eyeCubes = all.filter(cu => /eye|glow|lamp|orb|gem|beacon/i.test(cu.name || ''));
    let targets = eyeCubes.length ? eyeCubes.slice() : [];
    if (!targets.length) {
        const pool = all.filter(cu => {
            const d = cu.size || [1, 1, 1];
            return Math.max(...d) <= 2;
        });
        const src = pool.length ? pool : all;
        const n = Math.min(src.length, 1 + (rand() < 0.4 ? 1 : 0));
        for (let i = 0; i < n && src.length; i++) {
            targets.push(src.splice(Math.floor(rand() * src.length), 1)[0]);
        }
    }
    for (const cube of targets) {
        for (const r of computeFaceRects(cube)) {
            tctx.fillStyle = glowColor;
            tctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
        }
    }
    state.emissiveDataURL = c.toDataURL();
    applyEmissiveTexture();
    return true;
}

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
    const url = state.textureDataURL;
    if (!url) {
        state.texture = null;
        state.textureCanvas = null;
        applyEmissiveTexture();
        if (state.uvEditor) state.uvEditor.draw();
        return;
    }
    const img = new Image();
    img.onload = () => {
        // Race-suojaus: jos käyttäjä on jo ladannut toisen mobin tämän kuvan
        // latauksen aikana (textureDataURL vaihtui), älä kirjoita vanhaa
        // tekstuuria uuden mobin päälle.
        if (state.textureDataURL !== url) return;
        const c = document.createElement('canvas');
        c.width = state.model.textureWidth;
        c.height = state.model.textureHeight;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.textureCanvas = c;
        state.texture = makeTextureFromCanvas(c);
        rebuildModel();
        applyEmissiveTexture();
    };
    img.src = url;
}

/**
 * Lataa mobin emissiivinen glow-tekstuuri (pelin oma glow-kerros) ja
 * asettaa sen emissiveMapiksi kaikkiin materiaaleihin. Pohjatekstuuri
 * pysyy puhtaana — hehku tulee tästä kerroksesta, kuten pelissä.
 */
function applyEmissiveTexture() {
    state.emissiveTexture = null;
    const url = state.emissiveDataURL;
    if (!url) { rebuildModel(); return; }
    const img = new Image();
    img.onload = () => {
        // Race-suojaus kuten applyTextureDataURL:ssa: älä aseta vanhan mobin
        // glow-kerrosta mobin päälle, jonka käyttäjä lataa kuvan latautuessa.
        if (state.emissiveDataURL !== url) return;
        const c = document.createElement('canvas');
        c.width = state.model.textureWidth;
        c.height = state.model.textureHeight;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.emissiveTexture = makeTextureFromCanvas(c);
        rebuildModel();
    };
    img.src = url;
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
    // Test Creature: välilyönti hyppää (animaation play/pause on pois käytöstä
    // testitilassa animation.js:ssä — Space kuuluu hypylle)
    if (state.testMode && (e.code === 'Space' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const root = state.testRoot;
        if (root && Math.abs(root.position.y - state.testGroundY) < 0.01 && state.testVy === 0) {
            state.testVy = 11;
        }
        return;
    }
    // Blockbench-tyylinen liikutus: pikanäppäimet siirtävät valittua kuutiota
    // (tai kuutioita). ←/→ X, ↑/↓ Z, Ctrl+↑/Ctrl+↓ = Y (ylös/alas). Shift =
    // isompi askel (4×). Testitilassa nuolet/ArrowUp on jo varattu liikutukselle
    // ja hypylle, joten nudge ei aktiivoidu. Ilman valintaa annetaan selaimen
    // oletustoiminto.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (state.testMode) return;
        const t = document.activeElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const hasSel = state.selectedCube !== null || (state.selectedCubes && state.selectedCubes.length > 0);
        if (!hasSel) return;
        const isCtrl = e.ctrlKey || e.metaKey;
        // Ctrl+↑ / Ctrl+↓ = pystysuuntainen liike (Y-akseli). Ctrl+← / Ctrl+→
        // jätetään selaimelle (esim. sanan hyppy / ikkunan vaihto).
        if (isCtrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const step = e.shiftKey ? 4 : 1;
            if (e.key === 'ArrowUp') nudgeSelected(0, 1, 0, step);   // Ctrl+↑ = +Y (ylös)
            else nudgeSelected(0, -1, 0, step);                       // Ctrl+↓ = −Y (alas)
            return;
        }
        if (isCtrl) return; // muut Ctrl+nuoli → oletuskäyttäytyminen
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        if (e.key === 'ArrowLeft') nudgeSelected(-1, 0, 0, step);
        else if (e.key === 'ArrowRight') nudgeSelected(1, 0, 0, step);
        else if (e.key === 'ArrowUp') nudgeSelected(0, 0, -1, step);
        else if (e.key === 'ArrowDown') nudgeSelected(0, 0, 1, step);
        return;
    }
    // Delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName === 'INPUT') return;
        deleteSelected();
    }

    // Tool shortcuts
    if (document.activeElement.tagName === 'INPUT') return;

    // UV-työkalut valituille kuutioille: A = kohdista, ] = skaalaa UV:tä 2×
    // ([ = 0.5×), M = peilaa (Shift = pysty). S on vapautettu UV-skaalauksesta
    // ja toimii nyt Blockbench-tyylisenä Resize-työkaluna (kuution koon
    // venytys gizmon kautta) — siksi UV-mittakaava on siirretty hakasulkuihin.
    if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        uvAlignSelected();
        return;
    }
    if (e.key === ']') {
        e.preventDefault();
        uvScaleSelected(2);
        return;
    }
    if (e.key === '[') {
        e.preventDefault();
        uvScaleSelected(0.5);
        return;
    }
    if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        uvMirrorSelected(!!e.shiftKey);
        return;
    }

    if (e.key === 'p' || e.key === 'P') {
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setTool('paint'); }
        return;
    }
    if (e.key === 'i' || e.key === 'I') {
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setTool('pipette'); }
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        state.boneMode = !state.boneMode;
        canvas.style.cursor = state.boneMode ? 'pointer' : '';
        setStatus(state.boneMode
            ? 'Bone mode ON — click a cube to select its bone for posing (B again to exit)'
            : 'Bone mode OFF');
        return;
    }
    if (e.key === 'f' || e.key === 'F') {
        if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            fitCameraToMob({ fit: computeModelFit(state.model) });
        }
        return;
    }
    if (e.key === 'v' || e.key === 'V' || e.key === 'g') {
        // Blockbench: V = Move-työkalu (G toimii myös vanhana pikanäppäimenä)
        setTool('move');
    } else if (e.key === 'r') {
        setTool('rotate');
    } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        // Blockbench: S = Resize (kuution koon venytys) kun kuutio tai luu on
        // valittuna; ilman valintaa S vaihtaa Select-työkaluun.
        if (state.selectedCube !== null || state.selectedBone !== null) {
            e.preventDefault();
            setTool('scale');
        } else {
            setTool('select');
        }
    }

    // Ctrl+Z / Ctrl+Y — ensin maalausvedot (jos niitä on), sitten malli
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (undoPaint()) { setStatus('Undo paint'); return; }
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
        if (redoPaint()) {            setStatus('Redo paint'); return; }
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

// ==================== TUO/VIE MENU SHORTCUTS (⌘I / ⌘E) ====================
// Valikot ovat details/summary-elementtejä: oikotie avaa valikon ja
// kohdistaa ensimmäisen kohdan; uudelleen painaminen siirtyy seuraavaan
// (tavallinen valikkokäytäntö). Escape sulkee ja palauttaa kohdistuksen.
const menuImportEl = document.getElementById('menu-import');
const menuExportEl = document.getElementById('menu-export');

function cycleMenu(menuEl) {
    const items = [...menuEl.querySelectorAll('.menu-items button')];
    if (!items.length) return;
    if (!menuEl.open) {
        menuEl.open = true;
        items[0].focus();
        setStatus(menuEl === menuImportEl ? 'Import… — choose format' : 'Export… — choose format');
        return;
    }
    const idx = items.indexOf(document.activeElement);
    const next = items[(idx + 1) % items.length];
    next.focus();
}

document.addEventListener('keydown', (e) => {
    const t = document.activeElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    // ⌘I / ⌘E (myös Ctrl) — avaa/kiertää Tuo/Vie-valikkoa
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'i' || k === 'e') {
            e.preventDefault();
            cycleMenu(k === 'i' ? menuImportEl : menuExportEl);
            return;
        }
    }

    // Escape — sulje avoin valikko ja palauta kohdistus summaryyn
    if (e.key === 'Escape') {
        const open = document.querySelector('details.menu[open]');
        if (open) {
            open.open = false;
            open.querySelector('summary').focus();
            e.preventDefault();
        }
    }
});

// Kohdan valinta tai klikkaus valikon ulkopuolelle sulkee valikon
document.addEventListener('click', (e) => {
    const menu = e.target.closest('details.menu');
    if (menu && e.target.closest('.menu-items button')) {
        menu.open = false;
    } else if (!menu) {
        document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; });
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
// ==================== TEST CREATURE ====================
// Spore-henkinen testitila: olento kävelee/ryömii/lentää/uii maatasolla
// eteenpäin, kamera seuraa sivulta ja välilyönti hyppää. Koko malli
// siirretään tilapäisesti omaan testRoot-ryhmään (luut pysyvät paikallaan,
// animaatiot toimivat normaalisti), joka liikkuu eteenpäin joka framessa.
state.testMode = false;
state.testRoot = null;
state.testGroundY = 0;
state.testVy = 0;
// Harjoitusvihollinen: olento tavoittelee, hyökkää ja kaataa sen
state.testTarget = null;          // THREE.Group (dummy + HP-baari)
state.testTargetHp = 0;
state.testTargetMaxHp = 0;
state.testAttackCd = 0;           // hyökkäyscooldown (s)
state.testTargetDeadT = 0;        // kuolema-aikaviive ennen respawnia
let testLastT = 0;

function setTestMode(on) {
    if (on === state.testMode) return;
    const btn = document.getElementById('btn-test');
    if (btn) btn.classList.toggle('active', on);
    if (on) enterTestMode();
    else exitTestMode();
}

function enterTestMode() {
    state.testMode = true;
    // Maasto + varjot näkyviin (Game Preview) ja gizmo pois
    const gp = document.getElementById('chk-game-preview');
    if (gp && !gp.checked) { gp.checked = true; setGamePreview(true); }
    updateShadowBounds();
    if (state.selectedPart) deselectAll();
    if (transformControls.object) transformControls.detach();
    transformControls.enabled = false;
    orbitControls.enabled = false;

    // Koko malli omaan ryhmään, jotta se voi liikkua vapaasti
    const root = new THREE.Group();
    root.name = 'testRoot';
    state.model.bones.forEach((b, bi) => {
        const hasParent = b.parent && state.model.bones.some(o => o.name === b.parent);
        if (!hasParent && state.bones[bi]) { scene.remove(state.bones[bi]); root.add(state.bones[bi]); }
    });
    scene.add(root);
    state.testRoot = root;
    // Jalat maahan (mallin alareuna y = 0)
    const bb = modelBBox();
    state.testGroundY = bb ? -bb.mn[1] : 0;
    root.position.y = state.testGroundY;
    state.testVy = 0;

    // Liikkumisanimaatio päälle: walk > crawl > fly > swim > idle
    const anims = Object.keys(state.projectAnimations || {});
    const pick = ['walk', 'crawl', 'fly', 'swim', 'idle'].find(n => anims.includes(n));
    if (pick) {
        const sel = document.getElementById('anim-select');
        if (sel) { sel.value = pick; sel.dispatchEvent(new Event('change')); }
    }
    if (state.animation) state.animation.playing = true;
    state.testTargetHp = 0;
    state.testTargetDeadT = 0;
    spawnTestTarget();
    setStatus('Test Creature — it hunts! The creature walks to the dummy and attacks it. Space = jump · click Test again to exit');
}

/** Luo harjoitusvihollinen (dummy + HP-baari) olennon eteen. */
function spawnTestTarget() {
    const root = state.testRoot;
    if (!root) return;
    // Poista vanha vihollinen
    if (state.testTarget) {
        scene.remove(state.testTarget);
        state.testTarget.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        state.testTarget = null;
    }
    // Etäisyys seuraa mallin kokoa, mutta nukki on aina kompakti harjoitusmaali:
    // sen korkeus ei riipu lähes koko mallista (isolla mobilla 90 % korkeudesta
    // näytti "toiselta halkeilevalta hahmolta" pelkän targetin sijaan).
    const bb = modelBBox();
    const h = bb ? Math.max(0.5, bb.mx[1] - bb.mn[1]) : 2;
    const dist = Math.max(18, h * 3 + 12);
    const th = Math.min(3, Math.max(1.6, h * 0.3)); // kompakti, ihmismittainen nukki
    const thp = Math.round(30 + h * 8);

    const g = new THREE.Group();
    g.name = 'testTarget';
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4605a, roughness: 0.8 });
    // Vartalo + pää + jalat (yksinkertainen harjoitusnukke)
    const body = new THREE.Mesh(new THREE.BoxGeometry(th * 0.5, th * 0.55, th * 0.4), mat);
    body.position.y = th * 0.35;
    const head = new THREE.Mesh(new THREE.BoxGeometry(th * 0.28, th * 0.3, th * 0.28), mat);
    head.position.y = th * 0.85;
    const legMat = new THREE.MeshStandardMaterial({ color: 0x8a4a45, roughness: 0.9 });
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(th * 0.2, th * 0.25, th * 0.2), legMat);
    leg1.position.set(-th * 0.14, th * 0.1, 0);
    const leg2 = leg1.clone();
    leg2.position.x = th * 0.14;
    g.add(body, head, leg1, leg2);
    // HP-baari pään yläpuolella (tausta + täyttö)
    const bw = th * 0.7;
    const bar = new THREE.Group();
    const barBg = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    const barFill = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: 0x59d45c }));
    barFill.position.z = 0.01;
    bar.add(barBg, barFill);
    bar.position.y = th * 1.15;
    g.add(bar);
    g.userData = { barFill, thp, th, dead: false, hitT: 0, mat, legMat, bw };
    // Sijoitetaan olennon eteen (malli katsoo -Z:tä), hieman sivulle.
    // Nostetaan nukki hieman niin että jalkaterät koskettavat maata (osien
    // keskipisteet alkavat hiukan nollan alapuolelta).
    g.position.set(root.position.x + (Math.random() - 0.5) * 4, state.testGroundY + th * 0.04, root.position.z - dist);
    scene.add(g);
    state.testTarget = g;
    state.testTargetHp = thp;
    state.testTargetMaxHp = thp;
    state.testAttackCd = 0;
    state.testTargetDeadT = 0;
}

function exitTestMode() {
    const root = state.testRoot;
    state.testMode = false;
    state.testRoot = null;
    state.testVy = 0;
    if (state.testTarget) {
        scene.remove(state.testTarget);
        state.testTarget.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        state.testTarget = null;
    }
    state.testTargetHp = 0;
    state.testTargetDeadT = 0;
    if (root) {
        // Palauta luut takaisin sceneen (applyPose palauttaa lepoposeen)
        state.model.bones.forEach((b, bi) => {
            const hasParent = b.parent && state.model.bones.some(o => o.name === b.parent);
            if (!hasParent && state.bones[bi] && state.bones[bi].parent === root) {
                root.remove(state.bones[bi]);
                scene.add(state.bones[bi]);
            }
        });
        scene.remove(root);
    }
    transformControls.enabled = true;
    orbitControls.enabled = true;
    if (state.animation) { state.animation.applyPose(); state.animation.playing = false; }
    const fit = computeModelFit(state.model);
    if (fit) fitCameraToMob({ fit });
    setStatus('Test mode off — back to editing');
}

/** Tavoittele, hyökkää ja liikuta olentoa; seuraa kameralla (joka frame). */
function updateTestMode(dt) {
    const root = state.testRoot;
    if (!root) return;
    const bb = modelBBox();
    const h = bb ? Math.max(0.5, bb.mx[1] - bb.mn[1]) : 2;
    const speed = Math.max(2, h * 0.8);
    const target = state.testTarget;
    const anims = Object.keys(state.projectAnimations || {});
    const hasAttack = anims.includes('attack');
    const walkName = ['walk', 'crawl', 'fly', 'swim', 'idle'].find(n => anims.includes(n));

    // --- Vihollinen: kuolema-aika (kaatuu) → respawn ---
    if (state.testTargetDeadT > 0) {
        state.testTargetDeadT -= dt;
        if (target) target.rotation.z = Math.min(1.5, target.rotation.z + dt * 2.5);
        if (state.testTargetDeadT <= 0) spawnTestTarget();
    }

    // --- Vihollinen: tavoittelu + hyökkäys ---
    let animToPlay = walkName;
    if (target && state.testTargetDeadT <= 0) {
        const dx = target.position.x - root.position.x;
        const dz = target.position.z - root.position.z;
        const dist = Math.hypot(dx, dz);
        const attackRange = Math.max(2.2, h * 0.9);
        if (dist > attackRange) {
            // Kävele kohti vihollista — malli katsoo -Z:tä, joten käännä ryhmä
            // niin että -Z osoittaa viholliseen: forward = (-sin a, -cos a).
            const ang = Math.atan2(-dx, -dz);
            root.rotation.y = ang;
            if (state.animation && state.animation.playing) {
                const step = speed * dt;
                root.position.x += (dx / dist) * step;
                root.position.z += (dz / dist) * step;
            }
        } else {
            // Hyökkää: isku cooldownin välein, vihollinen menettää elämää
            root.rotation.y = Math.atan2(-dx, -dz);
            if (hasAttack) animToPlay = 'attack';
            state.testAttackCd -= dt;
            if (state.testAttackCd <= 0) {
                state.testAttackCd = Math.max(0.5, 1.1 - h * 0.05);
                state.testTargetHp -= 10 + Math.round(h * 3);
                const ud = target.userData || {};
                ud.hitT = 0.15; // osumaefekti: välähdys
                if (state.testTargetHp <= 0) {
                    state.testTargetHp = 0;
                    state.testTargetDeadT = 1.2;
                    setStatus('Target defeated! A new dummy appears…');
                } else {
                    setStatus(`Test Creature — attacking! Target HP ${Math.max(0, state.testTargetHp)}/${state.testTargetMaxHp}`);
                }
            }
        }
    } else if (state.animation && state.animation.playing && !target) {
        // Ei vihollista: kävele eteenpäin kuten ennen
        root.position.z -= speed * dt;
    }

    // Vaihda animaatiota vain jos se muuttui (vältä turhat reloadit)
    const sel = document.getElementById('anim-select');
    if (sel && animToPlay && sel.value !== animToPlay && state.projectAnimations[animToPlay]) {
        sel.value = animToPlay;
        sel.dispatchEvent(new Event('change'));
        if (state.animation) state.animation.playing = true;
    }

    // Vihollisen osumaefekti: välähdä vaaleana ja päivitä HP-baari
    if (target && target.userData) {
        const ud = target.userData;
        if (ud.hitT > 0) {
            ud.hitT -= dt;
            const flash = ud.hitT > 0;
            target.traverse(o => {
                if (o.isMesh && o.material && o.material.color) {
                    o.material.color.set(flash ? 0xfff0e0 : (o.material === ud.legMat ? 0x8a4a45 : 0xd4605a));
                }
            });
        }
        const ratio = Math.max(0, state.testTargetHp / state.testTargetMaxHp);
        if (ud.barFill) {
            ud.barFill.scale.x = Math.max(0.001, ratio);
            ud.barFill.position.x = -(1 - ratio) * ud.bw / 2;
        }
    }

    // Hyppy + painovoima
    if (state.testVy !== 0 || root.position.y > state.testGroundY + 0.001) {
        state.testVy -= 28 * dt;
        root.position.y += state.testVy * dt;
        if (root.position.y <= state.testGroundY) {
            root.position.y = state.testGroundY;
            state.testVy = 0;
        }
    }
    // Kamera seuraa sivulta (vakioetäisyys)
    const p = root.position;
    camera.position.set(p.x + 12, p.y + 8, p.z + 16);
    camera.lookAt(p.x, p.y + 3, p.z);
}

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - (testLastT || now)) / 1000);
    testLastT = now;
    if (state.testMode) {
        updateTestMode(dt);
    } else {
        orbitControls.update();
    }
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
                setStatus(`${cubeData.name}: ${cubeData.size[0]} × ${cubeData.size[1]} × ${cubeData.size[2]}`);
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
        renderPalette();
    });

    document.getElementById('uv-brush-size').addEventListener('input', (e) => {
        state.uvEditor.setBrushSize(parseInt(e.target.value));
    });

    // ---- väripaletti ---------------------------------------------
    const palettePanel = document.getElementById('uv-palette');
    const catsEl = document.getElementById('palette-cats');
    const gridEl = document.getElementById('palette-grid');
    const colorInput = document.getElementById('uv-paint-color');
    let paletteCat = 'skin';
    let customColors = loadCustomColors(); // [{ hex, name }]

    function currentPalette() {
        if (paletteCat === 'custom') return customColors.map((c) => c.hex);
        const cat = PALETTE_CATEGORIES.find((c) => c.id === paletteCat);
        return cat ? cat.colors : [];
    }

    function renderPalette() {
        if (palettePanel.hidden) return;
        const allCats = [...PALETTE_CATEGORIES, { id: 'custom', name: 'Omat' }];
        catsEl.innerHTML = '';
        for (const cat of allCats) {
            const b = document.createElement('button');
            b.className = 'palette-cat' + (cat.id === paletteCat ? ' active' : '');
            b.textContent = cat.name;
            b.dataset.cat = cat.id;
            catsEl.appendChild(b);
        }
        gridEl.innerHTML = '';
        const cur = normalizeHex(state.uvEditor.getPaintColor());
        if (paletteCat === 'custom') {
            // Nimetyt chipit: väripallo + nimi
            customColors.forEach((c, i) => {
                const s = document.createElement('button');
                s.className = 'palette-swatch named' + (normalizeHex(c.hex) === cur ? ' selected' : '');
                const dot = document.createElement('i');
                dot.className = 'swatch-dot';
                dot.style.background = c.hex;
                const label = document.createElement('span');
                label.className = 'swatch-label';
                label.textContent = c.name || c.hex;
                s.appendChild(dot);
                s.appendChild(label);
                s.dataset.color = c.hex;
                s.dataset.idx = i;
                s.title = (c.name || c.hex) + ' (' + c.hex + ') — klikkaa käyttääksesi, kaksoisklikkaa nimetäksesi, oikea klikkaus poistaa';
                gridEl.appendChild(s);
            });
            const add = document.createElement('button');
            add.className = 'palette-swatch action wide';
            add.textContent = '＋ Tallenna väri…';
            add.title = 'Tallenna nykyinen maalausväri nimellä';
            add.dataset.action = 'add';
            gridEl.appendChild(add);
            const clr = document.createElement('button');
            clr.className = 'palette-swatch action';
            clr.textContent = '🗑';
            clr.title = 'Tyhjennä omat värit';
            clr.dataset.action = 'clear';
            gridEl.appendChild(clr);
        } else {
            currentPalette().forEach((c, i) => {
                const s = document.createElement('button');
                s.className = 'palette-swatch' + (normalizeHex(c) === cur ? ' selected' : '');
                s.style.background = c;
                s.dataset.color = c;
                s.dataset.idx = i;
                s.title = c;
                gridEl.appendChild(s);
            });
        }
    }

    function pickColor(hex) {
        state.uvEditor.setPaintColor(hex);
        colorInput.value = hex;
        renderPalette();
    }

    // ---- tallenna / nimeä väri -dialogi ---------------------------
    const colorDialog = document.getElementById('save-color-dialog');
    const colorNameInput = document.getElementById('save-color-name');
    const colorHexInput = document.getElementById('save-color-hex');
    const colorPreview = document.getElementById('save-color-preview');
    const colorTitle = document.getElementById('save-color-title');
    let colorDialogMode = 'add'; // 'add' | 'rename'
    let colorDialogIndex = -1;

    function updateColorPreview() {
        const h = normalizeHex(colorHexInput.value);
        if (h) {
            colorHexInput.value = h;
            colorPreview.textContent = h;
            colorPreview.style.background = h;
        }
    }

    function openColorDialog(mode, index) {
        colorDialogMode = mode;
        colorDialogIndex = index;
        if (mode === 'rename' && customColors[index]) {
            colorTitle.textContent = 'Nimeä väri';
            colorNameInput.value = customColors[index].name || '';
            colorHexInput.value = customColors[index].hex;
        } else {
            colorTitle.textContent = 'Tallenna väri palettiin';
            colorNameInput.value = '';
            colorHexInput.value = normalizeHex(state.uvEditor.getPaintColor()) || '#888888';
        }
        colorNameInput.placeholder = defaultColorName(colorHexInput.value);
        updateColorPreview();
        colorDialog.style.display = 'flex';
        setTimeout(() => colorNameInput.focus(), 30);
    }

    function closeColorDialog() {
        colorDialog.style.display = 'none';
    }

    function confirmColorDialog() {
        const hex = normalizeHex(colorHexInput.value);
        if (!hex) return;
        let name = colorNameInput.value.trim();
        if (!name) name = defaultColorName(hex);
        if (colorDialogMode === 'rename' && colorDialogIndex >= 0 && customColors[colorDialogIndex]) {
            customColors[colorDialogIndex] = { hex, name };
        } else {
            // dedupe: sama hex päivittää olemassa olevan nimen
            const existing = customColors.findIndex((c) => c.hex === hex);
            if (existing >= 0) customColors[existing] = { hex, name };
            else customColors.push({ hex, name });
        }
        saveCustomColors(customColors);
        pickColor(hex);
        closeColorDialog();
    }

    colorHexInput.addEventListener('input', updateColorPreview);
    colorNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmColorDialog(); }
    });
    colorDialog.addEventListener('click', (e) => {
        if (e.target === colorDialog) closeColorDialog();
    });
    colorDialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeColorDialog();
    });
    document.getElementById('save-color-confirm').addEventListener('click', confirmColorDialog);
    document.getElementById('save-color-cancel').addEventListener('click', closeColorDialog);

    catsEl.addEventListener('click', (e) => {
        const b = e.target.closest('.palette-cat');
        if (!b) return;
        paletteCat = b.dataset.cat;
        renderPalette();
    });

    gridEl.addEventListener('click', (e) => {
        const s = e.target.closest('.palette-swatch');
        if (!s) return;
        if (s.dataset.action === 'add') {
            openColorDialog('add', -1);
            return;
        }
        if (s.dataset.action === 'clear') {
            customColors = [];
            saveCustomColors(customColors);
            renderPalette();
            return;
        }
        pickColor(s.dataset.color);
    });

    gridEl.addEventListener('dblclick', (e) => {
        const s = e.target.closest('.palette-swatch');
        if (!s || paletteCat !== 'custom' || s.dataset.action) return;
        openColorDialog('rename', parseInt(s.dataset.idx));
    });

    gridEl.addEventListener('contextmenu', (e) => {
        const s = e.target.closest('.palette-swatch');
        if (!s || paletteCat !== 'custom' || s.dataset.action) return;
        e.preventDefault();
        customColors = customColors.filter((_, i) => i !== parseInt(s.dataset.idx));
        saveCustomColors(customColors);
        renderPalette();
    });

    document.getElementById('btn-toggle-palette').addEventListener('click', () => {
        palettePanel.hidden = !palettePanel.hidden;
        renderPalette();
    });
    renderPalette();

    window.addEventListener('resize', () => state.uvEditor.resize());
    setTimeout(() => state.uvEditor.resize(), 50);
}

/**
 * Yksinkertaistettu UI aloittelijoille: edistyneet osiot (Bones/Hierarchy,
 * Locators, UV-editori, Voxelize) ovat oletuksena kollapsattuja klikattavan
 * otsikon taakse, ja aloitusvihje näyttää 4-vaiheisen rakennuspolun.
 */
function setupSimplifiedUI() {
    // Kollapsattavat osiot: klikkaus otsikosta avaa/sulkee sisällön
    for (const section of document.querySelectorAll('.panel-section.collapsible')) {
        const h3 = section.querySelector(':scope > h3');
        if (!h3) continue;
        h3.addEventListener('click', (e) => {
            // Älä sulje, jos klikkaus osui sisäiseen nappiin (esim. + Add)
            if (e.target.closest('button')) return;
            section.classList.toggle('panel-collapsed');
        });
        // Edistyneet osiot piilossa oletuksena
        if (section.classList.contains('advanced')) section.classList.add('panel-collapsed');
    }

    // Mob Library oletuksena kollapsissa — rakennustyökalut näkyvät ensin
    const libSection = document.getElementById('lib-section');
    if (libSection) libSection.classList.add('panel-collapsed');

    // Voxelize-kytkin (edistynyt): avaa/sulkee pudotusalueen
    const voxelToggle = document.getElementById('voxel-toggle');
    const voxelDrop = document.getElementById('voxel-dropzone');
    if (voxelToggle && voxelDrop) {
        voxelDrop.style.display = 'none';
        voxelToggle.addEventListener('click', () => {
            const open = voxelDrop.style.display !== 'none';
            voxelDrop.style.display = open ? 'none' : '';
            voxelToggle.classList.toggle('open', !open);
        });
    }

    // Välilehtien ohjetekstit: näytetään ensimmäisinä käynnistyskertoina,
    // sitten piilotetaan automaattisesti (kokeneempi käyttäjä ei tarvitse niitä).
    const hintsKey = 'tab-hints-count';
    let hintCount = parseInt(localStorage.getItem(hintsKey) || '0', 10) || 0;
    hintCount += 1;
    localStorage.setItem(hintsKey, String(hintCount));
    if (hintCount >= 4) {
        document.body.classList.add('hints-hidden');
    }

    // Aloitusvihje: sulje ja muista sulkeminen
    const hint = document.getElementById('start-hint');
    const hintClose = document.getElementById('start-hint-close');
    if (hint && hintClose) {
        if (localStorage.getItem('start-hint-dismissed') === '1') hint.hidden = true;
        hintClose.addEventListener('click', () => {
            hint.hidden = true;
            localStorage.setItem('start-hint-dismissed', '1');
        });
    }

    // ---- Referenssikuva: lataa kuva (esim. mob jota haluat matkia) ja
    // näytä se viewportin oikeassa laidassa koko rakentamisen ajan ----
    const refToggle = document.getElementById('ref-toggle');
    const refPanel = document.getElementById('ref-panel');
    const refImg = document.getElementById('ref-img');
    const refFile = document.getElementById('ref-file');
    const refChoose = document.getElementById('ref-choose');
    const refClose = document.getElementById('ref-close');
    const refOpacity = document.getElementById('ref-opacity');
    if (refToggle && refPanel && refImg && refFile) {
        refToggle.addEventListener('click', () => {
            if (refPanel.hidden && !refImg.src) { refFile.click(); return; }
            refPanel.hidden = !refPanel.hidden;
            refToggle.classList.toggle('on', !refPanel.hidden);
        });
        if (refChoose) refChoose.addEventListener('click', () => refFile.click());
        refFile.addEventListener('change', () => {
            const f = refFile.files && refFile.files[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            refImg.src = url;
            refPanel.hidden = false;
            refToggle.classList.add('on');
            refToggle.textContent = '🖼 Referenssi';
            setStatus('Referenssikuva ladattu — näkyy sivulla, josta voit ottaa mallia. Säädä läpinäkyvyyttä liukusäätimellä.');
        });
        if (refClose) refClose.addEventListener('click', () => {
            refPanel.hidden = true;
            refToggle.classList.remove('on');
        });
        if (refOpacity) refOpacity.addEventListener('input', () => {
            refImg.style.opacity = refOpacity.value;
        });
    }
}

// ==================== INIT ====================
updateProjectNameLabel();
setupSimplifiedUI();
setupToolbar();
setupPropertyInputs();
setupLocatorPanel();
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
// Palauta autosaven preview-asetukset (päivä/yö, taustaväri, Game Preview -oletus)
if (saved && saved.previewOptions) applyPreviewOptions(saved.previewOptions);
animate();

if (!state.webgl) {
    // No WebGL: 3D viewport stays dark but everything else works.
    canvas.style.background = '#161b22';
    setStatus('Editori toimii ilman 3D-näkymää (WebGL pois) — avaa se WebGL-tukevassa selaimessa');
} else {
    setStatus('Freebuff Mob Studio valmis — lisää kuutioita ja luita aloittaaksesi rakentamisen');
}
window.__MOB_STUDIO = state;  // dev/debug handle
window.__MOB_STUDIO.renderer = renderer;
window.__MOB_STUDIO.camera = camera;
window.__MOB_STUDIO.checkRenderConsistency = checkRenderConsistency;
window.__MOB_STUDIO.applySymmetryEdit = applySymmetryEdit;
window.__MOB_STUDIO.selectCube = selectCube;
window.__MOB_STUDIO.selectBone = selectBone;
window.__MOB_STUDIO.updatePropertiesFromObject = updatePropertiesFromObject;
window.__MOB_STUDIO.updateBoneFromObject = updateBoneFromObject;
window.__MOB_STUDIO.updateCubeMeshInPlace = updateCubeMeshInPlace;
window.__MOB_STUDIO.updateBoneGroupInPlace = updateBoneGroupInPlace;
window.__MOB_STUDIO.mirrorCubeTransform = mirrorCubeTransform;
window.__MOB_STUDIO.mirrorBoneTransform = mirrorBoneTransform;
window.__MOB_STUDIO.findCubeData = findCubeData;
window.__MOB_STUDIO.getCubeMirrorMap = getCubeMirrorMap;
window.__MOB_STUDIO.selectPart = selectPart;
window.__MOB_STUDIO.exitPartMode = exitPartMode;
window.__MOB_STUDIO.setGamePreview = setGamePreview;
window.__MOB_STUDIO.setGamePreviewNight = setGamePreviewNight;
window.__MOB_STUDIO.getPartInstanceForBone = getPartInstanceForBone;
window.__MOB_STUDIO.scalePartData = scalePartData;
window.__MOB_STUDIO.rotatePartData = rotatePartData;
window.__MOB_STUDIO.translatePartData = translatePartData;
window.__MOB_STUDIO.paintPartColor = paintPartColor;
window.__MOB_STUDIO.bakePartFromGroup = bakePartFromGroup;
window.__MOB_STUDIO.handlePartGizmo = handlePartGizmo;
window.__MOB_STUDIO.faceDragBegin = faceDragBegin;
window.__MOB_STUDIO.faceDragMove = faceDragMove;
window.__MOB_STUDIO.faceDragEnd = faceDragEnd;
window.__MOB_STUDIO.isFaceDetail = isFaceDetail;
window.__MOB_STUDIO.faceHeadRef = faceHeadRef;
window.__MOB_STUDIO.reshapeBegin = reshapeBegin;
window.__MOB_STUDIO.reshapeMove = reshapeMove;
window.__MOB_STUDIO.reshapeEnd = reshapeEnd;
window.__MOB_STUDIO.reshapeHitHandle = reshapeHitHandle;
window.__MOB_STUDIO.showReshapeHandles = showReshapeHandles;
window.__MOB_STUDIO.updateReshapeHandles = updateReshapeHandles;
window.__MOB_STUDIO.reshapeSetHover = reshapeSetHover;
window.__MOB_STUDIO.reshapeHoverAxis = () => reshapeHoverAxis;
window.__MOB_STUDIO.reshapeHandleGroup = null;
window.__MOB_STUDIO.getReshapeHandleGroup = () => reshapeHandleGroup;
window.__MOB_STUDIO.reshapeReadout = () => document.getElementById('reshape-readout');

// ==================== ?mob= DEEPLINK (galleriasta editoriin) ====================
// Esim. preview.html?mob=stalker lataa Stalkerin suoraan — galleriasivun
// 'Avaa editorissa' -linkit käyttävät tätä. Tuntematon id ei kaada mitään.
// Autosave menee omaan avaimeen (URL_MOB_ID → AUTOSAVE_KEY_ACTIVE yllä),
// joten kaksi välilehteä voi vertailla mobeja vierekkäin sotkematta toisiaan.
if (URL_MOB_ID) {
    const urlMob = LIBRARY_MOBS.find(m => m.id === URL_MOB_ID);
    if (urlMob) {
        loadLibraryMob(urlMob);
        const txt = document.getElementById('status-text').textContent;
        setStatus(txt + ' — open another mob in a second tab to compare (both stay saved)');
    } else {
        // Ei löytynyt kirjastosta — kokeile 'Omat olennot' -tallennusta (id: mine_*)
        const mine = getMyCreatures().find(e => e.id === URL_MOB_ID || e.name === URL_MOB_ID);
        if (mine) {
            loadMyCreature(mine.id);
        } else {
            setStatus(`Mob "${URL_MOB_ID}" ei löytynyt kirjastosta — valitse vasemmalta`);
        }
    }
}

// ==================== TALLENNUS-SIIVOUS (kerran bootissa) ====================
// Estää localStoragea kasvamasta loputtomasti. Kaikki yli 30 päivää vanhat
// tallennukset poistetaan — paitsi nykyisen istunnon oma avain, jota
// käytetään juuri nyt:
//   1. ?mob= deeplink-avaimet (…_deeplink_<id>): orpo (mobi poistettu
//      kirjastosta) → heti, muuten > 30 pv → poistetaan
//   2. tavallinen autosave (AUTOSAVE_KEY): > 30 pv ja ei aktiivinen
//   3. Omat olennot -lista (MY_CREATURES_KEY): vanhat > 30 pv tallennukset
// Vanhat tallennukset ilman savedAt-aikaleimaa säilytetään (ikä tuntematon).
// staleCleanupRemoved näytetään käyttäjälle statusrivillä tiedoston lopussa.
let staleCleanupRemoved = 0;
(function cleanupStaleData() {
    const PREFIX = AUTOSAVE_KEY + '_deeplink_';
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stale = (savedAt) => typeof savedAt === 'number' && (now - savedAt) > MAX_AGE_MS;
    let removed = 0;

    // 1) Deeplink-avaimet
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(PREFIX)) continue;
            if (key === AUTOSAVE_KEY_ACTIVE) continue; // käytössä juuri nyt
            const mobId = key.slice(PREFIX.length);
            const exists = LIBRARY_MOBS.some(m => m.id === mobId);
            let remove = !exists;
            if (exists) {
                try {
                    const data = JSON.parse(localStorage.getItem(key) || 'null');
                    remove = stale(data && data.savedAt);
                } catch { /* parse-virhe → ikä tuntematon, ei poisteta */ }
            }
            if (remove) { localStorage.removeItem(key); removed++; }
        }
    } catch (e) { console.warn('Siivous (deeplink) epäonnistui:', e); }

    // 2) Tavallinen autosave — vain kun se ei ole nykyisen istunnon avain
    try {
        if (AUTOSAVE_KEY_ACTIVE !== AUTOSAVE_KEY) {
            const data = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
            if (data && stale(data.savedAt)) { localStorage.removeItem(AUTOSAVE_KEY); removed++; }
        }
    } catch (e) { console.warn('Siivous (autosave) epäonnistui:', e); }

    // 3) Omat olennot -lista: vanhat tallennukset pois (60-raja säilyy)
    try {
        const list = JSON.parse(localStorage.getItem(MY_CREATURES_KEY) || '[]');
        if (Array.isArray(list)) {
            const kept = list.filter((e) => !stale(e && e.savedAt));
            if (kept.length !== list.length) {
                localStorage.setItem(MY_CREATURES_KEY, JSON.stringify(kept));
                removed += list.length - kept.length;
            }
        }
    } catch (e) { console.warn('Siivous (omat olennot) epäonnistui:', e); }

    staleCleanupRemoved = removed;
    if (removed) console.log(`🧹 Tallennussiivous: ${removed} vanhaa tallennusta poistettu (yli 30 pv)`);
})();

// ==================== ALOITUSNÄYTTÖ ====================
// Näkyy kerran sovelluksen avauksessa (oletuksena 'Älä näytä enää'
// valittuna → poistuu lopullisesti ensimmäisen sulkemisen jälkeen).
// ?nosplash tai headless-ympäristö ohittaa sen kokonaan (kuvaustyökalut,
// varmentajat ja CI — tekniikka ja renderöinti pysyvät identtisinä).
// ?mob= ohittaa myös (deeplinkki galleriasta → mobi aukeaa suoraan).
(function initStartScreen() {
    const screen = document.getElementById('start-screen');
    if (!screen) return;
    const skip = new URLSearchParams(location.search).has('nosplash')
        || new URLSearchParams(location.search).has('mob')
        || navigator.webdriver
        || localStorage.getItem('startScreenDismissed') === '1';
    if (skip) return;

    const dontShow = document.getElementById('start-dont-show');
    const close = () => {
        if (dontShow && dontShow.checked) localStorage.setItem('startScreenDismissed', '1');
        screen.hidden = true;
    };

    // ▶️ Jatka edellistä — näkyy kolmen valinnan yläpuolella, kun
    // autosäilötty projekti on olemassa. Autosave on ladattu jo bootissa,
    // joten painike vain jatkaa siitä mihin jäätiin.
    const contBtn = document.getElementById('start-continue');
    const contMeta = document.getElementById('start-continue-meta');
    if (contBtn) {
        const prev = (() => {
            try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY_ACTIVE) || 'null'); }
            catch { return null; }
        })();
        if (prev && prev.model && prev.model.bones) {
            const name = prev.projectName
                || (prev.model.modelId ? prev.model.modelId.replace(/^geometry\./, '') : 'Custom creature');
            const bones = prev.model.bones.length;
            const cubes = prev.model.bones.reduce((n, b) => n + (b.cubes || []).length, 0);
            const size = mobHeightBlocks(prev.model, prev.sourceCategory || 'voxel');
            const sizeLabel = size < 1.5 ? 'Small' : size < 4 ? 'Medium' : size < 8.5 ? 'Large' : 'Giant';
            contMeta.textContent = `${name} — ${sizeLabel} (${size} blocks) · ${bones} bones · ${cubes} cubes`;
            contBtn.hidden = false;
            contBtn.addEventListener('click', () => {
                close();
                setStatus(`Continuing project "${name}" — latest autosaved work loaded`);
            });
        }
    }

    document.getElementById('start-library').addEventListener('click', () => {
        close();
        // Avaa kirjasto-osio jos se on kollapsissa
        const libSection = document.getElementById('lib-section');
        if (libSection) libSection.classList.remove('panel-collapsed');
        // Siirry 📚 Kirjasto -välilehdelle ja kohdista haku
        const libTab = document.querySelector('.lib-tab[data-libview="library"]');
        if (libTab) libTab.click();
        const search = document.getElementById('mob-search');
        if (search) search.focus();
        setStatus('Valitse mob kirjastosta — klikkaa korttia ladataksesi sen');
    });
    document.getElementById('start-empty').addEventListener('click', () => {
        close();
        openNewMobDialog('empty');
    });
    document.getElementById('start-randomize').addEventListener('click', () => {
        close();
        randomizeCreature();
    });
    document.getElementById('start-skip').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !screen.hidden) close();
    });

    screen.hidden = false;
})();
console.log('🧊 Freebuff Mob Studio initialized' + (state.webgl ? '' : ' (no WebGL — 3D viewport disabled)'));

// ==================== OIKOTIEOPAS ('?' aloitusnäytössä) ====================
// Kattava lista kaikista editorin oikotieistä — data yhdessä taulukossa,
// lista rakennetaan siitä (HTML:ää ei tarvitse täydentää käsin).
const EDITOR_SHORTCUTS = [
    { group: 'Tools', items: [
        ['G', 'Move'],
        ['R', 'Rotate'],
        ['S', 'Resize (selected) / Select'],
        ['←↑↓→', 'Nudge selected cube (Shift = 4×)'],
        ['Ctrl+↑ / Ctrl+↓', 'Nudge selected cube up / down (Y)'],
        ['Del', 'Delete selected']
    ] },
    { group: 'Editing', items: [
        ['⌘Z', 'Undo (also painting)'],
        ['⌘Y', 'Redo'],
        ['⌘D', 'Duplicate cube'],
        ['⌘C', 'Copy pose'],
        ['⌘V', 'Paste pose']
    ] },
    { group: 'UV Tools', items: [
        ['A', 'Align UVs (selected cubes)'],
        [']', 'Scale UVs up 2× (selected cubes)'],
        ['[', 'Scale UVs down 0.5× (selected cubes)'],
        ['M', 'Mirror UVs (Shift = vertical)']
    ] },
    { group: 'Menus & Playback', items: [
        ['⌘I', 'Import… menu (cycles through formats)'],
        ['⌘E', 'Export… menu (cycles through formats)'],
        ['Space', 'Play / pause'],
        ['Esc', 'Close menu or dialog']
    ] }
];

function initShortcutsDialog() {
    const btn = document.getElementById('start-shortcuts-btn');
    const dialog = document.getElementById('shortcuts-dialog');
    if (!btn || !dialog) return;

    const list = dialog.querySelector('.shortcut-list');
    if (list && !list.children.length) {
        for (const group of EDITOR_SHORTCUTS) {
            const h = document.createElement('div');
            h.className = 'shortcut-group';
            h.textContent = group.group;
            list.appendChild(h);
            for (const [key, desc] of group.items) {
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                const k = document.createElement('kbd');
                k.textContent = key;
                const s = document.createElement('span');
                s.textContent = desc;
                row.appendChild(k);
                row.appendChild(s);
                list.appendChild(row);
            }
        }
    }

    const open = () => { dialog.style.display = 'flex'; };
    const close = () => { dialog.style.display = 'none'; };
    btn.addEventListener('click', open);
    document.getElementById('shortcuts-close').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dialog.style.display !== 'none') close();
    });
}
initShortcutsDialog();

// ==================== GALLERIALINKKI: KONTEKSTITIETOINEN ====================
// Jos examples/gallery puuttuu (esim. kehitysversio ilman export-ajoa),
// piilotetaan linkki ja näytetään 'Generoi galleria' -ohje. file://-tilassa
// fetch ei toimi → linkki jää näkyviin (paras arvaus, galleria voi olla).
const galleryLinkEl = document.querySelector('.start-gallery');
const galleryHintEl = document.getElementById('start-gallery-hint');
if (galleryLinkEl && galleryHintEl) {
    (async () => {
        let ok = true;
        try {
            const res = await fetch('examples/gallery/index.html', { method: 'HEAD', cache: 'no-store' });
            ok = res.ok;
        } catch { /* file:// tai verkko poikki — oleta että galleria on */ }
        if (!ok) {
            galleryLinkEl.hidden = true;
            galleryHintEl.hidden = false;
        }
    })();
}

// ==================== SIIVOUSILMOITUS STATUSRIVILLE ====================
// Aina viimeisenä — deeplink-/ready-viestien jälkeen, jotta käyttäjä näkee
// milloin vanhoja tallennuksia siivottiin.
if (staleCleanupRemoved > 0) {
    setStatus(document.getElementById('status-text').textContent
        + ` ${staleCleanupRemoved} old saves cleaned (over 30 days)`);
}
