// ============================================================================ (ES module)
//
// Build Steps — fasten driver.
//
// Animates bolts turning in and seating, and nuts counter-rotating onto them:
//   * legacy solver bolts (createBoltMesh groups: local +Y is the bolt axis,
//     head at headSide * stackThickness/2)
//   * hardware assembly parts (part groups inside an assembly instance, with
//     userData.build from hwLayoutAxisParts: axis direction and seated axial
//     position). A nut on the same assembly axis as a bolt threads on from the
//     far end; without one (welded / rivet nut, tapped bracket) only the bolt
//     turns in.
//
// `op.allModules` extends the step's targets to every module.

import { bridgeGlobals } from './global-bridge.js';
import { state } from './app-state.js';
import { threeRenderer } from './renderer-3d.js';
import { easeInOutCubic } from './build-steps.js';
import { matchSelector, partKey } from './part-keys.js';
import { registerOpDriver } from './build-steps-anim.js';

const TWO_PI = Math.PI * 2;

function targetKeysFor(ctx) {
    const op = ctx.step.op || {};
    if (!op.allModules) return ctx.targetKeys;
    const sels = (ctx.step.targets || []).map(sel => {
        const s = { ...sel };
        delete s.moduleIndex;
        delete s.arrayIndex;
        return s;
    });
    const keys = new Set();
    for (const rec of ctx.parts) {
        if (sels.some(sel => matchSelector(rec.obj, sel, rec.kind))) keys.add(rec.key);
    }
    return keys;
}

function qAboutY(angle) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
}

/** Legacy bolt: unseat toward the head side along the bolt axis. */
function legacyBoltEntry(mesh, bolt, turns) {
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();
    const headSide = bolt.headSide !== undefined ? bolt.headSide : 1;
    const travel = Math.max(1, (bolt.length || 3) * 0.8);
    return {
        mesh,
        seatedPos: mesh.position.clone(),
        seatedQuat: mesh.quaternion.clone(),
        moveDir: axis.multiplyScalar(headSide),
        travel,
        spinSign: 1,
        turns,
    };
}

/** Hardware part: unseat along the assembly axis (bolts back out head-first, nuts go beyond the stack). */
function hwPartEntry(mesh, build, turns, isNut) {
    const axis = new THREE.Vector3(build.axis.x, build.axis.y, build.axis.z).normalize();
    // Local +Y of the part mesh points along the axis (or against it when flipped)
    const shaftDir = build.flip ? axis.clone().negate() : axis.clone();
    const len = Math.max(0.5, build.len || 1);
    return {
        mesh,
        seatedPos: mesh.position.clone(),
        seatedQuat: mesh.quaternion.clone(),
        moveDir: isNut ? shaftDir : shaftDir.clone().negate(),
        travel: isNut ? Math.max(1.5, len * 3) : Math.max(1.5, len * 0.8),
        spinSign: isNut ? -1 : 1,
        turns,
    };
}

function collectEntries(ctx) {
    const keys = targetKeysFor(ctx);
    const turns = Math.max(0.25, Number(ctx.step.op && ctx.step.op.turns) || 3);
    const entries = [];

    // Legacy bolts
    if (threeRenderer.boltGroup) {
        for (const mesh of threeRenderer.boltGroup.children) {
            const bolt = mesh.userData && mesh.userData.bolt;
            if (!bolt) continue;
            if (!keys.has(partKey(bolt, 'bolt'))) continue;
            entries.push(legacyBoltEntry(mesh, bolt, turns));
        }
    }

    // Hardware assembly instances: bolts and nuts on the same axis
    if (threeRenderer.hardwareAssemblyGroup) {
        for (const instance of threeRenderer.hardwareAssemblyGroup.children) {
            const placement = instance.userData && instance.userData.placement;
            if (!placement) continue;
            if (!keys.has(partKey(placement, 'placement'))) continue;
            const bolts = [], nuts = [];
            for (const part of instance.children) {
                const b = part.userData && part.userData.build;
                if (!b) continue;
                if (b.partType === 'bolt') bolts.push(part);
                else if (b.partType === 'nut') nuts.push(part);
            }
            for (const bolt of bolts) entries.push(hwPartEntry(bolt, bolt.userData.build, turns, false));
            for (const nut of nuts) {
                const nb = nut.userData.build;
                // A nut only animates when a bolt shares its axis (rivet / welded nuts stay put)
                const hasBolt = bolts.some(b => b.userData.build.renderAxisKey === nb.renderAxisKey);
                const isRivet = nb.nutStyle === 'rivet';
                if (hasBolt && !isRivet) entries.push(hwPartEntry(nut, nb, turns, true));
            }
        }
    }
    return entries;
}

const fastenDriver = {
    stage(ctx) {
        ctx.scratch.fasten = { entries: collectEntries(ctx) };
    },
    update(ctx, t) {
        const f = ctx.scratch.fasten;
        if (!f) return false;
        const e = easeInOutCubic(t);
        for (const en of f.entries) {
            en.mesh.position.copy(en.seatedPos).addScaledVector(en.moveDir, en.travel * (1 - e));
            const angle = en.spinSign * en.turns * TWO_PI * (1 - e);
            en.mesh.quaternion.copy(en.seatedQuat).multiply(qAboutY(angle));
        }
        return false;
    },
    end(ctx) {
        const f = ctx.scratch.fasten;
        if (!f) return;
        for (const en of f.entries) {
            en.mesh.position.copy(en.seatedPos);
            en.mesh.quaternion.copy(en.seatedQuat);
        }
        ctx.scratch.fasten = null;
    },
};

registerOpDriver('fasten', fastenDriver);

const _moduleExports = { fastenDriver };
bridgeGlobals(_moduleExports, 'buildStepsFasten');
export { fastenDriver };
