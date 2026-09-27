// ============================================================================
// LINKAGE LAB — IBC battery gauge and night power glow (ES module)
//
// Port of the StarShade viewer's tote treatment: the big white bottle inside
// each IBC tote is drawn as a 10-segment battery gauge (segments below the
// state of charge glow green), and at night the column throws a pulsing green
// light onto the beams and panel undersides (three point lights, two additive
// halo sprites, a faint green ambient wash). The gauge is always readable; the
// light it throws is strong at night and barely there in daylight (the night
// factor comes from the studio's current sky model).
//
// Lazy: no THREE at module top level (unit tests import renderer modules).
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { SKY_PALETTE, hexToLinear } from './sky-model.js';
import { addFrameDriver, removeFrameDriver, hasFrameDriver } from './render-loop.js';

// app-state.js is reached through the global bridge (see render-loop.js for why).
const liveState = () => globalThis.state || {};

const BOTTLE_MIN_VOLUME = 10000;   // raw GLB units; the tote bottle is ~62,650, cage bars are tiny

const power = {
    soc: 0.6,          // state of charge shown on the gauge (0..1)
    glow: 1,           // 0..1 strength of the green power glow
    bottles: [],       // meshes driving the gauge extent and the rig placement
    rig: null,
    uniforms: null,
    material: null,
    clock: 0,
    lastNight: 0,
};

function lin(hex) {
    const c = hexToLinear(hex);
    return new THREE.Color(c.r, c.g, c.b);
}

function lowFx() {
    return typeof globalThis.isLowFx === 'function' && globalThis.isLowFx();
}

// --- materials -------------------------------------------------------------------

/** Shared battery-gauge material (one instance; never disposed by the IBC stack code). */
function getBatteryMaterial() {
    if (power.material) return power.material;
    if (typeof THREE === 'undefined') return null;
    const glow = lin(SKY_PALETTE.glow);
    const uniforms = {
        uFill: { value: 0 },
        uMinY: { value: 0 },
        uMaxY: { value: 1 },
        uGlow: { value: glow.clone() },
        uGlowIntensity: { value: 0.3 },
        uDimColor: { value: lin('#e6e9ec') },
        uLitBase: { value: lin('#0d5c34') },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.55, side: THREE.DoubleSide });
    m.envMapIntensity = 0.35;
    m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
varying float vWorldY;
uniform float uFill, uMinY, uMaxY, uGlowIntensity;
uniform vec3 uGlow, uDimColor, uLitBase;`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float bh = clamp((vWorldY - uMinY) / max(uMaxY - uMinY, 0.001), 0.0, 1.0);
float segF = bh * 10.0;
float segFrac = fract(segF);
float gap = step(segFrac, 0.05) + step(0.95, segFrac);
float lit = ((floor(segF) + 0.5) / 10.0 < uFill) ? 1.0 : 0.0;
lit *= 1.0 - clamp(gap, 0.0, 1.0);
diffuseColor.rgb = mix(uDimColor, uLitBase, lit);
totalEmissiveRadiance = mix(totalEmissiveRadiance, uGlow * uGlowIntensity, lit);`);
    };
    m.customProgramCacheKey = () => 'linkagelab-battery';
    m.userData.ibcBattery = true;
    m._cacheKey = 'ibc-battery';      // clearGroup()/dispose helpers leave it alone
    power.uniforms = uniforms;
    power.material = m;
    return m;
}

function meshIsWhite(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return mats.some((m) => m && m.color && m.color.r > 0.9 && m.color.g > 0.9);
}

/** Heuristic from the StarShade viewer: the bottle is the one big white mesh in the tote. */
function isIbcBottleMesh(mesh) {
    if (!mesh || !mesh.isMesh || !mesh.geometry) return false;
    if (mesh.userData && mesh.userData.ibcBottle) return true;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return false;
    const v = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
    return meshIsWhite(mesh) && v > BOTTLE_MIN_VOLUME;
}

/** Tags the bottle meshes on the loaded template so Object3D.clone(true) carries the tag. */
function tagIbcBottles(root) {
    let count = 0;
    if (!root || !root.traverse) return count;
    root.traverse((ch) => {
        if (ch.isMesh && isIbcBottleMesh(ch)) {
            ch.userData.ibcBottle = true;
            count++;
        }
    });
    return count;
}

/**
 * Day materials for one tote clone: the bottle gets the battery gauge, the
 * cage gets dark metal, the pallet white plastic (materials are clones marked
 * ibcOwnedMaterial so the stack code disposes them; the battery material is shared).
 */
function applyIbcPowerMaterials(root) {
    if (!root || typeof THREE === 'undefined') return;
    const battery = getBatteryMaterial();
    root.traverse((ch) => {
        if (!ch.isMesh || !ch.material) return;
        if (battery && isIbcBottleMesh(ch)) {
            ch.userData.ibcBottle = true;
            ch.material = battery;
            return;
        }
        const white = meshIsWhite(ch);
        const upgrade = (mat) => {
            const m = mat.isMeshStandardMaterial ? mat.clone() : new THREE.MeshStandardMaterial({
                map: mat.map || null, transparent: mat.transparent, opacity: mat.opacity,
                side: mat.side != null ? mat.side : THREE.FrontSide,
            });
            m.userData = Object.assign({}, mat.userData, { ibcOwnedMaterial: true });
            if (white) { m.color.copy(lin('#e8ebee')); m.metalness = 0; m.roughness = 0.7; m.envMapIntensity = 0.4; }
            else { m.color.copy(lin('#3a3f47')); m.metalness = 0.55; m.roughness = 0.5; m.envMapIntensity = 0.6; }
            if (m.emissive) m.emissiveIntensity = 0;
            m.alphaTest = 0.5;
            m.side = THREE.DoubleSide;
            return m;
        };
        ch.material = Array.isArray(ch.material) ? ch.material.map(upgrade) : upgrade(ch.material);
    });
}

/** Collects the battery bottles under a root (live stack or a baked preview copy). */
function collectIbcBottles(root) {
    const out = [];
    if (root && root.traverse) root.traverse((ch) => { if (ch.isMesh && ch.userData && ch.userData.ibcBottle) out.push(ch); });
    return out;
}

// --- rig -------------------------------------------------------------------------------

function makeRadialTexture(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, colour]) => grad.addColorStop(o, colour));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
}

/** Creates the glow lights, halos and ambient wash in the main scene (world space). */
function installIbcPowerRig(tr = globalThis.threeRenderer) {
    if (power.rig) return power.rig;
    if (!tr || !tr.mainScene || typeof THREE === 'undefined') return null;
    const glow = lin(SKY_PALETTE.glow);
    const group = new THREE.Group();
    group.name = 'IbcPowerRig';
    const lights = [0, 1, 2].map(() => {
        const l = new THREE.PointLight(glow, 0, 0, 2);
        l.visible = false;
        group.add(l);
        return l;
    });
    const ambient = new THREE.AmbientLight(lin('#1e6b45'), 0);
    group.add(ambient);
    const halos = [];
    if (!lowFx()) {
        const tex = makeRadialTexture(256, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
        for (let i = 0; i < 2; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({
                map: tex, color: glow, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            sp.visible = false;
            group.add(sp);
            halos.push(sp);
        }
    }
    tr.mainScene.add(group);
    power.rig = { group, lights, ambient, halos, box: new THREE.Box3(), tmp: new THREE.Vector3() };
    tr.ibcPowerRig = group;
    return power.rig;
}

function isWorldVisible(obj) {
    for (let n = obj; n; n = n.parent) if (n.visible === false) return false;
    return true;
}

/** Which bottle meshes drive the gauge (the live stack, or the deploy preview's copy). */
function setIbcPowerBottles(list) {
    power.bottles = Array.isArray(list) ? list.filter((m) => m && m.isMesh) : [];
    updateIbcPower(0);
}

function getIbcSoc() { return power.soc; }
function setIbcSoc(v) { power.soc = Math.max(0, Math.min(1, Number(v) || 0)); }

/**
 * Positions the rig on the tote column and applies the current night factor,
 * charge and pulse to the gauge and lights. Cheap; called after every scene
 * update and, at night, once per frame for the pulse.
 */
function updateIbcPower(dt = 0) {
    const tr = globalThis.threeRenderer;
    if (!tr || !tr.mainScene || typeof THREE === 'undefined') return;
    const rig = installIbcPowerRig(tr);
    if (!rig) return;
    const state = liveState();
    const bottles = power.bottles.filter((m) => m.parent && isWorldVisible(m));
    const enabled = !!(state.ibc && state.ibc.enabled) && bottles.length > 0 && !state.hwDetailMode;
    if (!enabled) {
        rig.group.visible = false;
        rig.lights.forEach((l) => { l.visible = false; l.intensity = 0; });
        rig.ambient.intensity = 0;
        rig.halos.forEach((h) => { h.visible = false; });
        if (power.uniforms) power.uniforms.uFill.value = 0;
        removeFrameDriver('ibc-glow');
        return;
    }
    rig.group.visible = true;

    // Column extent in world space
    const box = rig.box.makeEmpty();
    bottles.forEach((m) => { m.updateWorldMatrix(true, false); box.expandByObject(m); });
    if (box.isEmpty()) return;
    const gc = box.getCenter(rig.tmp);
    const gh = Math.max(1, box.max.y - box.min.y);
    const gw = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1);
    if (power.uniforms) {
        power.uniforms.uMinY.value = box.min.y;
        power.uniforms.uMaxY.value = box.max.y;
    }
    const R = (tr.studio && tr.studio.radius) || 200;          // structure footprint, inches
    rig.lights[0].position.set(gc.x, box.min.y + gh * 0.28, gc.z);
    rig.lights[1].position.set(gc.x, box.min.y + gh * 0.72, gc.z);
    rig.lights[2].position.set(gc.x, box.max.y - gh * 0.06, gc.z);   // top: panel undersides and upper beams
    rig.lights.forEach((l) => { l.distance = R * 4.6; });
    rig.halos.forEach((h, i) => {
        h.position.copy(rig.lights[i].position);
        h.scale.set(gw * 2.6, gw * 2.6, 1);
    });

    // Night factor from the studio's sky model; pulse only ticks while the loop runs
    const night = (tr.studio && tr.studio.model && !tr.studio.model.neutral) ? (tr.studio.model.night || 0) : 0;
    power.lastNight = night;
    power.clock += dt || 0;
    const pulse = lowFx() ? 0.5 : 0.5 + 0.5 * Math.sin(power.clock * 2.2);
    const soc = power.soc;
    const strength = power.glow * (0.06 + 0.94 * night);
    if (power.uniforms) {
        power.uniforms.uFill.value = power.glow > 0.02 ? soc : 0;
        power.uniforms.uGlowIntensity.value = 0.45 + strength * (0.9 + 0.5 * pulse);
    }
    // Same law as StarShade (candela with inverse-square falloff); R is in inches here,
    // which makes the (R/10)² term carry the unit change for free.
    const lightPower = strength * (85 + 55 * pulse) * (0.35 + 0.65 * soc) * Math.pow(R * 1.8 / 10, 2);
    rig.lights.forEach((l) => { l.intensity = lightPower; l.visible = lightPower > 0.01; });
    rig.ambient.intensity = strength * night * 0.18;
    const haloOpacity = strength * (0.14 + 0.1 * pulse);
    rig.halos.forEach((h, i) => {
        const on = i === 0 ? soc > 0.05 : soc > 0.55;
        h.material.opacity = on ? haloOpacity : 0;
        h.visible = h.material.opacity > 0.01;
    });

    // Keep pulsing while it is dark (and the effect is visible); the loop idles by day.
    if (night > 0.01 && !lowFx()) {
        if (!hasFrameDriver('ibc-glow')) {
            addFrameDriver('ibc-glow', (dtSec) => {
                updateIbcPower(dtSec);
                return power.lastNight > 0.01 && power.bottles.length > 0;
            });
        }
    } else {
        removeFrameDriver('ibc-glow');
    }
}

const _moduleExports = {
    getBatteryMaterial, isIbcBottleMesh, tagIbcBottles, applyIbcPowerMaterials, collectIbcBottles,
    installIbcPowerRig, setIbcPowerBottles, updateIbcPower, getIbcSoc, setIbcSoc,
};
bridgeGlobals(_moduleExports, 'ibcPower');
export {
    getBatteryMaterial, isIbcBottleMesh, tagIbcBottles, applyIbcPowerMaterials, collectIbcBottles,
    installIbcPowerRig, setIbcPowerBottles, updateIbcPower, getIbcSoc, setIbcSoc,
};
