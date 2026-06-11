/** Compact, stable solver output for golden-file regression tests. */
export function extractSolverMetrics(data, state) {
    const faces = data.structureGeometry?.faces;
    return {
        modules: state.modules,
        arrayCount: state.arrayCount ?? 1,
        orientation: state.orientation ?? 'horizontal',
        beamCount: data.beams.length,
        bracketCount: data.brackets.length,
        boltCount: data.bolts?.length ?? 0,
        washerCount: data.washers?.length ?? 0,
        faceCount: Array.isArray(faces) ? faces.length : 0,
        maxRad: round4(data.maxRad),
        maxHeight: round4(data.maxHeight),
        foldAngleDeg: round4((state.foldAngle * 180) / Math.PI),
    };
}

function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}
