// ============================================================================
// LINKAGE LAB — Room environment for image-based lighting (ES module)
//
// Inline port of three.js examples/environments/RoomEnvironment (MIT), itself
// derived from Google model-viewer's EnvironmentScene. Built lazily from the
// global THREE (r128) so this module stays importable without THREE (tests).
// Feed the returned scene to PMREMGenerator.fromScene() for scene.environment.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';

function areaLightMaterial(intensity) {
    const material = new THREE.MeshBasicMaterial();
    material.color.setScalar(intensity);
    return material;
}

/** A neutral studio room: one point light, a few boxes and six emissive panels. */
function createRoomEnvironment() {
    if (typeof THREE === 'undefined') return null;
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    geometry.deleteAttribute('uv');
    const roomMaterial = new THREE.MeshStandardMaterial({ side: THREE.BackSide });
    const boxMaterial = new THREE.MeshStandardMaterial();

    const mainLight = new THREE.PointLight(0xffffff, 5.0, 28, 2);
    mainLight.position.set(0.418, 16.199, 0.300);
    scene.add(mainLight);

    const room = new THREE.Mesh(geometry, roomMaterial);
    room.position.set(-0.757, 13.219, 0.717);
    room.scale.set(31.713, 28.305, 28.591);
    scene.add(room);

    const boxes = [
        [[-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]],
        [[-5.607, -0.754, -0.758], 0.994, [1.970, 1.534, 3.955]],
        [[6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]],
        [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]],
        [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]],
        [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]],
    ];
    boxes.forEach(([p, ry, s]) => {
        const box = new THREE.Mesh(geometry, boxMaterial);
        box.position.set(p[0], p[1], p[2]);
        box.rotation.set(0, ry, 0);
        box.scale.set(s[0], s[1], s[2]);
        scene.add(box);
    });

    const lights = [
        [50, [-16.116, 14.37, 8.208], [0.1, 2.428, 2.739]],
        [50, [-16.109, 18.021, -8.207], [0.1, 2.425, 2.751]],
        [17, [14.904, 12.198, -1.832], [0.15, 4.265, 6.331]],
        [43, [-0.462, 8.89, 14.520], [4.38, 5.441, 0.088]],
        [20, [3.235, 11.486, -12.541], [2.5, 2.0, 0.1]],
        [100, [0.0, 20.0, 0.0], [1.0, 0.1, 1.0]],
    ];
    lights.forEach(([intensity, p, s]) => {
        const light = new THREE.Mesh(geometry, areaLightMaterial(intensity));
        light.position.set(p[0], p[1], p[2]);
        light.scale.set(s[0], s[1], s[2]);
        scene.add(light);
    });
    return scene;
}

/**
 * Builds the PMREM environment texture for a renderer (call once per renderer).
 * @returns {THREE.Texture|null}
 */
function createRoomEnvironmentMap(renderer) {
    if (typeof THREE === 'undefined' || !renderer) return null;
    const room = createRoomEnvironment();
    if (!room) return null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    let texture = null;
    try {
        texture = pmrem.fromScene(room, 0.04).texture;
    } finally {
        pmrem.dispose();
        room.traverse(o => {
            if (o.isMesh) {
                if (o.material && o.material.dispose) o.material.dispose();
            }
        });
    }
    return texture;
}

const _moduleExports = { createRoomEnvironment, createRoomEnvironmentMap };
bridgeGlobals(_moduleExports, 'roomEnvironment');
export { createRoomEnvironment, createRoomEnvironmentMap };
