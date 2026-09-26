// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { calculateJointPositions } from './joint-kinematics.js';
import { partKey } from './part-keys.js';

    // Radius (inches) around the focused assembly within which structure beams
    // are drawn semi-transparent in hardware detail ("part view") mode so the
    // hardware is readable through them.
    const HW_DETAIL_BEAM_RADIUS = 36;

    /** Rotate point p around vertical axis at center c by ang (matches structureGroup.rotation.y). */
    function hwRotateYAround(p, c, ang) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        return { x: c.x + dx * cos + dz * sin, y: p.y, z: c.z - dx * sin + dz * cos };
    }

    /** True when a beam's long axis passes within `radius` of point `pt`. */
    function hwBeamNearPoint(beam, pt, radius) {
        if (!beam || !beam.corners || beam.corners.length < 8) return false;
        const avg = (idxs) => {
            let x = 0, y = 0, z = 0;
            idxs.forEach(i => { x += beam.corners[i].x; y += beam.corners[i].y; z += beam.corners[i].z; });
            const n = idxs.length;
            return { x: x / n, y: y / n, z: z / n };
        };
        const a = avg([0, 1, 2, 3]);
        const b = avg([4, 5, 6, 7]);
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const apx = pt.x - a.x, apy = pt.y - a.y, apz = pt.z - a.z;
        const abLen2 = (abx * abx + aby * aby + abz * abz) || 1;
        let t = (apx * abx + apy * aby + apz * abz) / abLen2;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
        const dx = pt.x - cx, dy = pt.y - cy, dz = pt.z - cz;
        return (dx * dx + dy * dy + dz * dz) <= radius * radius;
    }

    /** Resolve the representative placement to frame in hardware detail mode. */
    function hwResolveDetailFocus(data, sc, structureRotRad) {
        if (!state.hwDetailMode || !data.hardwareAssemblyPlacements || !data.hardwareAssemblyPlacements.length) return null;
        const activeId = state.hardwareAssemblies && state.hardwareAssemblies.activeId;
        // Build-step playback focuses the placement of the joint being worked on
        const stepKey = state.buildPlayback && state.buildPlayback.active ? state.buildPlayback.detailPlacementKey : null;
        const stepPl = stepKey ? data.hardwareAssemblyPlacements.find(p => partKey(p, 'placement') === stepKey) : null;
        const pl = stepPl || data.hardwareAssemblyPlacements.find(p => p.assemblyId === activeId) || data.hardwareAssemblyPlacements[0];
        const asm = pl && hwGetAssemblyById(pl.assemblyId);
        // Allow framing a detailed-but-empty assembly so the user can build it in place.
        if (!pl || !asm || !asm.detailed) return null;
        const xf = hwComputeAssemblyTransform(pl);
        return { placement: pl, assembly: asm, xf, worldPos: hwRotateYAround(xf.position, sc, structureRotRad) };
    }

    /**
     * Updates all Three.js scenes with current geometry data
     */
    function updateThreeJSScenes(data, structureCenter) {
        if (!threeRenderer.initialized) return;
        
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
        const detail = state.hwDetailMode === true;
        const hwFocus = hwResolveDetailFocus(data, sc, structureRotRad);
        threeRenderer._hwFocusTarget = hwFocus ? hwFocus.worldPos : null;
        // Detailed / part view replaces simple bracket+bolt meshes with parametric assemblies.
        const hideLegacyHardware = state.showHardwareFullDetail || detail;
        const showLegacyBrackets = state.showBrackets && !hideLegacyHardware;
        const showLegacyBolts = state.showBolts && !hideLegacyHardware;
        
        // Apply structure rotation around structure center (beams, brackets, bolts only - not panels)
        // To rotate around a point: position group at that point, offset children by -point
        if (threeRenderer.structureGroup) {
            threeRenderer.structureGroup.position.set(sc.x, sc.y, sc.z);
            threeRenderer.structureGroup.rotation.y = structureRotRad;
        }
        
        // Panels are in separate group - position them but don't rotate with structure
        if (threeRenderer.panelGroupRoot) {
            threeRenderer.panelGroupRoot.position.set(sc.x, sc.y, sc.z);
            threeRenderer.panelGroupRoot.rotation.y = 0; // Panels don't rotate with structure
        }
        
        // Clear existing meshes
        clearGroup(threeRenderer.beamGroup);
        clearGroup(threeRenderer.panelGroup);
        clearGroup(threeRenderer.bracketGroup);
        clearGroup(threeRenderer.boltGroup);
        clearGroup(threeRenderer.washerGroup);
        clearGroup(threeRenderer.hardwareAssemblyGroup);
        if (threeRenderer.coveringWallGroup) clearGroup(threeRenderer.coveringWallGroup);
        if (threeRenderer.coveringFabricGroup) clearGroup(threeRenderer.coveringFabricGroup);
        if (threeRenderer.coveringTableGroup) clearGroup(threeRenderer.coveringTableGroup);
        if (threeRenderer.coveringPickGroup) clearGroup(threeRenderer.coveringPickGroup);
        if (threeRenderer.coveringDimGroup) clearGroup(threeRenderer.coveringDimGroup);
        
        // Check if a beam is colliding
        const isColliding = (beam) => state.collisions.some(c => c.beam === beam || c.other === beam);
        
        // Helper to offset mesh position by -structureCenter (for rotation around center)
        const offsetMesh = (mesh) => {
            mesh.position.x -= sc.x;
            mesh.position.y -= sc.y;
            mesh.position.z -= sc.z;
            return mesh;
        };
        
        // Add beams (drill any bolt-through-holes so the live 3D matches the GLB export)
        if (data.beams) {
            const beamBolts = data.bolts || [];
            data.beams.forEach(beam => {
                const mesh = createBeamMesh(beam, isColliding(beam), beamBolts);
                offsetMesh(mesh);
                // Part view: the structure beams ARE the sandwich assembly beams.
                // Fade them to 26% opacity near the focused assembly so the
                // hardware and washer stack inside are readable through the beam.
                if (detail && hwFocus && hwBeamNearPoint(beam, hwFocus.xf.position, HW_DETAIL_BEAM_RADIUS)) {
                    mesh.traverse(ch => {
                        if (ch.isMesh && ch.material) {
                            ch.material.transparent = true;
                            ch.material.opacity = 0.26;
                            ch.material.depthWrite = false;
                        }
                    });
                    mesh.renderOrder = 0;
                }
                threeRenderer.beamGroup.add(mesh);
            });
        }
        
        // Add panels (hidden in part view to keep the close-up uncluttered)
        if (!detail && data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                const mesh = createPanelMesh(panel);
                offsetMesh(mesh);
                threeRenderer.panelGroup.add(mesh);
            });
        }

        // Coverings: plywood walls / fabric / tables between uprights (hidden in part view)
        const cov = data.coverings;
        if (!detail && cov && cov.supported && threeRenderer.coveringGroup) {
            const vis = (state.coverings && state.coverings.visibility) || {};
            const groupFor = { wall: threeRenderer.coveringWallGroup, fabric: threeRenderer.coveringFabricGroup, table: threeRenderer.coveringTableGroup };
            const shown = { wall: vis.walls !== false, fabric: vis.fabric !== false, table: vis.tables !== false };
            (cov.shapes || []).forEach(shape => {
                if (!shown[shape.kind]) return;
                const mesh = createCoveringMesh(shape);
                offsetMesh(mesh);
                groupFor[shape.kind].add(mesh);
            });
            if (state.coverings && state.coverings.showDimensions && typeof globalThis.createMeasurementLine3D === 'function') {
                const fmt = (v) => (typeof globalThis.formatInchesFraction === 'function' ? globalThis.formatInchesFraction(v, 16) : `${v.toFixed(1)}"`);
                const off = (p) => ({ x: p.x - sc.x, y: p.y - sc.y, z: p.z - sc.z });
                (cov.shapes || []).forEach(shape => {
                    if (!shown[shape.kind] || !shape.corners3D || shape.corners3D.length < 4) return;
                    const [bl, br, tr, tl] = shape.corners3D.map(off);
                    const o = { markerRadius: 0.8, labelScale: 26, labelLift: 3 };
                    globalThis.createMeasurementLine3D(bl, br, fmt(shape.widthBottomIn), 0xf0ad4e, threeRenderer.coveringDimGroup, o);
                    globalThis.createMeasurementLine3D(tl, tr, fmt(shape.widthTopIn), 0x00d2d3, threeRenderer.coveringDimGroup, o);
                    globalThis.createMeasurementLine3D(bl, tl, `${fmt(shape.slantHeightIn)}${shape.kind === 'table' ? '' : ` @ ${shape.tiltFromVerticalDeg.toFixed(1)}°`}`, 0x2ecc71, threeRenderer.coveringDimGroup, o);
                });
            }
            if (state.coverings && state.coverings.pickMode) {
                const covered = new Set((cov.shapes || []).filter(s => s.band !== 'table').map(s => `${s.spanIndex}:${s.band}`));
                (cov.pickQuads || []).forEach(q => {
                    if (covered.has(`${q.spanIndex}:${q.band}`)) return;
                    const mesh = createCoveringPickMesh(q);
                    offsetMesh(mesh);
                    threeRenderer.coveringPickGroup.add(mesh);
                });
            }
        }
        if (typeof globalThis.updateCoveringsReadout === 'function') {
            try { globalThis.updateCoveringsReadout(data); } catch (e) { console.warn('[Coverings] readout failed:', e); }
        }
        
        // Add brackets if enabled (hidden when high-detail assemblies are shown)
        if (showLegacyBrackets && data.brackets) {
            data.brackets.forEach(bracket => {
                const mesh = createBracketMesh(bracket);
                offsetMesh(mesh);
                threeRenderer.bracketGroup.add(mesh);
            });
        }
        
        // Add bolts if enabled (hidden when high-detail assemblies are shown)
        if (showLegacyBolts && data.bolts) {
            data.bolts.forEach(bolt => {
                const mesh = createBoltMesh(bolt);
                offsetMesh(mesh);
                threeRenderer.boltGroup.add(mesh);
            });
        }
        
        // Add washers if enabled (only when legacy bolts are shown)
        if (showLegacyBolts && data.washers) {
            data.washers.forEach(washer => {
                const mesh = createWasherMesh(washer);
                if (mesh && mesh.children.length > 0) { // Only add if mesh was created (non-zero thickness)
                    offsetMesh(mesh);
                    threeRenderer.washerGroup.add(mesh);
                }
            });
        }
    
        // Full-detail hardware assemblies (replace outer/inner bracket/bolt stacks).
        // The focused instance in part view is rendered separately (exploded) below.
        const addAssemblyInstance = (placement, opts) => {
            const asm = hwGetAssemblyById(placement.assemblyId);
            if (!asm || !asm.detailed || !asm.parts || !asm.parts.length) return null;
            const xf = hwComputeAssemblyTransform(placement);
            const instance = buildHardwareAssemblyGroup(asm, opts);
            instance.userData.placement = placement;
            instance.userData.type = 'placement';
            instance.position.set(xf.position.x, xf.position.y, xf.position.z);
            instance.quaternion.copy(xf.quaternion);
            instance.traverse(ch => {
                if (ch.isMesh) {
                    ch.castShadow = state.shadowsEnabled || false;
                    ch.receiveShadow = state.shadowsEnabled || false;
                }
            });
            offsetMesh(instance);
            threeRenderer.hardwareAssemblyGroup.add(instance);
            return instance;
        };

        if ((state.showHardwareFullDetail || detail) && data.hardwareAssemblyPlacements && data.hardwareAssemblyPlacements.length) {
            data.hardwareAssemblyPlacements.forEach(placement => {
                if (detail && hwFocus && placement === hwFocus.placement) return; // exploded copy added below
                addAssemblyInstance(placement, { explode: 0, syncFromState: false, excludeBeams: true });
            });
        }

        // Part view: render the focused real instance exploded (independent of the
        // full-detail toggle) so the editor shows the assembly in situ.
        if (detail && hwFocus) {
            const focusInstance = addAssemblyInstance(hwFocus.placement, {
                explode: hwExplodeFactor(),
                syncFromState: true,
                excludeBeams: true,
                selectedPartId: hwDetail && hwDetail.selectedPartId
            });
            // Look-at point: the assembly's visual centre (world bounding box), so it stays
            // centred across fold angles and explode levels. Empty assemblies fall back to the anchor.
            let focusPoint = hwFocus.worldPos;
            let focusRadius = 6;
            if (focusInstance) {
                const box = hwInstanceWorldBounds(focusInstance);
                if (box) { focusPoint = box.center; focusRadius = box.radius; }
            }
            threeRenderer._hwFocusTarget = focusPoint;
            threeRenderer._hwFocusRadius = focusRadius;
            if (hwDetail) {
                if (hwDetail.needsRecenter) {
                    hwFrameDetailInstance(focusPoint, focusRadius, sc, hwFocus.assembly && hwFocus.assembly.detailCam);
                    hwDetail.needsRecenter = false;
                    hwDetail.needsRefit = false;
                } else if (hwDetail.needsRefit) {
                    hwFitDetailDistance(focusRadius);
                    hwDetail.needsRefit = false;
                }
                hwDetail.focusGroupUuid = focusInstance ? focusInstance.uuid : null;
            }
            if (typeof globalThis.hwSyncFoldSliderFromState === 'function') globalThis.hwSyncFoldSliderFromState();
        }
        
        // Render actuator visualization lines if one is selected
        if (state.selectedActuator) {
            renderActuatorLine(state.selectedActuator, data, sc);
        } else {
            // Clear actuator lines if none selected
            if (threeRenderer.actuatorLineGroup) {
                clearGroup(threeRenderer.actuatorLineGroup);
            }
        }
        
        // Decorative references and ortho views are suppressed in part view so the
        // close-up shows only the assembly and its surrounding beams.
        if (detail) {
            if (threeRenderer.humanScaleGroup) clearGroup(threeRenderer.humanScaleGroup);
            if (threeRenderer.ibcPivot) clearGroup(threeRenderer.ibcPivot);
            if (threeRenderer.gridHelper) threeRenderer.gridHelper.visible = false;
            if (threeRenderer.panelGroupRoot) threeRenderer.panelGroupRoot.visible = false;
        } else {
            if (threeRenderer.panelGroupRoot) threeRenderer.panelGroupRoot.visible = true;
            if (threeRenderer.structureGroup) threeRenderer.structureGroup.visible = true;

            // Update human scale reference figure
            updateHumanScaleFigure(data, sc);

            // Optional IBC GLB at structure footprint center
            updateIbcGlbReference(data, sc);

            // Update ground plane for shadows
            updateGroundPlane();

            // Skip ortho scene mesh rebuilds during animation / build-step playback (major perf win)
        }

        // Build-step playback: stage the assembly (hide future parts, highlight the
        // current step's parts, or show the workbench). Runs last so it can override
        // grid/panel visibility. Global lookup avoids an import cycle. In the parts
        // detail view (close-up steps) it also captures the framed camera.
        if (state.buildPlayback && state.buildPlayback.active && typeof globalThis.applyBuildStepScene === 'function') {
            globalThis.applyBuildStepScene(data, sc);
        }
    }

    /** World-space bounding sphere of an assembly instance ({center, radius}) or null. */
    function hwInstanceWorldBounds(instance) {
        try {
            instance.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(instance);
            if (box.isEmpty()) return null;
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const radius = Math.max(0.5, size.length() / 2);
            return { center: { x: center.x, y: center.y, z: center.z }, radius };
        } catch (e) {
            return null;
        }
    }

    /** Camera distance that fits a sphere of `radius` in the narrower field of view. */
    function hwFitDistanceForRadius(radius) {
        const cam = threeRenderer.mainCamera;
        const vfov = ((cam && cam.fov) || 45) * Math.PI / 180;
        const aspect = (cam && cam.aspect) || 1.5;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
        const fov = Math.min(vfov, hfov);
        const dist = (Math.max(0.5, radius) / Math.sin(fov / 2)) * 1.25;
        return Math.min(400, Math.max(8, dist));
    }

    /** Re-fit only the distance (explode level changed); keeps the user's orbit. */
    function hwFitDetailDistance(radius) {
        state.cam.dist = hwFitDistanceForRadius(radius);
    }

    /**
     * Frame state.cam head-on (radially outward) on the focused assembly.
     * Each assembly carries its own detailCam preset (pitch) so V-beam, V-center
     * and H-center views read differently. Distance comes from the bounding sphere.
     */
    function hwFrameDetailInstance(focusPoint, radius, sc, detailCam) {
        const pitchDeg = detailCam && typeof detailCam.pitchDeg === 'number' ? detailCam.pitchDeg : 8;
        const radialX = focusPoint.x - sc.x;
        const radialZ = focusPoint.z - sc.z;
        if (Math.abs(radialX) > 1e-4 || Math.abs(radialZ) > 1e-4) {
            state.cam.yaw = Math.atan2(radialX, radialZ);
        }
        state.cam.pitch = pitchDeg * Math.PI / 180;
        state.cam.dist = hwFitDistanceForRadius(radius);
        state.cam.panX = 0;
        state.cam.panY = 0;
        state.cam.target = null;
    }
    
    /**
     * Renders a visual line representing an actuator between two points
     * @param {Object} actuator - Actuator recommendation object with position1 and position2
     * @param {Object} data - Linkage geometry data
     * @param {{x: number, y: number, z: number}} structureCenter - Structure center point
     */
    function renderActuatorLine(actuator, data, structureCenter) {
        if (!threeRenderer.actuatorLineGroup || !actuator.position1 || !actuator.position2) return;
        
        clearGroup(threeRenderer.actuatorLineGroup);
        
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        
        // Get current positions (they may change with fold angle for joint-based actuators)
        let pos1 = actuator.position1;
        let pos2 = actuator.position2;
        
        // If positions track joints, recalculate at current angle
        if (actuator.tracksJoints || actuator.type === 'pivot' || actuator.type === 'intersection') {
            const hActiveIn = state.hLengthFt * INCHES_PER_FOOT - state.offsetTopIn - state.offsetBotIn;
            const jointResult = calculateJointPositions(state.foldAngle, {
                hActiveIn: hActiveIn,
                pivotPct: state.pivotPct,
                hobermanAng: state.hobermanAng,
                pivotAng: state.pivotAng
            });
            const loc = jointResult.joints;
            
            if (actuator.name.includes('Diagonal')) {
                pos1 = { x: loc.bl.x + sc.x, y: 0, z: loc.bl.y + sc.z };
                pos2 = { x: loc.tr.x + sc.x, y: 0, z: loc.tr.y + sc.z };
            } else if (actuator.name.includes('Inner-Outer')) {
                pos1 = { x: loc.br.x + sc.x, y: 0, z: loc.br.y + sc.z };
                pos2 = { x: loc.tr.x + sc.x, y: 0, z: loc.tr.y + sc.z };
            } else if (actuator.type === 'intersection') {
                pos1 = {
                    x: (loc.bl.x + loc.tl.x) / 2 + sc.x,
                    y: state.vLengthFt * INCHES_PER_FOOT / 4,
                    z: (loc.bl.y + loc.tl.y) / 2 + sc.z
                };
                pos2 = {
                    x: (loc.br.x + loc.tr.x) / 2 + sc.x,
                    y: state.vLengthFt * INCHES_PER_FOOT / 4,
                    z: (loc.br.y + loc.tr.y) / 2 + sc.z
                };
            } else if (actuator.type === 'vertical') {
                pos1 = { x: loc.br.x + sc.x, y: 0, z: loc.br.y + sc.z };
                pos2 = { x: loc.br.x + sc.x, y: state.vLengthFt * INCHES_PER_FOOT / 2, z: loc.br.y + sc.z };
            }
        }
        
        // Offset positions relative to structure center (for rotation)
        const offsetPos1 = {
            x: pos1.x - sc.x,
            y: pos1.y - sc.y,
            z: pos1.z - sc.z
        };
        const offsetPos2 = {
            x: pos2.x - sc.x,
            y: pos2.y - sc.y,
            z: pos2.z - sc.z
        };
        
        // Create line geometry
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            offsetPos1.x, offsetPos1.y, offsetPos1.z,
            offsetPos2.x, offsetPos2.y, offsetPos2.z
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Create bright colored material for visibility
        const material = new THREE.LineBasicMaterial({
            color: 0x00ff00, // Bright green
            linewidth: 3,
            transparent: true,
            opacity: 0.9
        });
        
        const line = new THREE.Line(geometry, material);
        
        // Position the line group at structure center (for rotation)
        threeRenderer.actuatorLineGroup.position.set(sc.x, sc.y, sc.z);
        threeRenderer.actuatorLineGroup.rotation.y = (state.structureRotation || 0) * Math.PI / 180;
        threeRenderer.actuatorLineGroup.add(line);
        
        // Add small spheres at attachment points for better visibility
        const sphereGeometry = new THREE.SphereGeometry(0.5, 8, 8);
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red spheres
        
        const sphere1 = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere1.position.set(offsetPos1.x, offsetPos1.y, offsetPos1.z);
        threeRenderer.actuatorLineGroup.add(sphere1);
        
        const sphere2 = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere2.position.set(offsetPos2.x, offsetPos2.y, offsetPos2.z);
        threeRenderer.actuatorLineGroup.add(sphere2);
    }
    
    /**
     * Renders all Three.js viewports
     */
    function renderThreeJS(data, structureCenter) {
        // Check if Three.js is loaded
        if (typeof THREE === 'undefined') {
            console.log('Three.js not loaded yet, waiting...');
            return false; // Return false to indicate fallback needed
        }
        
        if (!threeRenderer.initialized) {
            initThreeJS();
        }
        
        // If initialization failed, return false for fallback
        if (!threeRenderer.initialized || !threeRenderer.main) {
            console.log('Three.js not initialized');
            return false;
        }
        
        // Ensure WebGL canvas is visible and 2D canvas is hidden
        const mainWebGLCanvas = document.getElementById('canvas-webgl');
        const main2DCanvas = document.getElementById('canvas');
        if (mainWebGLCanvas) mainWebGLCanvas.style.display = 'block';
        if (main2DCanvas) main2DCanvas.style.display = 'none';
        
        // Update renderer sizes from the canvas's current container. In part view the
        // canvas is reparented into the hardware modal viewport, so size to that box.
        const viewport = document.getElementById('viewport');
        const mainSizeEl = (mainWebGLCanvas && mainWebGLCanvas.parentElement) || viewport;
        if (mainWebGLCanvas && mainSizeEl) {
            const w = mainSizeEl.clientWidth;
            const h = mainSizeEl.clientHeight;
            if (w > 0 && h > 0) {
                mainWebGLCanvas.width = w;
                mainWebGLCanvas.height = h;
                threeRenderer.main.setSize(w, h, false);
            }
        }
        
        // Update scenes with structure center for proper rotation pivot
        updateThreeJSScenes(data, structureCenter);
        
        // In part view, orbit/frame around the focused assembly instead of the structure center.
        const camCenter = (state.hwDetailMode && threeRenderer._hwFocusTarget)
            ? threeRenderer._hwFocusTarget
            : structureCenter;
        threeRenderer._lastMainCenter = camCenter;
        updateMainCamera(camCenter);
        updateGridPosition(structureCenter);
        threeRenderer.main.render(threeRenderer.mainScene, threeRenderer.mainCamera);
        
        return true;
    }


    /**
     * Re-renders the main view with the current camera WITHOUT rebuilding meshes.
     * Used by build-step playback for camera moves and tool animation frames.
     * @param {{x:number,y:number,z:number}} [structureCenter] - orbit center; defaults to the last full render's center
     * @returns {boolean} false when the renderer is not ready
     */
    function renderFrameOnly(structureCenter = null) {
        if (!threeRenderer.initialized || !threeRenderer.main || !threeRenderer.mainScene || !threeRenderer.mainCamera) return false;
        const center = structureCenter || threeRenderer._lastMainCenter || { x: 0, y: 0, z: 0 };
        updateMainCamera(center);
        threeRenderer.main.render(threeRenderer.mainScene, threeRenderer.mainCamera);
        return true;
    }

const _moduleExports = {
    updateThreeJSScenes,
    renderActuatorLine,
    renderThreeJS,
    renderFrameOnly,
};

bridgeGlobals(_moduleExports, 'sceneRender');

export { updateThreeJSScenes, renderActuatorLine, renderThreeJS, renderFrameOnly };
