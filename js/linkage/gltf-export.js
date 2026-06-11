// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { showToast } from '../core/feedback.js';
import { state } from './app-state.js';
import { buildLinkageGeometry } from './linkage-geometry.js';

    // ============================================================================
    // GLTF EXPORT SYSTEM
    // ============================================================================
    
    /**
     * Exports the current 3D model to glTF/GLB format with proper hierarchy.
     * Creates a structured scene with modules as parent groups containing
     * beams, brackets, and bolts as children for easy editing in SketchUp/other 3D apps.
     * 
     * Hierarchy structure:
     * - Root (LinkageLab_Export)
     *   - Module_0
     *     - HorizontalBeams_Top
     *     - HorizontalBeams_Bottom
     *     - VerticalBeams
     *     - Brackets
     *     - Bolts
     *   - Module_1
     *     - ...
     *   - Panels (if enabled)
     */
    function exportToGLTF(format = 'glb', units = 'meters', coordSys = 'yup', options = {}) {
        const shouldDownload = options.download !== false;
        const isSilent = options.silent === true;
        const isSketchUpExport = options.target === 'sketchup' || options.bakeTransforms === true;
        // Check if GLTFExporter is available
        if (typeof THREE === 'undefined' || typeof THREE.GLTFExporter === 'undefined') {
            showToast('GLTFExporter not available. Please check your internet connection.', 'error');
            console.error('THREE.GLTFExporter not loaded');
            return Promise.reject(new Error('GLTFExporter not available'));
        }
        
        console.log('[GLTF Export] Starting export with units:', units, 'coordSys:', coordSys);
        
        // Calculate scale factor based on export units
        // Internal model units are INCHES
        // glTF standard is meters
        let scaleFactor = 1;
        switch (units) {
            case 'meters':
                // Convert inches to meters: 1 inch = 0.0254 meters
                scaleFactor = 0.0254;
                break;
            case 'feet':
                // Convert inches to feet: 1 inch = 1/12 feet
                scaleFactor = 1 / 12;
                break;
            case 'inches':
            default:
                // Keep as inches (1:1)
                scaleFactor = 1;
                break;
        }
        
        // Get current geometry data using the same assembled component set as the live viewport.
        const data = buildLinkageGeometry({
            includeSupportBeams: true,
            includePanels: !!(state.solarPanels && state.solarPanels.enabled),
            useCache: false
        });
        
        if (!data || !data.beams || data.beams.length === 0) {
            showToast('No geometry to export. Please create a structure first.', 'error');
            return Promise.reject(new Error('No geometry to export'));
        }
        
        // Helper functions for coordinate transformation (Y-up to Z-up)
        // Transform: Y → Z, Z → -Y (rotate 90° around X axis)
        const transformPointYupToZup = (p) => {
            if (!p) return p;
            return { x: p.x, y: -p.z, z: p.y };
        };
        
        const transformDirYupToZup = (v) => {
            if (!v) return v;
            return { x: v.x, y: -v.z, z: v.y };
        };
        
        // Apply coordinate transformation to all geometry data if Z-up is selected
        if (coordSys === 'zup') {
            console.log('[GLTF Export] Transforming geometry data to Z-up...');
            
            // Transform beams
            if (data.beams) {
                data.beams.forEach(beam => {
                    // Transform corners
                    if (beam.corners) {
                        beam.corners = beam.corners.map(c => transformPointYupToZup(c));
                    }
                    // Transform center
                    if (beam.center) {
                        beam.center = transformPointYupToZup(beam.center);
                    }
                    // Transform axis vectors
                    if (beam.axisX) beam.axisX = transformDirYupToZup(beam.axisX);
                    if (beam.axisY) beam.axisY = transformDirYupToZup(beam.axisY);
                    if (beam.axisZ) beam.axisZ = transformDirYupToZup(beam.axisZ);
                    if (beam.p1) beam.p1 = transformPointYupToZup(beam.p1);
                    if (beam.p2) beam.p2 = transformPointYupToZup(beam.p2);
                });
            }
            
            // Transform brackets
            if (data.brackets) {
                data.brackets.forEach(bracket => {
                    // If bottomPos doesn't exist but pos and bottomY do, construct bottomPos first
                    if (!bracket.bottomPos && bracket.pos && bracket.bottomY !== undefined) {
                        bracket.bottomPos = {
                            x: bracket.pos.x,
                            y: bracket.bottomY,
                            z: bracket.pos.z
                        };
                    }
                    
                    // Now transform positions
                    if (bracket.pos) bracket.pos = transformPointYupToZup(bracket.pos);
                    if (bracket.bottomPos) bracket.bottomPos = transformPointYupToZup(bracket.bottomPos);
                    if (bracket.beamDir) bracket.beamDir = transformDirYupToZup(bracket.beamDir);
                    if (bracket.right) bracket.right = transformDirYupToZup(bracket.right);
                });
            }
            
            // Transform bolts
            if (data.bolts) {
                data.bolts.forEach(bolt => {
                    if (bolt.center) bolt.center = transformPointYupToZup(bolt.center);
                    if (bolt.dir) bolt.dir = transformDirYupToZup(bolt.dir);
                    if (bolt.start) bolt.start = transformPointYupToZup(bolt.start);
                    if (bolt.end) bolt.end = transformPointYupToZup(bolt.end);
                });
            }
            
            // Transform panels
            if (data.panels) {
                data.panels.forEach(panel => {
                    if (panel.center) panel.center = transformPointYupToZup(panel.center);
                    if (panel.corners) {
                        panel.corners = panel.corners.map(c => transformPointYupToZup(c));
                    }
                    if (panel.axisX) panel.axisX = transformDirYupToZup(panel.axisX);
                    if (panel.axisY) panel.axisY = transformDirYupToZup(panel.axisY);
                    if (panel.axisZ) panel.axisZ = transformDirYupToZup(panel.axisZ);
                    if (panel.normal) panel.normal = transformDirYupToZup(panel.normal);
                });
            }
            
            console.log('[GLTF Export] Geometry data transformed to Z-up');
        }
    
        const exportBounds = calculateBeamBounds(data.beams, { mainStructureOnly: true });
        const exportCenter = exportBounds.center || { x: 0, y: 0, z: 0 };
        data.structureBounds = exportBounds;
        data.structureCenter = exportCenter;
        
        // Create a new scene for export (independent of the render scene)
        const exportScene = new THREE.Scene();
        exportScene.name = 'LinkageLab_Export';
        
        // Create coordinate system wrapper group (for Y-up to Z-up conversion)
        const coordWrapper = new THREE.Group();
        coordWrapper.name = 'CoordSystem';
        exportScene.add(coordWrapper);
        
        // Structure and panels mirror the viewport transform model: structure can rotate
        // around its center; panels stay in their observed frame.
        const rootGroup = new THREE.Group();
        rootGroup.name = 'Structure';
        coordWrapper.add(rootGroup);
        
        // Track total meshes added for validation
        let totalMeshes = 0;
        
        // Flag for Z-up coordinate system (passed to mesh creation functions)
        const isZup = coordSys === 'zup';
        
        const offsetForExportPivot = (obj) => {
            obj.position.x -= exportCenter.x;
            obj.position.y -= exportCenter.y;
            obj.position.z -= exportCenter.z;
            return obj;
        };
        
        // Group beams by module index; support beams use moduleIndex -1 and need their own group.
        const beamsByModule = {};
        const supportBeamsForExport = [];
        if (data.beams) {
            data.beams.forEach(beam => {
                if (beam.stackType && beam.stackType.startsWith('support-beam')) {
                    supportBeamsForExport.push(beam);
                    return;
                }
                
                const modIdx = beam.moduleIndex !== undefined ? beam.moduleIndex : 0;
                if (!beamsByModule[modIdx]) {
                    beamsByModule[modIdx] = {
                        horizontalTop: [],
                        horizontalBottom: [],
                        vertical: []
                    };
                }
                
                if (beam.stackType === 'horizontal-top') {
                    beamsByModule[modIdx].horizontalTop.push(beam);
                } else if (beam.stackType === 'horizontal-bottom') {
                    beamsByModule[modIdx].horizontalBottom.push(beam);
                } else {
                    beamsByModule[modIdx].vertical.push(beam);
                }
            });
        }
        
        // Group brackets by module index
        const bracketsByModule = {};
        if (data.brackets) {
            data.brackets.forEach(bracket => {
                const modIdx = bracket.moduleIndex !== undefined ? bracket.moduleIndex : 0;
                if (!bracketsByModule[modIdx]) bracketsByModule[modIdx] = [];
                bracketsByModule[modIdx].push(bracket);
            });
        }
        
        // Group bolts by module index
        const boltsByModule = {};
        if (data.bolts) {
            data.bolts.forEach(bolt => {
                const modIdx = bolt.moduleIndex !== undefined ? bolt.moduleIndex : 0;
                if (!boltsByModule[modIdx]) boltsByModule[modIdx] = [];
                boltsByModule[modIdx].push(bolt);
            });
        }
        
        // Create module groups with hierarchical structure
        const moduleCount = state.modules || 1;
        for (let i = 0; i < moduleCount; i++) {
            const moduleGroup = new THREE.Group();
            moduleGroup.name = `Module_${i}`;
            
            // Create sub-groups for each element type
            const hBeamsTopGroup = new THREE.Group();
            hBeamsTopGroup.name = 'HorizontalBeams_Top';
            
            const hBeamsBottomGroup = new THREE.Group();
            hBeamsBottomGroup.name = 'HorizontalBeams_Bottom';
            
            const vBeamsGroup = new THREE.Group();
            vBeamsGroup.name = 'VerticalBeams';
            
            const bracketsGroup = new THREE.Group();
            bracketsGroup.name = 'Brackets';
            
            const boltsGroup = new THREE.Group();
            boltsGroup.name = 'Bolts';
            
            // Add beams for this module — pass data.bolts so each beam mesh
            // includes its actual bolt through-holes for SketchUp / glTF.
            const exportBolts = data.bolts || [];
            if (beamsByModule[i]) {
                // Horizontal top beams
                beamsByModule[i].horizontalTop.forEach((beam, idx) => {
                    try {
                        const mesh = createBeamMeshForExport(beam, isZup, exportBolts);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `HBeam_Top_${idx}`;
                            offsetForExportPivot(mesh);
                            hBeamsTopGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create HBeam_Top_${idx}:`, e);
                    }
                });
                
                // Horizontal bottom beams
                beamsByModule[i].horizontalBottom.forEach((beam, idx) => {
                    try {
                        const mesh = createBeamMeshForExport(beam, isZup, exportBolts);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `HBeam_Bottom_${idx}`;
                            offsetForExportPivot(mesh);
                            hBeamsBottomGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create HBeam_Bottom_${idx}:`, e);
                    }
                });
                
                // Vertical beams
                beamsByModule[i].vertical.forEach((beam, idx) => {
                    try {
                        const mesh = createBeamMeshForExport(beam, isZup, exportBolts);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `VBeam_${idx}`;
                            offsetForExportPivot(mesh);
                            vBeamsGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create VBeam_${idx}:`, e);
                    }
                });
            }
            
            // Add brackets for this module
            if (bracketsByModule[i]) {
                bracketsByModule[i].forEach((bracket, idx) => {
                    try {
                        const mesh = createBracketMeshForExport(bracket, isZup);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `Bracket_${idx}`;
                            offsetForExportPivot(mesh);
                            bracketsGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create Bracket_${idx}:`, e);
                    }
                });
            }
            
            // Add bolts for this module
            if (boltsByModule[i]) {
                boltsByModule[i].forEach((bolt, idx) => {
                    try {
                        const mesh = createBoltMeshForExport(bolt, isZup);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `Bolt_${idx}`;
                            offsetForExportPivot(mesh);
                            boltsGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create Bolt_${idx}:`, e);
                    }
                });
            }
            
            // Add sub-groups to module (only if they have children)
            if (hBeamsTopGroup.children.length > 0) moduleGroup.add(hBeamsTopGroup);
            if (hBeamsBottomGroup.children.length > 0) moduleGroup.add(hBeamsBottomGroup);
            if (vBeamsGroup.children.length > 0) moduleGroup.add(vBeamsGroup);
            if (bracketsGroup.children.length > 0) moduleGroup.add(bracketsGroup);
            if (boltsGroup.children.length > 0) moduleGroup.add(boltsGroup);
            
            // Only add module if it has content
            if (moduleGroup.children.length > 0) {
                rootGroup.add(moduleGroup);
            }
        }
    
        if (supportBeamsForExport.length > 0) {
            const supportGroup = new THREE.Group();
            supportGroup.name = 'SupportBeams';
            
            const radialGroup = new THREE.Group();
            radialGroup.name = 'RadialSupportBeams';
            const reciprocalGroup = new THREE.Group();
            reciprocalGroup.name = 'ReciprocalSupportBeams';
            
            const supportExportBolts = data.bolts || [];
            supportBeamsForExport.forEach((beam, idx) => {
                try {
                    const mesh = createBeamMeshForExport(beam, isZup, supportExportBolts);
                    if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                        const isReciprocal = beam.stackType === 'support-beam-reciprocal';
                        mesh.name = isReciprocal ? `SupportBeam_Reciprocal_${idx}` : `SupportBeam_Radial_${idx}`;
                        offsetForExportPivot(mesh);
                        (isReciprocal ? reciprocalGroup : radialGroup).add(mesh);
                        totalMeshes++;
                    }
                } catch (e) {
                    console.warn(`[GLTF Export] Failed to create SupportBeam_${idx}:`, e);
                }
            });
            
            if (radialGroup.children.length > 0) supportGroup.add(radialGroup);
            if (reciprocalGroup.children.length > 0) supportGroup.add(reciprocalGroup);
            if (supportGroup.children.length > 0) rootGroup.add(supportGroup);
        }
    
        if (data.bolts) {
            const rcpExportBolts = data.bolts.filter(b => b && (b.boltType === 'rcp-ring' || b.boltType === 'rcp-cross'));
            if (rcpExportBolts.length > 0) {
                const rcpBoltGroup = new THREE.Group();
                rcpBoltGroup.name = 'ReciprocalSupportBolts_Bolts';
                rcpExportBolts.forEach((bolt, idx) => {
                    try {
                        const mesh = createBoltMeshForExport(bolt, isZup);
                        if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                            mesh.name = `RcpBolt_${idx}`;
                            offsetForExportPivot(mesh);
                            rcpBoltGroup.add(mesh);
                            totalMeshes++;
                        }
                    } catch (e) {
                        console.warn(`[GLTF Export] Failed to create RcpBolt_${idx}:`, e);
                    }
                });
                if (rcpBoltGroup.children.length > 0) rootGroup.add(rcpBoltGroup);
            }
        }
    
        const ibcExportGroup = createIbcExportGroup(data, exportCenter);
        if (ibcExportGroup) {
            rootGroup.add(ibcExportGroup);
            totalMeshes += countMeshesInObject(ibcExportGroup);
        }
        
        // Add panels as a separate group if present
        if (data.panels && data.panels.length > 0) {
            const panelsGroup = new THREE.Group();
            panelsGroup.name = 'SolarPanels';
            
            data.panels.forEach((panel, idx) => {
                try {
                    const mesh = createPanelMeshForExport(panel, isZup);
                    if (mesh && (mesh.isMesh || mesh.children.length > 0)) {
                        mesh.name = `Panel_${idx}`;
                        offsetForExportPivot(mesh);
                        panelsGroup.add(mesh);
                        totalMeshes++;
                    }
                } catch (e) {
                    console.warn(`[GLTF Export] Failed to create Panel_${idx}:`, e);
                }
            });
            
            if (panelsGroup.children.length > 0) {
                coordWrapper.add(panelsGroup);
            }
        }
        
        console.log(`[GLTF Export] Created ${totalMeshes} meshes in ${rootGroup.children.length} modules`);
        
        if (totalMeshes === 0) {
            showToast('No valid geometry to export.', 'error');
            return;
        }
        
        // Apply structure rotation around the same center used by the viewport.
        rootGroup.position.set(
            exportCenter.x * scaleFactor,
            exportCenter.y * scaleFactor,
            exportCenter.z * scaleFactor
        );
        const structureRotRad = (state.structureRotation || 0) * Math.PI / 180;
        if (Math.abs(structureRotRad) > 0.001) {
            if (isZup) {
                rootGroup.rotation.z = structureRotRad;
            } else {
                rootGroup.rotation.y = structureRotRad;
            }
        }
        
        // Apply unit scale factor to structure and unrotated panel export groups.
        if (scaleFactor !== 1) {
            rootGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
            const panelsGroup = coordWrapper.children.find(child => child.name === 'SolarPanels');
            if (panelsGroup) {
                panelsGroup.position.set(
                    exportCenter.x * scaleFactor,
                    exportCenter.y * scaleFactor,
                    exportCenter.z * scaleFactor
                );
                panelsGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
            }
            console.log(`[GLTF Export] Applied scale factor: ${scaleFactor} (${units})`);
        } else {
            const panelsGroup = coordWrapper.children.find(child => child.name === 'SolarPanels');
            if (panelsGroup) {
                panelsGroup.position.set(exportCenter.x, exportCenter.y, exportCenter.z);
            }
        }
        
        // Force update matrices for all objects
        exportScene.updateMatrixWorld(true);
    
        const sceneForExport = isSketchUpExport ? createBakedSketchUpExportScene(exportScene) : exportScene;
        if (isSketchUpExport) {
            console.log('[GLTF Export] Created SketchUp baked export scene with flattened mesh transforms');
        }
        
        // Export using GLTFExporter
        const exporter = new THREE.GLTFExporter();
        
        const exporterOptions = {
            binary: format === 'glb',
            trs: !isSketchUpExport,  // SketchUp import is more reliable with baked geometry and no TRS stack
            onlyVisible: true,
            truncateDrawRange: true,
            includeCustomExtensions: false
        };
        
        return new Promise((resolve, reject) => {
            try {
                const handleExportResult = (result) => {
                    // Download the file
                    const filename = `LinkageLab_Export_${Date.now()}.${format}`;
                    let blob = null;
                    let output = null;
                    
                    try {
                        if (format === 'glb') {
                            // Binary format
                            if (!(result instanceof ArrayBuffer)) {
                                throw new Error('GLB export did not return binary data. Check GLTFExporter options/signature.');
                            }
                            if (!isValidGlbArrayBuffer(result)) {
                                throw new Error('GLB export returned invalid binary data.');
                            }
                            blob = new Blob([result], { type: 'application/octet-stream' });
                            if (shouldDownload) {
                                downloadBlob(blob, filename);
                            }
                        } else {
                            // JSON format (gltf)
                            output = JSON.stringify(result, null, 2);
                            blob = new Blob([output], { type: 'application/json' });
                            if (shouldDownload) {
                                downloadBlob(blob, filename);
                            }
                        }
                        
                        if (!isSilent) {
                            showToast(`Exported 3D model as ${filename}`, 'success');
                        }
                        console.log(`[GLTF Export] Successfully exported ${moduleCount} modules with ${data.beams?.length || 0} beams, ${data.brackets?.length || 0} brackets, ${data.bolts?.length || 0} bolts`);
                        
                        resolve({ blob, format, filename, result });
                    } catch (e) {
                        console.error('GLTF Export download error:', e);
                        if (!isSilent) {
                            showToast('Failed to export 3D model: ' + e.message, 'error');
                        }
                        reject(e);
                    } finally {
                        // Clean up export scene after export completes
                        disposeExportSceneResources(sceneForExport);
                        if (sceneForExport !== exportScene) {
                            disposeExportSceneResources(exportScene);
                        }
                    }
                };
    
                const handleExportError = (error) => {
                    console.error('GLTF Export parse error:', error);
                    if (!isSilent) {
                        showToast('Failed to export 3D model: ' + error.message, 'error');
                    }
                    reject(error);
                };
                
                if (exporter.parse.length >= 4) {
                    exporter.parse(sceneForExport, handleExportResult, handleExportError, exporterOptions);
                } else {
                    exporter.parse(sceneForExport, handleExportResult, exporterOptions);
                }
            } catch (error) {
                console.error('GLTF Export error:', error);
                if (!isSilent) {
                    showToast('Failed to export 3D model: ' + error.message, 'error');
                }
                reject(error);
            }
        });
    }
    
    function disposeExportSceneResources(scene) {
        if (!scene || !scene.traverse) return;
        scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => { if (m && m.dispose) m.dispose(); });
                } else if (obj.material.dispose) {
                    obj.material.dispose();
                }
            }
        });
    }
    
    function countMeshesInObject(root) {
        let count = 0;
        if (!root || !root.traverse) return count;
        root.traverse(obj => {
            if (obj.isMesh) count++;
        });
        return count;
    }
    
    function cloneMaterialForExport(material) {
        if (!material) return material;
        if (Array.isArray(material)) return material.map(mat => mat && mat.clone ? mat.clone() : mat);
        return material.clone ? material.clone() : material;
    }
    
    function cloneIbcTemplateForExport(template) {
        const root = template.clone(true);
        root.traverse(obj => {
            if (!obj.isMesh) return;
            if (obj.geometry && obj.geometry.clone) obj.geometry = obj.geometry.clone();
            obj.material = cloneMaterialForExport(obj.material);
        });
        return root;
    }
    
    function createBakedSketchUpExportScene(sourceScene) {
        sourceScene.updateMatrixWorld(true);
        
        const bakedScene = new THREE.Scene();
        bakedScene.name = 'LinkageLab_Export_SketchUp_Baked';
        const bakedRoot = new THREE.Group();
        bakedRoot.name = 'SketchUp_Baked_Meshes';
        bakedScene.add(bakedRoot);
        
        sourceScene.traverse(obj => {
            if (!obj.isMesh || !obj.geometry) return;
            
            const bakedGeometry = obj.geometry.clone();
            bakedGeometry.applyMatrix4(obj.matrixWorld);
            if (bakedGeometry.attributes && bakedGeometry.attributes.normal) {
                bakedGeometry.computeVertexNormals();
            }
            
            const bakedMesh = new THREE.Mesh(bakedGeometry, cloneMaterialForExport(obj.material));
            bakedMesh.name = obj.name || 'Mesh';
            bakedMesh.castShadow = obj.castShadow;
            bakedMesh.receiveShadow = obj.receiveShadow;
            bakedRoot.add(bakedMesh);
        });
        
        return bakedScene;
    }
    
    /**
     * Helper to download a blob as a file
     */
    function downloadBlob(blob, filename) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
    
    function isValidGlbArrayBuffer(buffer) {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return false;
        const view = new DataView(buffer);
        return view.getUint32(0, true) === 0x46546c67; // ASCII "glTF" little-endian
    }
    
    /**
     * Creates a beam mesh optimized for export using BoxGeometry for glTF compatibility
     * Uses BoxGeometry with proper orientation to ensure clean export.
     * If `allBolts` is supplied, every bolt that physically passes through this beam
     * is drilled as a cylindrical through-hole — so SketchUp/glTF imports show the
     * actual hole pattern (matching the build-guide drill template).
     * @param {Object} beam - Beam data with corners
     * @param {boolean} isZup - Whether we're exporting to Z-up coordinate system
     * @param {Array} [allBolts] - Optional list of bolts (data.bolts) to drill holes for
     */
    function createBeamMeshForExport(beam, isZup = false, allBolts = null) {
        // Validate beam has corners
        if (!beam || !beam.corners || beam.corners.length < 8) {
            console.warn('Invalid beam for export - missing corners');
            // Return an empty group as fallback
            return new THREE.Group();
        }
        
        const c = beam.corners;
        
        // Calculate beam center from corners
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < 8; i++) { 
            cx += c[i].x; 
            cy += c[i].y; 
            cz += c[i].z; 
        }
        const center = { x: cx / 8, y: cy / 8, z: cz / 8 };
        
        // Calculate beam dimensions from corners
        // c[0-3] are one end, c[4-7] are the other end
        const end0Center = {
            x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4,
            y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4,
            z: (c[0].z + c[1].z + c[2].z + c[3].z) / 4
        };
        const end1Center = {
            x: (c[4].x + c[5].x + c[6].x + c[7].x) / 4,
            y: (c[4].y + c[5].y + c[6].y + c[7].y) / 4,
            z: (c[4].z + c[5].z + c[6].z + c[7].z) / 4
        };
        
        // Beam length is distance between end centers
        const dx = end1Center.x - end0Center.x;
        const dy = end1Center.y - end0Center.y;
        const dz = end1Center.z - end0Center.z;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Beam direction
        const beamDir = length > 0.001 ? 
            { x: dx / length, y: dy / length, z: dz / length } : 
            { x: 0, y: 0, z: 1 };
        
        // Calculate cross-section vectors from corners
        // c[0]→c[1] is one edge of the cross-section
        // c[0]→c[3] is the perpendicular edge
        const edge1 = new THREE.Vector3(
            c[1].x - c[0].x,
            c[1].y - c[0].y,
            c[1].z - c[0].z
        );
        const edge2 = new THREE.Vector3(
            c[3].x - c[0].x,
            c[3].y - c[0].y,
            c[3].z - c[0].z
        );
        
        const width1 = edge1.length();
        const width2 = edge2.length();
        
        // Determine which edge is width vs thickness (larger = width)
        let widthVec, thickVec, width, thickness;
        if (width1 >= width2) {
            width = width1 || 0.1;
            thickness = width2 || 0.1;
            widthVec = edge1.clone().normalize();
            thickVec = edge2.clone().normalize();
        } else {
            width = width2 || 0.1;
            thickness = width1 || 0.1;
            widthVec = edge2.clone().normalize();
            thickVec = edge1.clone().normalize();
        }
        
        // Wood color material
        const base = beam.colorBase || { r: 139, g: 90, b: 43 };
        const woodColor = new THREE.Color(
            Math.max(0, (base.r * 0.7 - 20)) / 255,
            Math.max(0, (base.g * 0.65 - 15)) / 255,
            Math.max(0, (base.b * 0.5 - 10)) / 255
        );
        
        const material = new THREE.MeshStandardMaterial({
            color: woodColor,
            roughness: 0.8,
            metalness: 0.0
        });
    
        // Try to drill bolt through-holes whenever any bolt passes through this
        // beam. Falls back silently to a solid BoxGeometry on any failure so a
        // single problematic beam can never abort the whole glTF export.
        if (Array.isArray(allBolts) && allBolts.length > 0 &&
            beam.axisX && beam.axisY && beam.axisZ && beam.p1 && beam.p2 && beam.center) {
            try {
                const intersections = getBeamBoltIntersections(beam, allBolts);
                if (intersections.length > 0) {
                    const drilled = buildBeamMeshWithHoles(beam, intersections, material);
                    if (drilled) return drilled;
                }
            } catch (err) {
                console.warn('[createBeamMeshForExport] drilled mesh failed, using solid box', err);
            }
        }
    
        // Create BoxGeometry (X=width, Y=thickness, Z=length)
        const geometry = new THREE.BoxGeometry(width, thickness, Math.max(length, 0.1));
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Position at center
        mesh.position.set(center.x, center.y, center.z);
        
        // Orient using the actual corner-derived axes
        // X axis = width direction, Y axis = thickness direction, Z axis = beam direction
        const zAxis = new THREE.Vector3(beamDir.x, beamDir.y, beamDir.z);
        const xAxis = widthVec;
        const yAxis = thickVec;
        
        // Make sure axes are orthogonal by recalculating Y from X and Z
        const yAxisCorrected = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
        // And recalculate X to ensure orthogonality
        const xAxisCorrected = new THREE.Vector3().crossVectors(yAxisCorrected, zAxis).normalize();
        
        const rotMatrix = new THREE.Matrix4();
        rotMatrix.makeBasis(xAxisCorrected, yAxisCorrected, zAxis);
        mesh.quaternion.setFromRotationMatrix(rotMatrix);
        
        return mesh;
    }
    
    /**
     * Creates a bracket mesh optimized for export
     * Uses BoxGeometry for glTF compatibility
     * @param {Object} bracket - Bracket data
     * @param {boolean} isZup - Whether we're exporting to Z-up coordinate system
     */
    function createBracketMeshForExport(bracket, isZup = false) {
        // Validate bracket data
        if (!bracket || (!bracket.pos && !bracket.bottomPos)) {
            console.warn('Invalid bracket for export - missing position');
            return new THREE.Group();
        }
        
        const material = new THREE.MeshStandardMaterial({
            color: 0x555555,
            roughness: 0.5,
            metalness: 0.7
        });
        
        const width = Math.max(bracket.width || state.bracketWidth || 3.5, 0.1);
        const height = Math.max(bracket.height || state.bracketHeight || 2.5, 0.1);
        const depth = Math.max(bracket.depth || state.bracketDepth || 3.5, 0.1);
        const wallThickness = Math.max(bracket.wallThickness || state.bracketWallThickness || 0.25, 0.05);
        const innerWidth = bracket.innerWidth || state.bracketInnerWidth || 1.5;
        const legWidth = Math.max((width - innerWidth) / 2, 0.1);
        
        const bracketGroup = new THREE.Group();
        
        if (isZup) {
            // Z-up: height goes along Z axis
            // Bottom plate
            const bottomPlate = new THREE.BoxGeometry(width, depth, wallThickness);
            const bottomMesh = new THREE.Mesh(bottomPlate, material);
            bottomMesh.position.z = wallThickness / 2;
            bracketGroup.add(bottomMesh);
            
            // Left leg
            const leftLeg = new THREE.BoxGeometry(legWidth, depth, height);
            const leftMesh = new THREE.Mesh(leftLeg, material.clone());
            leftMesh.position.set(-(width - legWidth) / 2, 0, height / 2 + wallThickness);
            bracketGroup.add(leftMesh);
            
            // Right leg
            const rightLeg = new THREE.BoxGeometry(legWidth, depth, height);
            const rightMesh = new THREE.Mesh(rightLeg, material.clone());
            rightMesh.position.set((width - legWidth) / 2, 0, height / 2 + wallThickness);
            bracketGroup.add(rightMesh);
        } else {
            // Y-up: height goes along Y axis
            // Bottom plate
            const bottomPlate = new THREE.BoxGeometry(width, wallThickness, depth);
            const bottomMesh = new THREE.Mesh(bottomPlate, material);
            bottomMesh.position.y = wallThickness / 2;
            bracketGroup.add(bottomMesh);
            
            // Left leg
            const leftLeg = new THREE.BoxGeometry(legWidth, height, depth);
            const leftMesh = new THREE.Mesh(leftLeg, material.clone());
            leftMesh.position.set(-(width - legWidth) / 2, height / 2 + wallThickness, 0);
            bracketGroup.add(leftMesh);
            
            // Right leg
            const rightLeg = new THREE.BoxGeometry(legWidth, height, depth);
            const rightMesh = new THREE.Mesh(rightLeg, material.clone());
            rightMesh.position.set((width - legWidth) / 2, height / 2 + wallThickness, 0);
            bracketGroup.add(rightMesh);
        }
        
        // Position with validation
        let bracketX = 0, bracketY = 0, bracketZ = 0;
        if (bracket.bottomPos) {
            bracketX = bracket.bottomPos.x || 0;
            bracketY = bracket.bottomPos.y || 0;
            bracketZ = bracket.bottomPos.z || 0;
        } else if (bracket.pos) {
            bracketX = bracket.pos.x || 0;
            bracketY = bracket.bottomY || bracket.pos.y || 0;
            bracketZ = bracket.pos.z || 0;
        }
        bracketGroup.position.set(bracketX, bracketY, bracketZ);
        
        // Orient bracket based on beam direction and right vector
        const isArchMode = !!bracket.bottomPos;
        if (isArchMode && bracket.beamDir && bracket.right) {
            const beamDirMag = vMag(bracket.beamDir);
            const rightMag = vMag(bracket.right);
            if (beamDirMag > 0.001 && rightMag > 0.001) {
                const beamDir = vNorm(bracket.beamDir);
                const right = vNorm(bracket.right);
                
                // Check if this is a vertical beam (in Z-up, beamDir is mostly along Z)
                const isVerticalBeam = isZup && Math.abs(beamDir.z) > 0.7;
                
                if (isVerticalBeam) {
                    // For vertical beams: bracket sits FLAT (horizontal)
                    // U-opening faces up for bottom brackets, down for top brackets
                    // Use the bracket's "right" vector to determine orientation
                    // "right" points across the beam (tangential direction)
                    // The bracket depth (U-opening) should be perpendicular to "right"
                    
                    const rx = right.x || 0;
                    const ry = right.y || 0;
                    
                    // Calculate angle of the "right" vector in XY plane
                    const rightAngle = Math.atan2(ry, rx);
                    
                    if (bracket.isBottom) {
                        // Bottom bracket: U-opening faces up
                        bracketGroup.rotation.z = rightAngle + Math.PI;
                    } else {
                        // Top bracket: flip upside down and adjust Z rotation to match
                        // The X flip reverses the effective Z rotation direction
                        bracketGroup.rotation.x = Math.PI;
                        bracketGroup.rotation.z = -rightAngle;
                    }
                } else {
                    // For angled/horizontal beams: tilt bracket to follow beam direction
                    let up = vCross(right, beamDir);
                    const upMag = vMag(up);
                    if (upMag > 0.001) {
                        up = vScale(up, 1/upMag);
                        if (!bracket.isBottom) up = vScale(up, -1);
                        
                        // Build rotation matrix
                        const matrix = new THREE.Matrix4();
                        if (isZup) {
                            // Z-up bracket: local X=width, local Y=depth, local Z=height
                            matrix.set(
                                right.x, beamDir.x, up.x, 0,
                                right.y, beamDir.y, up.y, 0,
                                right.z, beamDir.z, up.z, 0,
                                0, 0, 0, 1
                            );
                        } else {
                            // Y-up bracket: local X=width, local Y=height, local Z=depth
                            matrix.set(
                                right.x, up.x, beamDir.x, 0,
                                right.y, up.y, beamDir.y, 0,
                                right.z, up.z, beamDir.z, 0,
                                0, 0, 0, 1
                            );
                        }
                        bracketGroup.setRotationFromMatrix(matrix);
                    }
                }
            }
        } else if (bracket.beamDir) {
            // Cylinder/simple mode - orient bracket to face the beam direction
            if (isZup) {
                // Z-up: vertical beams go along Z axis
                // The bracket should have its opening facing the beam
                const beamX = bracket.beamDir.x || 0;
                const beamY = bracket.beamDir.y || 0;
                const beamZ = bracket.beamDir.z || 0;
                
                // Check if beam is mostly vertical (along Z)
                const isVerticalBeam = Math.abs(beamZ) > Math.sqrt(beamX*beamX + beamY*beamY);
                
                if (isVerticalBeam) {
                    // For vertical beams, bracket sits flat on horizontal beam
                    // U-opening faces UP (+Z), base plate is horizontal
                    // Only rotate around Z to orient which way bracket faces
                    const posX = bracketX || 0;
                    const posY = bracketY || 0;
                    const radialAngle = Math.atan2(posY, posX);
                    
                    // Bracket should face radially (depth along radial direction)
                    // Add 90° so bracket depth points toward/away from center
                    bracketGroup.rotation.z = radialAngle - Math.PI / 2;
                    
                    // If top bracket, flip it upside down (U-opening faces DOWN)
                    if (!bracket.isBottom) {
                        bracketGroup.rotation.x = Math.PI;
                    }
                } else {
                    // For horizontal beams
                    const beamHorizLength = Math.sqrt(beamX * beamX + beamY * beamY);
                    if (beamHorizLength > 0.001) {
                        bracketGroup.rotation.z = Math.atan2(beamY, beamX);
                    }
                    if (!bracket.isBottom) {
                        bracketGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI);
                    }
                }
            } else {
                // Y-up: horizontal plane is XZ, vertical is Y
                const beamX = bracket.beamDir.x || 0;
                const beamZ = bracket.beamDir.z || 0;
                const beamHorizLength = Math.sqrt(beamX * beamX + beamZ * beamZ);
                if (beamHorizLength > 0.001) {
                    bracketGroup.rotation.y = Math.atan2(beamX, beamZ);
                }
                if (!bracket.isBottom) {
                    bracketGroup.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI);
                }
            }
        }
        
        return bracketGroup;
    }
    
    /**
     * Creates a bolt mesh optimized for export
     * Uses CylinderGeometry for both shaft and head to ensure glTF compatibility
     * @param {Object} bolt - Bolt data
     * @param {boolean} isZup - Whether we're exporting to Z-up coordinate system
     */
    function createBoltMeshForExport(bolt, isZup = false) {
        // Validate bolt data
        if (!bolt || !bolt.center) {
            console.warn('Invalid bolt for export - missing center');
            return new THREE.Group();
        }
        
        const boltRadius = bolt.radius || (state.boltDiameter ? state.boltDiameter / 2 : 0.1875);
        const boltLength = bolt.length || 2;
        
        const material = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.8
        });
        
        const boltGroup = new THREE.Group();
        
        // Shaft - simple cylinder
        const shaftGeometry = new THREE.CylinderGeometry(boltRadius, boltRadius, boltLength, 8);
        const shaftMesh = new THREE.Mesh(shaftGeometry, material);
        boltGroup.add(shaftMesh);
        
        // Hex head - use CylinderGeometry with 6 sides instead of ExtrudeGeometry for compatibility
        const hexRadius = boltRadius * 1.8;
        const hexHeight = boltRadius * 1.2;
        const hexGeometry = new THREE.CylinderGeometry(hexRadius, hexRadius, hexHeight, 6);
        const hexMesh = new THREE.Mesh(hexGeometry, material.clone());
        hexMesh.position.y = boltLength / 2 + hexHeight / 2;
        boltGroup.add(hexMesh);
        
        // Position and orient
        boltGroup.position.set(bolt.center.x, bolt.center.y, bolt.center.z);
        if (bolt.dir) {
            const dir = new THREE.Vector3(bolt.dir.x, bolt.dir.y, bolt.dir.z).normalize();
            if (dir.length() > 0.001) {
                // CylinderGeometry is oriented along Y axis by default
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
                boltGroup.quaternion.copy(quaternion);
            }
        } else if (isZup) {
            // If no direction specified and Z-up, rotate to point along Z
            boltGroup.rotation.x = Math.PI / 2;
        }
        
        return boltGroup;
    }
    
    /**
     * Creates a panel mesh optimized for export with full 3D orientation
     * Uses BoxGeometry for glTF compatibility and applies proper orientation
     * based on panel's corner points for accurate geometry matching
     * @param {Object} panel - Panel data
     * @param {boolean} isZup - Whether we're exporting to Z-up coordinate system
     */
    function createPanelMeshForExport(panel, isZup = false) {
        if (panel.formFactor === 'folding') return createFoldingPanelMesh(panel);
        if (panel.formFactor === 'flexible') return createFlexiblePanelMesh(panel);
        // Validate panel data
        if (!panel || !panel.center) {
            console.warn('Invalid panel for export - missing center');
            return new THREE.Group();
        }
        
        // Calculate panel dimensions with defaults
        const width = panel.width || 40;
        const length = panel.length || 65;
        const thickness = panel.thickness || panel.thick || 1.4;
        
        // Use simple box geometry for export
        // BoxGeometry: width (X), height (Y), depth (Z)
        const geometry = new THREE.BoxGeometry(
            Math.max(width, 0.1), 
            Math.max(thickness, 0.1), 
            Math.max(length, 0.1)
        );
        
        const material = new THREE.MeshStandardMaterial({
            color: 0x1a3a5a,
            roughness: 0.3,
            metalness: 0.5
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Position at panel center
        mesh.position.set(
            panel.center.x || 0, 
            panel.center.y || 0, 
            panel.center.z || 0
        );
        
        // Best method: derive orientation from corner points (matches actual render)
        // Panel3D corners: 0-3 are bottom face, 4-7 are top face
        // Corner layout: 0=(-w,-l), 1=(+w,-l), 2=(+w,+l), 3=(-w,+l) in local coords
        if (panel.corners && panel.corners.length >= 8) {
            const c = panel.corners;
            
            // Calculate axes from corners (same as used for rendering)
            // Width axis: from corner 0 to corner 1 (along panel width)
            const widthVec = new THREE.Vector3(
                c[1].x - c[0].x,
                c[1].y - c[0].y,
                c[1].z - c[0].z
            );
            
            // Length axis: from corner 0 to corner 3 (along panel length)
            const lengthVec = new THREE.Vector3(
                c[3].x - c[0].x,
                c[3].y - c[0].y,
                c[3].z - c[0].z
            );
            
            // Normal axis: from bottom center to top center (thickness direction)
            const bottomCenter = {
                x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4,
                y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4,
                z: (c[0].z + c[1].z + c[2].z + c[3].z) / 4
            };
            const topCenter = {
                x: (c[4].x + c[5].x + c[6].x + c[7].x) / 4,
                y: (c[4].y + c[5].y + c[6].y + c[7].y) / 4,
                z: (c[4].z + c[5].z + c[6].z + c[7].z) / 4
            };
            const normalVec = new THREE.Vector3(
                topCenter.x - bottomCenter.x,
                topCenter.y - bottomCenter.y,
                topCenter.z - bottomCenter.z
            );
            
            // Normalize the axes
            const xAxis = widthVec.normalize();
            const yAxis = normalVec.normalize();
            const zAxis = lengthVec.normalize();
            
            // Build rotation matrix - columns are where box axes go
            const rotMatrix = new THREE.Matrix4();
            rotMatrix.makeBasis(xAxis, yAxis, zAxis);
            mesh.quaternion.setFromRotationMatrix(rotMatrix);
            
        } else if (panel.axisX && panel.axisY && panel.axisZ) {
            // Fallback: use stored axes
            const xAxis = new THREE.Vector3(panel.axisX.x, panel.axisX.y, panel.axisX.z).normalize();
            const yAxis = new THREE.Vector3(panel.axisY.x, panel.axisY.y, panel.axisY.z).normalize();
            const zAxis = new THREE.Vector3(panel.axisZ.x, panel.axisZ.y, panel.axisZ.z).normalize();
            
            const rotMatrix = new THREE.Matrix4();
            rotMatrix.makeBasis(xAxis, yAxis, zAxis);
            mesh.quaternion.setFromRotationMatrix(rotMatrix);
            
        } else if (panel.rotation !== undefined && !isNaN(panel.rotation)) {
            // Simple rotation around vertical axis (for basic horizontal panels)
            if (isZup) {
                mesh.rotation.z = panel.rotation;
            } else {
                mesh.rotation.y = panel.rotation;
            }
        }
        
        return mesh;
    }
    
    /**
     * Shows a modal dialog for GLTF export options
     */
    function showGLTFExportDialog() {
        // Create modal if it doesn't exist
        let modal = document.getElementById('gltf-export-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gltf-export-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 450px;">
                    <div class="modal-header">
                        <h3>Export 3D Model</h3>
                        <button class="modal-close" onclick="closeGLTFExportModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <p style="margin-bottom: 16px; color: var(--text-secondary);">
                            Export your structure as a 3D model that can be imported into SketchUp, Blender, or other 3D software.
                        </p>
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Export Profile:</label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-profile" value="standard" checked>
                                    <span><strong>Standard glTF</strong> (Godot, Blender, Windows preview)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-profile" value="sketchup">
                                    <span><strong>SketchUp 2026</strong> (baked mesh transforms, Y-up)</span>
                                </label>
                            </div>
                            <p style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">
                                Use SketchUp mode if SketchUp scatters imported glTF/GLB parts. This profile keeps glTF Y-up and lets SketchUp convert to its Z-up workspace.
                            </p>
                        </div>
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Format:</label>
                            <div style="display: flex; gap: 12px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-format" value="glb" checked>
                                    <span><strong>GLB</strong> (Binary, smaller)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-format" value="gltf">
                                    <span><strong>glTF</strong> (JSON)</span>
                                </label>
                            </div>
                        </div>
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Export Units:</label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-units" value="meters" checked>
                                    <span><strong>Meters</strong> (glTF standard - recommended)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-units" value="inches">
                                    <span><strong>Inches</strong> (raw model units - import as inches)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-units" value="feet">
                                    <span><strong>Feet</strong> (for 1 unit = 1 foot import)</span>
                                </label>
                            </div>
                        </div>
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Target Software:</label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-coordsys" value="yup" checked>
                                    <span><strong>Y-Up</strong> (Blender, Three.js, standard glTF)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="radio" name="gltf-coordsys" value="zup">
                                    <span><strong>Z-Up</strong> (SketchUp, 3ds Max, AutoCAD)</span>
                                </label>
                            </div>
                            <p style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">
                                Standard exports can use either option. SketchUp 2026 mode always uses Y-Up internally to avoid double up-axis conversion.
                            </p>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 6px; font-size: 0.85rem;">
                            <strong>Hierarchy:</strong><br>
                            <code style="font-size: 0.8rem; color: var(--text-secondary);">
                            Structure/<br>
                            &nbsp;&nbsp;Module_0/<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;HorizontalBeams_Top/<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;HorizontalBeams_Bottom/<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;VerticalBeams/<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;Brackets/<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;Bolts/<br>
                            &nbsp;&nbsp;Module_1/...<br>
                            &nbsp;&nbsp;SupportBeams/<br>
                            &nbsp;&nbsp;IBCReference/ <span style="color: var(--text-muted);">(when visible)</span><br>
                            &nbsp;&nbsp;SolarPanels/
                            </code>
                            <div style="margin-top: 8px; color: var(--text-muted);">
                                Optional IBC tanks export when they are enabled and visible in the editor.
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 12px 20px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-light);">
                        <button onclick="closeGLTFExportModal()" style="padding: 8px 16px;">Cancel</button>
                        <button onclick="executeGLTFExport()" style="padding: 8px 16px; background: var(--accent-primary); color: white; font-weight: 600;">Export</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        modal.style.display = 'flex';
        
        const profileRadios = modal.querySelectorAll('input[name="gltf-profile"]');
        profileRadios.forEach(radio => {
            radio.onchange = () => {
                if (radio.value === 'sketchup' && radio.checked) {
                    const yUp = modal.querySelector('input[name="gltf-coordsys"][value="yup"]');
                    if (yUp) yUp.checked = true;
                }
            };
        });
    }
    
    /**
     * Closes the GLTF export dialog
     */
    function closeGLTFExportModal() {
        const modal = document.getElementById('gltf-export-modal');
        if (modal) modal.style.display = 'none';
    }
    
    /**
     * Executes the GLTF export with selected options
     */
    function executeGLTFExport() {
        const profileRadio = document.querySelector('input[name="gltf-profile"]:checked');
        const profile = profileRadio ? profileRadio.value : 'standard';
        
        const formatRadio = document.querySelector('input[name="gltf-format"]:checked');
        const format = formatRadio ? formatRadio.value : 'glb';
        
        const unitsRadio = document.querySelector('input[name="gltf-units"]:checked');
        const units = unitsRadio ? unitsRadio.value : 'meters';
        
        const coordSysRadio = document.querySelector('input[name="gltf-coordsys"]:checked');
        // SketchUp's glTF importer performs its own Y-up glTF -> Z-up SketchUp conversion.
        // Exporting pre-rotated Z-up data here causes a second conversion and tips the model/panels over.
        const coordSys = profile === 'sketchup' ? 'yup' : (coordSysRadio ? coordSysRadio.value : 'yup');
        
        closeGLTFExportModal();
        exportToGLTF(format, units, coordSys, { target: profile });
    }


const _moduleExports = {
    exportToGLTF,
    cloneIbcTemplateForExport,
    showGLTFExportDialog,
    closeGLTFExportModal,
    executeGLTFExport,
};

bridgeGlobals(_moduleExports, 'gltfExport');

export { exportToGLTF, cloneIbcTemplateForExport, showGLTFExportDialog, closeGLTFExportModal, executeGLTFExport };
