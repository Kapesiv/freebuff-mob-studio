/**
 * Animation timeline — per-bone rotation keyframes with linear
 * interpolation, a playhead and play/pause. Minecraft-style frame
 * timing (20 fps) so frames map to Bedrock/Java animation frames.
 */
import * as THREE from 'three';

const FPS = 20;

export function initAnimation(state, callbacks) {
    const anim = {
        length: 40,
        playing: false,
        time: 0,
        poseMode: false,
        tracks: {}      // boneName -> { frame: [rx, ry, rz] }
    };
    state.animation = anim;

    const el = {
        play: document.getElementById('anim-play'),
        pose: document.getElementById('anim-pose'),
        addKey: document.getElementById('anim-add-key'),
        copy: document.getElementById('anim-copy'),
        paste: document.getElementById('anim-paste'),
        mirror: document.getElementById('anim-mirror'),
        clear: document.getElementById('anim-clear'),
        time: document.getElementById('anim-time'),
        timeLabel: document.getElementById('anim-time-label'),
        length: document.getElementById('anim-length'),
        track: document.querySelector('.anim-track'),
        keys: document.getElementById('anim-keys')
    };

    // Asentojen leikepöytä: kopioitu asento = kaikkien luiden rotaatiot
    // (asteina) siinä kohdassa, missä Copy Pose painettiin.
    let poseClipboard = null;

    // ---- pose mode -----------------------------------------------------
    // Asentotila: aikaa voi raahata/klikata kädellä ilman että animaatio
    // pyörii — ihanteellinen asennon hakemiseen keyframea varten.
    function setPoseMode(on) {
        anim.poseMode = on;
        if (on) {
            anim.playing = false;
            el.play.textContent = '▶';
            if (callbacks.onMessage) callbacks.onMessage('Asentotila: klikkaa osaa 3D:ssä ja kääntele luuta — pose tallentuu keyframeksi automaattisesti');
        } else {
            if (callbacks.onMessage) callbacks.onMessage('Asentotila pois');
        }
        if (el.pose) el.pose.classList.toggle('active', on);
    }
    if (el.pose) {
        el.pose.addEventListener('click', () => setPoseMode(!anim.poseMode));
    }

    // Aikajanan arvon asettaminen + asennon soveltaminen (yhteinen logiikka
    // raahaukselle, klikkaukselle ja ohjelmalliselle hypylle).
    function scrubTo(value) {
        anim.playing = false;          // raahaaminen pysäyttää toiston aina
        el.play.textContent = '▶';
        anim.time = Math.max(0, Math.min(anim.length, parseFloat(value) || 0));
        el.time.value = anim.time;
        el.timeLabel.textContent = Math.round(anim.time);
        applyPose();
    }
    // Klikkaus mihin tahansa kohtaan aikajanaa hyppää sinne (nopea asennon haku)
    if (el.time) {
        el.time.addEventListener('pointerdown', (e) => {
            const rect = el.time.getBoundingClientRect();
            if (rect.width > 0) {
                const ratio = (e.clientX - rect.left) / rect.width;
                scrubTo(Math.round(ratio * anim.length));
            }
        });
    }

    // ---- pose application ---------------------------------------------
    function applyPose() {
        for (let bi = 0; bi < state.model.bones.length; bi++) {
            const boneData = state.model.bones[bi];
            const group = state.bones[bi];
            if (!group) continue;

            const track = anim.tracks[boneData.name];
            let rot = boneData.rotation;
            if (track && Object.keys(track).length > 0) {
                rot = interpolate(track, anim.time);
                // GeckoLib-mobit (Deep Void): animaatiorotaatio LISÄTÄÄN
                // geometrian rest-rotaatioon (initialSnapshot + keyframe),
                // vanilja-Bedrockissa se korvaa. Rest on nollia vaniljassa,
                // joten additiivisuus ei muuta vaniljamobeja.
                if (state.model.additiveRotation) {
                    rot = [
                        rot[0] + boneData.rotation[0],
                        rot[1] + boneData.rotation[1],
                        rot[2] + boneData.rotation[2]
                    ];
                }
            }
            // 'ZYX' = Bedrock/GeckoLib-järjestys (X ensin) — sama kuin
            // rebuildModelissa; ilman tätä moniakseliset asennot vääristyvät.
            group.rotation.order = 'ZYX';
            group.rotation.set(
                THREE.MathUtils.degToRad(rot[0]),
                THREE.MathUtils.degToRad(rot[1]),
                THREE.MathUtils.degToRad(rot[2])
            );
            // Positio: luut ovat nyt sisäkkäin, joten peruspositio on
            // parent-relatiivinen (pivot − parentPivot, laskettu rebuildModelissa
            // userData.basePosition). Positiotrackit (Bedrock "position"-keyframet)
            // siirtävät luuta vanhemman avaruudessa — kuten pelissä.
            const base = (group.userData && group.userData.basePosition)
                ? group.userData.basePosition
                : boneData.pivot;
            const posTrack = anim.posTracks ? anim.posTracks[boneData.name] : null;
            if (posTrack && Object.keys(posTrack).length > 0) {
                const p = interpolate(posTrack, anim.time);
                group.position.set(base[0] + p[0], base[1] + p[1], base[2] + p[2]);
            } else {
                group.position.set(base[0], base[1], base[2]);
            }
        }
    }

    function interpolate(track, time) {
        const frames = Object.keys(track).map(Number).sort((a, b) => a - b);
        if (time <= frames[0]) return track[frames[0]];
        if (time >= frames[frames.length - 1]) return track[frames[frames.length - 1]];

        for (let i = 0; i < frames.length - 1; i++) {
            const f0 = frames[i], f1 = frames[i + 1];
            if (time >= f0 && time <= f1) {
                const t = (time - f0) / (f1 - f0);
                const a = track[f0], b = track[f1];
                return [
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    a[2] + (b[2] - a[2]) * t
                ];
            }
        }
        return track[frames[frames.length - 1]];
    }

    // ---- keyframe dots on the timeline --------------------------------
    // Piirtää aikajanalle yhden pisteen jokaista framea kohti, jolla on
    // keyframe jossakin luussa. Pisteitä voi raahata siirtääkseen keyframet.
    function keyframeFrames() {
        const frames = new Set();
        for (const track of Object.values(anim.tracks)) {
            for (const f of Object.keys(track)) frames.add(Number(f));
        }
        if (anim.posTracks) {
            for (const track of Object.values(anim.posTracks)) {
                for (const f of Object.keys(track)) frames.add(Number(f));
            }
        }
        return [...frames].sort((a, b) => a - b);
    }

    function redrawKeys() {
        if (!el.keys || !el.track) return;
        const rect = el.track.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        el.keys.width = Math.round(rect.width * dpr);
        el.keys.height = Math.round(rect.height * dpr);
        const ctx = el.keys.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        const frames = keyframeFrames();
        const cy = rect.height / 2;
        const cssColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4da6ff';
        ctx.fillStyle = cssColor;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        for (const f of frames) {
            const x = (f / anim.length) * rect.width;
            if (x < 0 || x > rect.width) continue;
            ctx.beginPath();
            ctx.arc(x, cy, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    // Keyframe-pisteen raahaaminen: siirtää kaikki saman framen keyframet
    // (kaikki luut) uuteen aikakohtaan. Capture-vaihe estää range-inputin
    // oman raahauksen, jotta piste voi siirtyä erikseen.
    let drag = null;
    function hitFrame(clientX) {
        const rect = el.track.getBoundingClientRect();
        if (rect.width <= 0) return null;
        for (const f of keyframeFrames()) {
            const x = (f / anim.length) * rect.width;
            if (Math.abs(clientX - (rect.left + x)) <= 6) return f;
        }
        return null;
    }

    if (el.track) {
        el.track.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const frame = hitFrame(e.clientX);
            if (frame === null) return; // ei osumaa → annetaan inputin hoitaa raahaus
            e.preventDefault();
            e.stopPropagation();
            drag = { pointerId: e.pointerId, from: frame };
            el.track.setPointerCapture(e.pointerId);
        }, true);

        const moveKey = (e) => {
            if (!drag) return;
            const rect = el.track.getBoundingClientRect();
            if (rect.width <= 0) return;
            const to = Math.max(0, Math.min(anim.length, Math.round(((e.clientX - rect.left) / rect.width) * anim.length)));
            if (to === drag.from) return;
            for (const track of Object.values(anim.tracks)) {
                if (track[drag.from] !== undefined) {
                    track[to] = track[drag.from];
                    delete track[drag.from];
                }
            }
            if (anim.posTracks) {
                for (const track of Object.values(anim.posTracks)) {
                    if (track[drag.from] !== undefined) {
                        track[to] = track[drag.from];
                        delete track[drag.from];
                    }
                }
            }
            drag.from = to;
            redrawKeys();
            applyPose(); // päivitä malli uuden keyframe-ajan mukaan
        };
        el.track.addEventListener('pointermove', moveKey);

        const endDrag = () => {
            if (!drag) return;
            drag = null;
            if (callbacks.onAnimationChange) callbacks.onAnimationChange();
        };
        el.track.addEventListener('pointerup', endDrag);
        el.track.addEventListener('pointercancel', endDrag);
    }

    // ---- UI -----------------------------------------------------------
    function syncSlider() {
        el.time.max = anim.length;
        el.time.value = Math.round(anim.time);
        el.timeLabel.textContent = Math.round(anim.time);
    }

    function addKeyframe(silent) {
        if (state.selectedBone === null) {
            if (!silent && callbacks.onMessage) callbacks.onMessage('Select a bone first (click it in the hierarchy)');
            return;
        }
        const boneData = state.model.bones[state.selectedBone];
        const frame = Math.round(anim.time);
        anim.tracks[boneData.name] = anim.tracks[boneData.name] || {};
        anim.tracks[boneData.name][frame] = [boneData.rotation[0], boneData.rotation[1], boneData.rotation[2]];
        if (!silent && callbacks.onMessage) callbacks.onMessage(`Keyframe ${frame} → ${boneData.name} (${boneData.rotation.join(',')})`);
        redrawKeys();
        if (callbacks.onAnimationChange) callbacks.onAnimationChange();
    }

    function clearAnimation() {
        anim.tracks = {};
        redrawKeys();
        if (callbacks.onAnimationChange) callbacks.onAnimationChange();
    }

    // ---- copy / paste pose --------------------------------------------
    // Kopioi NYKYISEN näkyvän asennon (interpoloitu, jos aikana on keyframeja)
    // kaikilta luilta: rotaatio + positiosiirtymä (posTracks). Liimaus lisää
    // keyframet nykyiseen aikakohtaan. Jos luu on valittu, liimataan vain se
    // luu — muuten koko asento.
    function capturePoseValue(boneData, group) {
        const base = (group.userData && group.userData.basePosition)
            ? group.userData.basePosition
            : boneData.pivot;
        return {
            rot: [
                Math.round(THREE.MathUtils.radToDeg(group.rotation.x)),
                Math.round(THREE.MathUtils.radToDeg(group.rotation.y)),
                Math.round(THREE.MathUtils.radToDeg(group.rotation.z))
            ],
            pos: [
                Math.round((group.position.x - base[0]) * 100) / 100,
                Math.round((group.position.y - base[1]) * 100) / 100,
                Math.round((group.position.z - base[2]) * 100) / 100
            ]
        };
    }

    function copyPose() {
        if (!state.model || !state.bones) return;
        poseClipboard = {};
        let count = 0;
        for (let bi = 0; bi < state.model.bones.length; bi++) {
            const boneData = state.model.bones[bi];
            const group = state.bones[bi];
            if (!group || !boneData) continue;
            poseClipboard[boneData.name] = capturePoseValue(boneData, group);
            count++;
        }
        if (callbacks.onMessage) callbacks.onMessage(`Copy Pose: ${count} luun asento (+ positio) tallennettu leikepöydälle (frame ${Math.round(anim.time)})`);
        return count;
    }

    function applyPoseValue(boneName, value, frame) {
        if (!value) return 0;
        anim.tracks[boneName] = anim.tracks[boneName] || {};
        anim.tracks[boneName][frame] = [value.rot[0], value.rot[1], value.rot[2]];
        let wrote = 1;
        // Positiosiirtymä tallennetaan posTracksiin — nollasiirtymä jätetään
        // pois (rest-asento ei tarvitse omaa positio-keyframea).
        const hasPos = value.pos.some((v) => v !== 0);
        if (hasPos) {
            anim.posTracks = anim.posTracks || {};
            anim.posTracks[boneName] = anim.posTracks[boneName] || {};
            anim.posTracks[boneName][frame] = [value.pos[0], value.pos[1], value.pos[2]];
            wrote = 2;
        }
        return wrote;
    }

    function pastePose() {
        if (!poseClipboard || Object.keys(poseClipboard).length === 0) {
            if (callbacks.onMessage) callbacks.onMessage('Copy Pose ensin — leikepöytä on tyhjä');
            return 0;
        }
        const frame = Math.round(anim.time);
        let count = 0;
        const selectedBone = state.selectedBone !== null && state.selectedBone !== undefined && state.model.bones[state.selectedBone]
            ? state.model.bones[state.selectedBone].name
            : null;
        if (selectedBone && poseClipboard[selectedBone]) {
            // Vain valittu luu: liimataan sen rotaatio (ja positio, jos oli)
            applyPoseValue(selectedBone, poseClipboard[selectedBone], frame);
            count = 1;
        } else {
            for (const [boneName, value] of Object.entries(poseClipboard)) {
                applyPoseValue(boneName, value, frame);
                count++;
            }
        }
        redrawKeys();
        applyPose();
        if (callbacks.onMessage) {
            if (selectedBone && count === 1) {
                callbacks.onMessage(`Paste Pose: ${selectedBone} liimattu frameen ${frame}`);
            } else {
                callbacks.onMessage(`Paste Pose: ${count} luun keyframe lisätty frameen ${frame}`);
            }
        }
        if (callbacks.onAnimationChange) callbacks.onAnimationChange();
        return count;
    }

    // ---- mirror pose --------------------------------------------------
    // Peilaa asennon vasen/oikea -pareittain samaan frameen: kunkin parin
    // kummatkin osapuolet saavat toistensa peilikuvan (rotaatio + positio).
    // Symmetrisessä lepoasennossa tämä = "kopioi oikea → vasen".
    const MIRROR_MATRIX = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

    function mirrorBoneName(name) {
        const swaps = [
            [/^right_(.+)$/, 'left_$1'],
            [/^left_(.+)$/, 'right_$1'],
            [/^(.+)_right$/, '$1_left'],
            [/^(.+)_left$/, '$1_right'],
            [/^(.+)_r$/, '$1_l'],
            [/^(.+)_l$/, '$1_r'],
            [/^(.+)R$/, '$1L'],
            [/^(.+)L$/, '$1R'],
            // camelCase-parit: rightArm ↔ leftArm, LeftLeg ↔ RightLeg
            [/^right/i, 'left'],
            [/^left/i, 'right']
        ];
        for (const [re, rep] of swaps) {
            if (re.test(name)) return name.replace(re, rep);
        }
        // numeroidut parit: name_0 ↔ name_1, name_2 ↔ name_3, ...
        const num = name.match(/^(.*?)(\d+)$/);
        if (num) {
            const n = parseInt(num[2], 10);
            const pair = n % 2 === 0 ? n + 1 : n - 1;
            return num[1] + pair;
        }
        return null;
    }

    function mirrorRotation(rot) {
        const e = new THREE.Euler(
            THREE.MathUtils.degToRad(rot[0]),
            THREE.MathUtils.degToRad(rot[1]),
            THREE.MathUtils.degToRad(rot[2]),
            'XYZ'
        );
        const m = new THREE.Matrix4().makeRotationFromEuler(e);
        const mirrored = new THREE.Matrix4().multiplyMatrices(MIRROR_MATRIX, m).multiply(MIRROR_MATRIX);
        const eu = new THREE.Euler().setFromRotationMatrix(mirrored, 'XYZ');
        return [
            Math.round(THREE.MathUtils.radToDeg(eu.x)),
            Math.round(THREE.MathUtils.radToDeg(eu.y)),
            Math.round(THREE.MathUtils.radToDeg(eu.z))
        ];
    }

    function writeMirroredValue(boneName, value, frame) {
        anim.tracks[boneName] = anim.tracks[boneName] || {};
        anim.tracks[boneName][frame] = mirrorRotation(value.rot);
        const hasPos = value.pos.some((v) => v !== 0);
        if (hasPos) {
            anim.posTracks = anim.posTracks || {};
            anim.posTracks[boneName] = anim.posTracks[boneName] || {};
            anim.posTracks[boneName][frame] = [-value.pos[0], value.pos[1], value.pos[2]];
        }
    }

    function mirrorPose() {
        if (!state.model || !state.bones) return 0;
        const frame = Math.round(anim.time);
        // nykyinen näkyvä asento jokaiselta luulta
        const visible = {};
        for (let bi = 0; bi < state.model.bones.length; bi++) {
            const boneData = state.model.bones[bi];
            const group = state.bones[bi];
            if (!group || !boneData) continue;
            visible[boneData.name] = capturePoseValue(boneData, group);
        }
        const byName = {};
        for (const b of state.model.bones) byName[b.name] = true;
        const done = new Set();
        let count = 0;
        for (const boneData of state.model.bones) {
            const mName = mirrorBoneName(boneData.name);
            if (!mName || !byName[mName] || done.has(boneData.name) || done.has(mName)) continue;
            done.add(boneData.name);
            done.add(mName);
            const va = visible[boneData.name];
            const vb = visible[mName];
            if (!va || !vb) continue;
            // A saa B:n peilikuvan, B saa A:n peilikuvan
            writeMirroredValue(mName, va, frame);
            writeMirroredValue(boneData.name, vb, frame);
            count += 2;
        }
        redrawKeys();
        applyPose();
        if (callbacks.onMessage) callbacks.onMessage(`Mirror Pose: ${count} luuta peilattu frameen ${frame}`);
        if (callbacks.onAnimationChange) callbacks.onAnimationChange();
        return count;
    }

    el.play.addEventListener('click', () => {
        anim.playing = !anim.playing;
        el.play.textContent = anim.playing ? '⏸' : '▶';
        if (anim.playing && anim.time >= anim.length) anim.time = 0;
        if (anim.playing && anim.poseMode) setPoseMode(false); // toisto lopettaa asentotilan
    });

    el.addKey.addEventListener('click', addKeyframe);
    if (el.copy) el.copy.addEventListener('click', copyPose);
    if (el.paste) el.paste.addEventListener('click', pastePose);
    if (el.mirror) el.mirror.addEventListener('click', mirrorPose);
    el.clear.addEventListener('click', () => {
        clearAnimation();
        applyPose();
        if (callbacks.onMessage) callbacks.onMessage('Animation cleared');
    });

    el.time.addEventListener('input', () => {
        scrubTo(el.time.value); // raahaus soveltaa aina asennon (ei taistele toiston kanssa)
    });

    el.length.addEventListener('change', () => {
        anim.length = Math.max(1, parseInt(el.length.value) || 40);
        el.length.value = anim.length;
        if (anim.time > anim.length) anim.time = anim.length;
        syncSlider();
        redrawKeys();
    });

    // ---- playback loop ------------------------------------------------
    let last = performance.now();
    function tick() {
        requestAnimationFrame(tick);
        if (anim.playing) {
            const now = performance.now();
            const dt = (now - last) / 1000;
            last = now;
            anim.time += dt * FPS;
            if (anim.time >= anim.length) anim.time = 0;
            syncSlider();
            applyPose();
        } else {
            last = performance.now();
        }
    }
    tick();

    window.addEventListener('resize', redrawKeys);
    // Piirrä uudelleen kun layout on asettunut (flex-wrap voi muuttaa leveyttä)
    setTimeout(redrawKeys, 150);
    setTimeout(redrawKeys, 500);

    // Ctrl/Cmd+C ja Ctrl/Cmd+V kopioivat/liimaavat asennon (asentotilassa
    // tai ilman) — ei sotke tekstikenttien normaalia kopiointia.
    document.addEventListener('keydown', (e) => {
        const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
        if (typing) return;
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
            e.preventDefault();
            copyPose();
        } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
            e.preventDefault();
            pastePose();
        }
    });

    // Space toggles playback
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            el.play.click();
        }
    });

    // Merge the API into the anim object so callers get one handle
    Object.assign(anim, { applyPose, addKeyframe, syncSlider, clearAnimation, redrawKeys, copyPose, pastePose, mirrorPose });
    return anim;
}
