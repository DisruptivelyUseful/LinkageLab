// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { calculateJointPositions } from './joint-kinematics.js';

    /**
     * Updates all Three.js scenes with current geometry data
     */
    function updateThreeJSScenes(data, structureCenter) {
        if (!threeRenderer.initialized) return;
        
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
        
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
                threeRenderer.beamGroup.add(mesh);
            });
        }
        
        // Add panels
        if (data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                const mesh = createPanelMesh(panel);
                offsetMesh(mesh);
                threeRenderer.panelGroup.add(mesh);
            });
        }
        
        // Add brackets if enabled
        if (state.showBrackets && data.brackets) {
            data.brackets.forEach(bracket => {
                const mesh = createBracketMesh(bracket);
                offsetMesh(mesh);
                threeRenderer.bracketGroup.add(mesh);
            });
        }
        
        // Add bolts if enabled
        if (state.showBolts && data.bolts) {
            data.bolts.forEach(bolt => {
                const mesh = createBoltMesh(bolt);
                offsetMesh(mesh);
                threeRenderer.boltGroup.add(mesh);
            });
        }
        
        // Add washers if enabled (only when bolts are shown)
        if (state.showBolts && data.washers) {
            data.washers.forEach(washer => {
                const mesh = createWasherMesh(washer);
                if (mesh && mesh.children.length > 0) { // Only add if mesh was created (non-zero thickness)
                    offsetMesh(mesh);
                    threeRenderer.washerGroup.add(mesh);
                }
            });
        }
    
        // Full-detail hardware assemblies (replace outer bracket/bolt stacks)
        if (state.showHardwareFullDetail && data.hardwareAssemblyPlacements && data.hardwareAssemblyPlacements.length) {
            const asm = hwGetOuterVBeamAssembly();
            if (asm) {
                data.hardwareAssemblyPlacements.forEach(placement => {
                    if (placement.assemblyId !== 'outerVBeam') return;
                    const xf = hwComputeOuterAssemblyTransform(placement);
                    const instance = buildHardwareAssemblyGroup(asm, {
                        explode: 0,
                        syncFromState: false,
                        excludeBeams: true
                    });
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
                });
            }
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
        
        // Update human scale reference figure
        updateHumanScaleFigure(data, sc);
        
        // Optional IBC GLB at structure footprint center
        updateIbcGlbReference(data, sc);
        
        // Update ground plane for shadows
        updateGroundPlane();
        
        // Skip ortho scene mesh rebuilds during animation (major perf win)
        if (!(state.animation && state.animation.playing)) {
            updateOrthoScenes(data, sc);
        }
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
     * Updates orthographic scene content (top and side views)
     */
    function updateOrthoScenes(data, structureCenter) {
        const sc = structureCenter || { x: 0, y: 0, z: 0 };
        const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
        
        // Apply structure rotation around structure center for ortho views (structure only, not panels)
        if (threeRenderer.topStructureGroup) {
            threeRenderer.topStructureGroup.position.set(sc.x, sc.y, sc.z);
            threeRenderer.topStructureGroup.rotation.y = structureRotRad;
        }
        if (threeRenderer.sideStructureGroup) {
            threeRenderer.sideStructureGroup.position.set(sc.x, sc.y, sc.z);
            threeRenderer.sideStructureGroup.rotation.y = structureRotRad;
        }
        
        // Panels in separate groups - position but don't rotate with structure
        if (threeRenderer.topPanelGroup) {
            threeRenderer.topPanelGroup.position.set(sc.x, sc.y, sc.z);
            threeRenderer.topPanelGroup.rotation.y = 0;
        }
        if (threeRenderer.sidePanelGroup) {
            threeRenderer.sidePanelGroup.position.set(sc.x, sc.y, sc.z);
            threeRenderer.sidePanelGroup.rotation.y = 0;
        }
        
        // Helper to offset mesh position by -structureCenter
        const offsetMesh = (mesh) => {
            mesh.position.x -= sc.x;
            mesh.position.y -= sc.y;
            mesh.position.z -= sc.z;
            return mesh;
        };
        
        // Get groups from wrapper groups (structure groups now have beams, brackets, bolts)
        const topBeamGroup = threeRenderer.topStructureGroup ? threeRenderer.topStructureGroup.children[0] : null;
        const topBracketGroup = threeRenderer.topStructureGroup ? threeRenderer.topStructureGroup.children[1] : null;
        const topBoltGroup = threeRenderer.topStructureGroup ? threeRenderer.topStructureGroup.children[2] : null;
        const sideBeamGroup = threeRenderer.sideStructureGroup ? threeRenderer.sideStructureGroup.children[0] : null;
        const sideBracketGroup = threeRenderer.sideStructureGroup ? threeRenderer.sideStructureGroup.children[1] : null;
        const sideBoltGroup = threeRenderer.sideStructureGroup ? threeRenderer.sideStructureGroup.children[2] : null;
        
        if (topBeamGroup) clearGroup(topBeamGroup);
        if (topBracketGroup) clearGroup(topBracketGroup);
        if (topBoltGroup) clearGroup(topBoltGroup);
        if (sideBeamGroup) clearGroup(sideBeamGroup);
        if (sideBracketGroup) clearGroup(sideBracketGroup);
        if (sideBoltGroup) clearGroup(sideBoltGroup);
        if (threeRenderer.topPanelGroup) clearGroup(threeRenderer.topPanelGroup);
        if (threeRenderer.sidePanelGroup) clearGroup(threeRenderer.sidePanelGroup);
        
        // Add beams to ortho views
        if (data.beams) {
            const orthoBolts = data.bolts || [];
            data.beams.forEach(beam => {
                const topMesh = createBeamMesh(beam, false, orthoBolts);
                const sideMesh = createBeamMesh(beam, false, orthoBolts);
                offsetMesh(topMesh);
                offsetMesh(sideMesh);
                if (topBeamGroup) topBeamGroup.add(topMesh);
                if (sideBeamGroup) sideBeamGroup.add(sideMesh);
            });
        }
        
        // Add panels to ortho views (separate from structure rotation)
        if (data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                const topMesh = createPanelMesh(panel);
                const sideMesh = createPanelMesh(panel);
                offsetMesh(topMesh);
                offsetMesh(sideMesh);
                if (threeRenderer.topPanelGroup) threeRenderer.topPanelGroup.add(topMesh);
                if (threeRenderer.sidePanelGroup) threeRenderer.sidePanelGroup.add(sideMesh);
            });
        }
        
        // Add brackets and bolts to ortho views (if enabled)
        if (state.showBrackets && data.brackets) {
            data.brackets.forEach(bracket => {
                const topMesh = createBracketMesh(bracket);
                const sideMesh = createBracketMesh(bracket);
                offsetMesh(topMesh);
                offsetMesh(sideMesh);
                if (topBracketGroup) topBracketGroup.add(topMesh);
                if (sideBracketGroup) sideBracketGroup.add(sideMesh);
            });
        }
        
        if (state.showBolts && data.bolts) {
            data.bolts.forEach(bolt => {
                const topMesh = createBoltMesh(bolt);
                const sideMesh = createBoltMesh(bolt);
                offsetMesh(topMesh);
                offsetMesh(sideMesh);
                if (topBoltGroup) topBoltGroup.add(topMesh);
                if (sideBoltGroup) sideBoltGroup.add(sideMesh);
            });
        }
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
        
        // Update renderer sizes using the WebGL canvases
        const viewport = document.getElementById('viewport');
        if (mainWebGLCanvas && viewport) {
            const w = viewport.clientWidth;
            const h = viewport.clientHeight;
            mainWebGLCanvas.width = w;
            mainWebGLCanvas.height = h;
            threeRenderer.main.setSize(w, h, false);
        }
        
        const topWebGLCanvas = document.getElementById('canvas-top-webgl');
        const top2DCanvas = document.getElementById('canvas-top');
        const topSection = document.getElementById('top-view-section');
        if (topWebGLCanvas) topWebGLCanvas.style.display = 'block';
        if (top2DCanvas) top2DCanvas.style.display = 'none';
        if (topWebGLCanvas && topSection && threeRenderer.top) {
            const tw = topSection.clientWidth;
            const th = topSection.clientHeight;
            topWebGLCanvas.width = tw;
            topWebGLCanvas.height = th;
            threeRenderer.top.setSize(tw, th, false);
        }
        
        const sideWebGLCanvas = document.getElementById('canvas-side-webgl');
        const side2DCanvas = document.getElementById('canvas-side');
        const sideSection = document.getElementById('side-view-section');
        if (sideWebGLCanvas) sideWebGLCanvas.style.display = 'block';
        if (side2DCanvas) side2DCanvas.style.display = 'none';
        if (sideWebGLCanvas && sideSection && threeRenderer.side) {
            const sw = sideSection.clientWidth;
            const sh = sideSection.clientHeight;
            sideWebGLCanvas.width = sw;
            sideWebGLCanvas.height = sh;
            threeRenderer.side.setSize(sw, sh, false);
        }
        
        // Update scenes with structure center for proper rotation pivot
        updateThreeJSScenes(data, structureCenter);
        
        updateMainCamera(structureCenter);
        updateGridPosition(structureCenter);
        threeRenderer.main.render(threeRenderer.mainScene, threeRenderer.mainCamera);
        
        // Skip ortho view updates during animation for major perf gain
        const skipOrtho = state.animation && state.animation.playing;
        
        if (!skipOrtho) {
            const topSection = document.getElementById('top-view-section');
            const sideSection = document.getElementById('side-view-section');
            const topVisible = topSection && topSection.offsetParent !== null;
            const sideVisible = sideSection && sideSection.offsetParent !== null;
            
            if (topVisible && threeRenderer.top && threeRenderer.topCamera) {
                updateTopCamera(data, structureCenter);
                threeRenderer.top.render(threeRenderer.topScene, threeRenderer.topCamera);
            }
            if (sideVisible && threeRenderer.side && threeRenderer.sideCamera) {
                updateSideCamera(data, structureCenter);
                threeRenderer.side.render(threeRenderer.sideScene, threeRenderer.sideCamera);
            }
        }
        
        return true;
    }


const _moduleExports = {
    updateThreeJSScenes,
    renderActuatorLine,
    updateOrthoScenes,
    renderThreeJS,
};

bridgeGlobals(_moduleExports, 'sceneRender');

export { updateThreeJSScenes, renderActuatorLine, updateOrthoScenes, renderThreeJS };
