// ============================================================================
// LINKAGE LAB — Render studio (ES module)
//
// Renderer flags (sRGB output, ACES tone mapping, physically based light units,
// soft shadows, capped pixel ratio), image-based lighting from the inline room
// environment, the light rig (hemisphere + warm sun key + cool fill + moon), a
// permanent shadow-catcher ground with a tinted grid, a star dome and a moon
// sprite, and the day/night application of a sky model (see sky-model.js).
// Lazy: nothing touches THREE until initThreeJS() calls installStudio().
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { GRID_RANGE, GRID_SPACING } from './constants.js';
import { createRoomEnvironmentMap } from './room-environment.js';
import { SKY_PALETTE, hexToLinear, studioModel } from './sky-model.js';
import { setEnvMapScale } from './materials.js';

const STAR_COUNT = 900;
const DOME_RADIUS = 6000;   // inches; camera far is raised to clear it
const GROUND_RADIUS = 6000;

/** Reduced effects for automated / software-rendered runs (Playwright, ?lowfx=1). */
function isLowFx() {
    try {
        if (typeof location !== 'undefined' && /[?&]lowfx=1/.test(location.search)) return true;
        if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
    } catch (e) { /* ignore */ }
    return false;
}

function col(hex) {
    const c = hexToLinear(hex);
    return new THREE.Color(c.r, c.g, c.b);
}

function setLinear(color, rgb) {
    color.setRGB(rgb.r, rgb.g, rgb.b);
}

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

/** Renderer flags shared by the viewport (and any offscreen renderer that wants the same look). */
function configureRenderer(renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);           // the CSS sky gradient shows through
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.physicallyCorrectLights = true;       // StarShade intensities carry over 1:1
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.sortObjects = true;
}

/**
 * Builds the light rig, environment, ground, grid and sky props into
 * threeRenderer.mainScene. Idempotent per renderer.
 */
function installStudio(tr) {
    if (!tr || !tr.mainScene || tr.studio) return tr && tr.studio;
    const scene = tr.mainScene;
    const lowFx = isLowFx();
    const studio = {
        lowFx,
        sunDir: new THREE.Vector3(0.8, 1.4, 0.6).normalize(),
        moonDir: new THREE.Vector3(-0.8, 0.9, -0.6).normalize(),
        center: new THREE.Vector3(),
        radius: 200,
        lastEnvScale: -1,
        model: null,
    };

    // Image-based lighting
    scene.background = null;
    try {
        studio.envMap = createRoomEnvironmentMap(tr.main);
        if (studio.envMap) scene.environment = studio.envMap;
    } catch (e) {
        console.warn('[Studio] environment map unavailable:', e);
    }

    // Lights
    studio.hemi = new THREE.HemisphereLight(col(SKY_PALETTE.hemiDay), col(SKY_PALETTE.hemiGround), 0.9);
    scene.add(studio.hemi);

    const shadowSize = lowFx ? 1024 : 2048;
    const key = new THREE.DirectionalLight(col(SKY_PALETTE.studioKey), 2.0);
    key.castShadow = false;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.5;
    scene.add(key);
    scene.add(key.target);
    studio.key = key;
    tr.sunLight = key;   // legacy name used by updateSunPosition() callers

    const moon = new THREE.DirectionalLight(col(SKY_PALETTE.moon), 0);
    moon.castShadow = false;
    moon.shadow.mapSize.set(lowFx ? 1024 : 1536, lowFx ? 1024 : 1536);
    moon.shadow.bias = -0.0004;
    moon.visible = false;
    scene.add(moon);
    scene.add(moon.target);
    studio.moon = moon;

    const fill = new THREE.DirectionalLight(col(SKY_PALETTE.fill), 0.4);
    scene.add(fill);
    studio.fill = fill;

    // Ground: dark shadow catcher + tinted grid (always present; shadows are gated separately)
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(GROUND_RADIUS, 96),
        new THREE.MeshStandardMaterial({ color: col(SKY_PALETTE.ground), roughness: 1, metalness: 0 })
    );
    ground.material.envMapIntensity = 0.15;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.renderOrder = -2;
    ground.name = 'StudioGround';
    scene.add(ground);
    studio.ground = ground;

    const grid = new THREE.GridHelper(GRID_RANGE * 2, (GRID_RANGE * 2) / GRID_SPACING, col(SKY_PALETTE.gridCenter), col(SKY_PALETTE.gridLine));
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.depthWrite = false;
    grid.renderOrder = -1;
    grid.name = 'StudioGrid';
    scene.add(grid);
    studio.grid = grid;
    tr.gridHelper = grid;   // legacy handle (updateGridPosition / e2e)

    // Star dome (hemisphere above the ground, biased toward the zenith)
    {
        const pos = new Float32Array(STAR_COUNT * 3);
        let seed = 11;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < STAR_COUNT; i++) {
            const theta = 2 * Math.PI * rnd();
            const y = 0.03 + 0.97 * Math.pow(rnd(), 0.8);
            const r = Math.sqrt(1 - y * y);
            pos[i * 3] = Math.cos(theta) * r;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = Math.sin(theta) * r;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            color: 0xdfe6ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
        });
        const stars = new THREE.Points(geo, mat);
        stars.visible = false;
        stars.frustumCulled = false;
        stars.scale.setScalar(DOME_RADIUS);
        stars.name = 'StudioStars';
        scene.add(stars);
        studio.stars = stars;
    }

    // Moon sprite
    studio.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeRadialTexture(128, [[0, 'rgba(255,255,255,1)'], [0.42, 'rgba(255,255,255,1)'], [0.5, 'rgba(230,236,255,0.55)'], [0.7, 'rgba(200,214,255,0.12)'], [1, 'rgba(200,214,255,0)']]),
        transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    }));
    studio.moonSprite.visible = false;
    studio.moonSprite.scale.set(DOME_RADIUS * 0.08, DOME_RADIUS * 0.08, 1);
    studio.moonSprite.name = 'StudioMoon';
    scene.add(studio.moonSprite);

    tr.studio = studio;
    applySkyModel(studioModel(), tr);
    updateStudioFrame({ x: 0, y: 0, z: 0 }, 200, tr);
    return studio;
}

/** Direction vector from azimuth (0=N, 90=E) and elevation (deg), in the scene's Y-up frame. */
function dirFromSky(azimuthDeg, elevationDeg) {
    const az = (azimuthDeg - 90) * Math.PI / 180;   // 0 = +X (east)
    const el = elevationDeg * Math.PI / 180;
    return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

/**
 * Applies a sky model (sky-model.js) to the rig: light colours/intensities,
 * exposure, env-map scaling, CSS sky gradient, stars and moon.
 */
function applySkyModel(model, tr = globalThis.threeRenderer) {
    const s = tr && tr.studio;
    if (!s || !model) return;
    s.model = model;

    if (model.azimuthDeg !== undefined && model.elevationDeg !== undefined) {
        s.sunDir.copy(dirFromSky(model.azimuthDeg, Math.max(1, model.elevationDeg)));
        s.moonDir.copy(dirFromSky(model.azimuthDeg + 180, Math.max(1, -model.elevationDeg)));
    } else if (model.neutral) {
        s.sunDir.set(0.8, 1.4, 0.6).normalize();
    }

    setLinear(s.key.color, model.key.color);
    s.key.intensity = model.key.intensity;
    s.key.visible = model.key.intensity > 0.01;

    setLinear(s.moon.color, model.moon.color);
    s.moon.intensity = model.moon.intensity;
    s.moon.visible = model.moon.intensity > 0.01;
    s.moonSprite.material.opacity = model.moon.opacity || 0;
    s.moonSprite.visible = s.moonSprite.material.opacity > 0.01;

    setLinear(s.hemi.color, model.hemi.color);
    setLinear(s.hemi.groundColor, model.hemi.ground);
    s.hemi.intensity = model.hemi.intensity;
    setLinear(s.fill.color, model.fill.color);
    s.fill.intensity = model.fill.intensity;

    if (tr.main) tr.main.toneMappingExposure = model.exposure;
    if (Math.abs(model.envScale - s.lastEnvScale) > 0.01) {
        s.lastEnvScale = model.envScale;
        setEnvMapScale(model.envScale);
        if (s.ground) s.ground.material.envMapIntensity = 0.15 * model.envScale;
    }

    s.stars.material.opacity = model.starOpacity || 0;
    s.stars.visible = s.stars.material.opacity > 0.01;

    // Only one of sun / moon casts shadows at a time (texture budget on modest GPUs)
    const shadows = !!(globalThis.state && globalThis.state.shadowsEnabled);
    const moonCasts = shadows && !!model.moonCastsShadows;
    s.key.castShadow = shadows && !moonCasts;
    s.moon.castShadow = moonCasts;

    // Sky gradient behind the transparent canvas
    const root = document.documentElement;
    if (model.skyTop && model.skyBottom) {
        root.style.setProperty('--sky-top', model.skyTop);
        root.style.setProperty('--sky-bottom', model.skyBottom);
    } else {
        root.style.removeProperty('--sky-top');
        root.style.removeProperty('--sky-bottom');
    }
    updateStudioFrame(s.center, s.radius, tr);
}

/**
 * Re-centres the ground, grid, star dome, moon and the shadow frustum on the
 * structure. Called whenever the structure centre or footprint changes.
 */
function updateStudioFrame(center, radius, tr = globalThis.threeRenderer, groundY) {
    const s = tr && tr.studio;
    if (!s) return;
    if (center) s.center.set(center.x || 0, 0, center.z || 0);
    if (radius && isFinite(radius)) s.radius = Math.max(60, radius);
    // The ground sits under the structure's lowest point (beam centres are at y = 0,
    // so the bottom ring's underside is at −hBeamT); never above the origin.
    if (groundY !== undefined && isFinite(groundY)) s.groundY = Math.min(0, groundY);
    if (s.groundY === undefined) s.groundY = 0;
    const c = s.center, R = s.radius, gy = s.groundY;
    s.ground.position.set(c.x, gy - 0.05, c.z);
    s.grid.position.set(c.x, gy, c.z);
    s.stars.position.set(c.x, gy, c.z);

    const dist = Math.max(600, R * 3);
    [[s.key, s.sunDir], [s.moon, s.moonDir]].forEach(([light, dir]) => {
        light.position.copy(c).addScaledVector(dir, dist);
        light.target.position.copy(c);
        light.target.updateMatrixWorld();
        const sc = light.shadow.camera;
        const half = Math.max(220, R * 1.35);
        sc.left = sc.bottom = -half;
        sc.right = sc.top = half;
        sc.near = dist * 0.1;
        sc.far = dist * 3;
        sc.updateProjectionMatrix();
    });
    s.moonSprite.position.copy(c).addScaledVector(s.moonDir, DOME_RADIUS * 0.9);
}

/** Toggle shadow casting on the rig (meshes are handled by the caller). */
function setStudioShadows(enabled, tr = globalThis.threeRenderer) {
    const s = tr && tr.studio;
    if (!s) return;
    const moonCasts = enabled && !!(s.model && s.model.moonCastsShadows);
    s.key.castShadow = !!enabled && !moonCasts;
    s.moon.castShadow = moonCasts;
}

const _moduleExports = { isLowFx, configureRenderer, installStudio, applySkyModel, updateStudioFrame, setStudioShadows };
bridgeGlobals(_moduleExports, 'renderStudio');
export { isLowFx, configureRenderer, installStudio, applySkyModel, updateStudioFrame, setStudioShadows };
