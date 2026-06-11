/**
 * Seeds browser-like globals that linkage modules expect via bridgeGlobals.
 */
import '../js/linkage/constants.js';
import '../js/linkage/math.js';
import '../js/linkage/solver.js';

globalThis.state = {
    modules: 12,
    hLengthFt: 10,
    vLengthFt: 8,
    pivotPct: 50,
    hobermanAng: 0,
    pivotAng: 0,
    foldAngle: Math.PI / 4,
    offsetTopIn: 0,
    offsetBotIn: 0,
    hStackCount: 3,
    vStackCount: 3,
    hBeamW: 3.5,
    hBeamT: 1.5,
    vBeamW: 3.5,
    vBeamT: 1.5,
    hStackGap: 0,
    vStackGap: 0,
    orientation: 0,
    animation: { minFoldAngle: null },
};
